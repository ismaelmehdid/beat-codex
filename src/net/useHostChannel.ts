/**
 * Host side of the Supabase Realtime channel.
 *
 * - Presence: who is in the room (players tracked by phones). Never carries controls.
 * - Broadcast in:  JOIN (handshake), INPUT (hot path, applied straight into the world).
 * - Broadcast out: PHASE, PLAYER_STATE (batched), GAME_OVER, RESET, WELCOME, SNAPSHOT (1Hz).
 *
 * `drain()` is called by the game loop every frame. It consumes `world.netEvents`, coalesces
 * them into a handful of sends, and emits the periodic snapshot. It returns true when a PHASE
 * event was drained so the loop can bump the UI immediately.
 *
 * When supabase is not configured the hook reports status 'disabled' and `drain` only clears the
 * queue (debug mode keeps working fully offline).
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { COUNTDOWN_MS } from '../game/constants'
import { addPlayer, allPlayers, applyInput, setPlayerConnected } from '../game/engine'
import { bumpWorld, getWorld } from '../game/store'
import type { GameState, Player } from '../game/types'
import {
  EVT,
  type EventName,
  type GameOverPayload,
  type PhasePayload,
  type PlayerNetState,
  type PlayerStatePayload,
  type PresenceMeta,
  type SnapshotPayload,
  type WelcomePayload,
} from '../lib/protocol'
import { channelNameFor, supabase } from '../lib/supabase'

export type NetStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export interface HostChannel {
  status: NetStatus
  /** Distinct players currently present in the room (presence), 0 when networking is disabled. */
  connectedCount: number
  /** Consume pending world net events + 1Hz snapshot. Returns true if a PHASE event was drained. */
  drain: () => boolean
}

const SNAPSHOT_INTERVAL_MS = 1000
/** PLAYER_STATE sends are coalesced across frames into at most one per this window. */
const PLAYER_STATE_MIN_INTERVAL_MS = 100
/** A player added via JOIN gets this long to show up in presence before being marked absent. */
const PRESENCE_GRACE_MS = 6000
const MAX_NAME_LENGTH = 15
const RESERVED_IDS = new Set(['host', 'debug-local'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) : ''
  return s || 'HACKER'
}

function netStateFor(p: Player, now: number): PlayerNetState {
  return {
    hp: p.hp,
    alive: p.alive,
    respawnInMs: p.respawnAt !== null ? Math.max(0, p.respawnAt - now) : null,
    connected: p.connected,
  }
}

function phasePayloadFor(world: GameState): PhasePayload {
  return world.phase === 'COUNTDOWN' ? { phase: world.phase, countdownMs: COUNTDOWN_MS } : { phase: world.phase }
}

/** Mark connected real players that are absent from presence as disconnected (after a grace period). */
function reconcilePresence(world: GameState, present: Map<string, string>): boolean {
  let changed = false
  for (const p of allPlayers(world)) {
    if (p.isFake || RESERVED_IDS.has(p.id) || present.has(p.id) || !p.connected) continue
    // JOIN can land before the phone's presence track: give it a moment.
    if (world.now - p.joinedAt < PRESENCE_GRACE_MS) continue
    setPlayerConnected(world, p.id, false)
    changed = true
  }
  return changed
}

/** Fire and forget: never await in the hot path, never throw. */
function send(ch: RealtimeChannel, event: EventName, payload: unknown): void {
  try {
    void ch.send({ type: 'broadcast', event, payload }).catch(() => {})
  } catch {
    /* ignore */
  }
}

export function useHostChannel(roomId: string): HostChannel {
  const [status, setStatus] = useState<NetStatus>(supabase ? 'connecting' : 'disabled')
  const [connectedCount, setConnectedCount] = useState(0)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const statusRef = useRef<NetStatus>(supabase ? 'connecting' : 'disabled')
  const lastSnapshotAtRef = useRef(0)
  const lastPlayerStateAtRef = useRef(0)
  const pendingPlayerStateRef = useRef(new Set<string>())
  /** Last presence snapshot (playerId -> name); null until the first presence sync. */
  const presentRef = useRef<Map<string, string> | null>(null)

  const updateStatus = useCallback((s: NetStatus) => {
    statusRef.current = s
    setStatus(s)
  }, [])

  useEffect(() => {
    if (!supabase || !roomId) return
    const client = supabase
    let disposed = false
    let channel: RealtimeChannel | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const syncPresence = (ch: RealtimeChannel) => {
      if (disposed || channel !== ch) return
      const world = getWorld()
      const state = ch.presenceState<PresenceMeta>()
      const present = new Map<string, string>()
      for (const key of Object.keys(state)) {
        for (const meta of state[key]) {
          if (!meta || meta.role !== 'player') continue
          const id = meta.playerId
          if (typeof id !== 'string' || !id || RESERVED_IDS.has(id)) continue
          if (!present.has(id)) present.set(id, cleanName(meta.name))
        }
      }
      for (const [id, name] of present) addPlayer(world, id, name)
      presentRef.current = present
      reconcilePresence(world, present)
      setConnectedCount(present.size)
      bumpWorld()
    }

    const onJoin = (ch: RealtimeChannel, payload: unknown) => {
      if (disposed || channel !== ch || !isRecord(payload)) return
      const playerId = payload.playerId
      if (typeof playerId !== 'string' || !playerId || RESERVED_IDS.has(playerId)) return
      const world = getWorld()
      const p = addPlayer(world, playerId, cleanName(payload.name))
      const welcome: WelcomePayload = { playerId, phase: world.phase, color: p.color }
      send(ch, EVT.WELCOME, welcome)
      bumpWorld()
    }

    const onInput = (payload: unknown) => {
      if (disposed || !isRecord(payload)) return
      const id = payload.p
      if (typeof id !== 'string' || RESERVED_IDS.has(id)) return
      const world = getWorld()
      if (!world.players[id]) return
      applyInput(world, id, {
        left: !!payload.l,
        right: !!payload.r,
        fire: !!payload.f,
        fireSeq: typeof payload.s === 'number' && Number.isFinite(payload.s) ? payload.s : undefined,
      })
    }

    const scheduleReconnect = () => {
      if (disposed || retryTimer) return
      const delay = Math.min(10000, 1000 * 2 ** attempt) + Math.random() * 400
      attempt = Math.min(attempt + 1, 6)
      retryTimer = setTimeout(() => {
        retryTimer = null
        const old = channel
        channel = null
        channelRef.current = null
        if (old) void client.removeChannel(old).catch(() => {})
        connect()
      }, delay)
    }

    const connect = () => {
      if (disposed) return
      updateStatus('connecting')
      const ch = client.channel(channelNameFor(roomId), {
        config: { presence: { key: 'host', enabled: true }, broadcast: { self: false, ack: false } },
      })
      channel = ch
      channelRef.current = ch
      ch.on('presence', { event: 'sync' }, () => syncPresence(ch))
      ch.on('presence', { event: 'join' }, () => syncPresence(ch))
      ch.on('presence', { event: 'leave' }, () => syncPresence(ch))
      ch.on('broadcast', { event: EVT.JOIN }, (msg) => onJoin(ch, msg.payload))
      ch.on('broadcast', { event: EVT.INPUT }, (msg) => onInput(msg.payload))
      ch.subscribe((st, err) => {
        if (disposed || channel !== ch) return
        if (st === 'SUBSCRIBED') {
          attempt = 0
          if (retryTimer) {
            clearTimeout(retryTimer)
            retryTimer = null
          }
          updateStatus('connected')
          const meta: PresenceMeta = { role: 'host', playerId: 'host', name: 'HOST', joinedAt: Date.now() }
          void ch.track(meta).catch(() => {})
          send(ch, EVT.PHASE, phasePayloadFor(getWorld()))
          lastSnapshotAtRef.current = 0 // snapshot ASAP so reconnecting phones catch up
          return
        }
        // CHANNEL_ERROR | TIMED_OUT | CLOSED
        if (err) console.warn('[net] channel', st, err.message)
        updateStatus('error')
        scheduleReconnect()
      })
    }

    connect()

    return () => {
      disposed = true
      presentRef.current = null
      if (retryTimer) clearTimeout(retryTimer)
      const old = channel
      channel = null
      channelRef.current = null
      if (old) void client.removeChannel(old).catch(() => {})
    }
  }, [roomId, updateStatus])

  const drain = useCallback((): boolean => {
    const world = getWorld()
    const events = world.netEvents
    if (events.length) world.netEvents = []

    let phaseChanged = false
    let sendPhase = false
    let sendGameOver = false
    let sendReset = false
    const pending = pendingPlayerStateRef.current
    for (const e of events) {
      switch (e.type) {
        case 'PHASE':
          phaseChanged = true
          sendPhase = true
          break
        case 'PLAYER_STATE':
          pending.add(e.playerId)
          break
        case 'GAME_OVER':
          sendGameOver = true
          break
        case 'RESET':
          sendReset = true
          break
      }
    }

    const ch = channelRef.current
    if (!ch || statusRef.current !== 'connected') {
      // Offline / reconnecting: drop the queue; the next SNAPSHOT after SUBSCRIBED resyncs phones.
      pending.clear()
      return phaseChanged
    }

    const now = world.now || performance.now()

    if (sendPhase) send(ch, EVT.PHASE, phasePayloadFor(world))

    if (pending.size && now - lastPlayerStateAtRef.current >= PLAYER_STATE_MIN_INTERVAL_MS) {
      const players: Record<string, PlayerNetState> = {}
      let count = 0
      for (const id of pending) {
        const p = world.players[id]
        if (!p || p.isFake) continue
        players[id] = netStateFor(p, now)
        count++
      }
      pending.clear()
      if (count > 0) {
        const payload: PlayerStatePayload = { players }
        send(ch, EVT.PLAYER_STATE, payload)
        lastPlayerStateAtRef.current = now
      }
    }

    if (sendGameOver && world.result) {
      const payload: GameOverPayload = { result: world.result, ranking: world.ranking }
      send(ch, EVT.GAME_OVER, payload)
    }

    if (sendReset) send(ch, EVT.RESET, {})

    if (now - lastSnapshotAtRef.current >= SNAPSHOT_INTERVAL_MS) {
      lastSnapshotAtRef.current = now
      if (presentRef.current && reconcilePresence(world, presentRef.current)) bumpWorld()
      const players: Record<string, PlayerNetState> = {}
      for (const p of allPlayers(world)) if (!p.isFake) players[p.id] = netStateFor(p, now)
      const snapshot: SnapshotPayload = {
        phase: world.phase,
        bossHp: world.boss.hp,
        bossMaxHp: world.boss.maxHp,
        teamLives: world.teamLives,
        players,
      }
      if (world.result) {
        snapshot.result = world.result
        snapshot.ranking = world.ranking
      }
      send(ch, EVT.SNAPSHOT, snapshot)
    }

    return phaseChanged
  }, [])

  return { status, connectedCount, drain }
}
