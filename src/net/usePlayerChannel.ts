/**
 * Phone-side network layer: one Supabase Realtime channel per room.
 *
 * - Presence: tracks { role: 'player', playerId, name } once subscribed.
 * - Broadcast in : PHASE, SNAPSHOT, PLAYER_STATE, GAME_OVER, RESET, WELCOME (filtered by playerId).
 * - Broadcast out: JOIN (handshake, re-sent on every (re)subscribe and when a SNAPSHOT proves the
 *   host dropped us), INPUT (via sendInput).
 *
 * Reliability model: realtime-js auto-rejoins a channel after CHANNEL_ERROR / TIMED_OUT while the
 * socket is up (and fires SUBSCRIBED again, so JOIN is re-sent). As a safety net we additionally
 * recreate the channel from scratch with backoff if a healthy SUBSCRIBED does not follow, and on
 * CLOSED (which realtime-js never recovers from by itself).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Phase } from '../game/types'
import { PLAYER_HP } from '../game/constants'
import {
  EVT,
  type GameOverPayload,
  type InputPayload,
  type JoinPayload,
  type PhasePayload,
  type PlayerNetState,
  type PlayerStatePayload,
  type PresenceMeta,
  type RankedPlayer,
  type SnapshotPayload,
  type WelcomePayload,
} from '../lib/protocol'
import { channelNameFor, supabase } from '../lib/supabase'

export type ChannelStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export interface MeState {
  hp: number
  alive: boolean
  /** Local Date.now()-based deadline derived from respawnInMs; null when alive / unknown. */
  respawnAt: number | null
  connected: boolean
}

/** Full controller state the phone sends (host treats INPUT as full state). */
export interface InputState {
  l: 0 | 1
  r: 0 | 1
  f: 0 | 1
  s: number
}

export interface PlayerChannel {
  status: ChannelStatus
  hostPhase: Phase | null
  welcomed: boolean
  color: string | null
  me: MeState
  result: 'VICTORY' | 'DEFEAT' | null
  ranking: RankedPlayer[] | null
  sendInput: (state: InputState) => void
}

interface NetState {
  status: ChannelStatus
  hostPhase: Phase | null
  welcomed: boolean
  color: string | null
  me: MeState
  result: 'VICTORY' | 'DEFEAT' | null
  ranking: RankedPlayer[] | null
}

const ALIVE_ME: MeState = { hp: PLAYER_HP, alive: true, respawnAt: null, connected: true }

const INITIAL: NetState = {
  status: 'disabled',
  hostPhase: null,
  welcomed: false,
  color: null,
  me: ALIVE_ME,
  result: null,
  ranking: null,
}

/** Minimum gap between SNAPSHOT-triggered JOIN re-sends (the snapshot itself is ~1Hz). */
const JOIN_RESEND_MIN_MS = 1500

const isPostGame = (p: Phase | null): boolean =>
  p === 'VICTORY' || p === 'DEFEAT' || p === 'PODIUM' || p === 'RESULTS'

const isPreOrInGame = (p: Phase): boolean => p === 'LOBBY' || p === 'COUNTDOWN' || p === 'PLAYING'

function meFromNet(ps: PlayerNetState): MeState {
  const alive = Boolean(ps.alive)
  const hp = typeof ps.hp === 'number' && Number.isFinite(ps.hp) ? ps.hp : alive ? PLAYER_HP : 0
  const respawnAt = !alive && typeof ps.respawnInMs === 'number' ? Date.now() + Math.max(0, ps.respawnInMs) : null
  return { hp, alive, respawnAt, connected: ps.connected !== false }
}

/** A new round started (or the host went back to the lobby): forget the previous game. */
function freshRound(s: NetState, phase: Phase): NetState {
  return { ...s, hostPhase: phase, result: null, ranking: null, me: ALIVE_ME }
}

export function usePlayerChannel(roomId: string, playerId: string, name: string | null): PlayerChannel {
  const [net, setNet] = useState<NetState>(INITIAL)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!supabase || !name || !roomId || !playerId) {
      channelRef.current = null
      setNet((s) => ({ ...s, status: 'disabled' }))
      return
    }
    const client = supabase
    const myName = name

    let disposed = false
    let channel: RealtimeChannel | null = null
    let retryTimer: number | null = null
    let attempts = 0
    let lastJoinAt = 0

    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const sendJoin = (force: boolean) => {
      const ch = channel
      if (!ch || ch.state !== 'joined') return
      const now = Date.now()
      if (!force && now - lastJoinAt < JOIN_RESEND_MIN_MS) return
      lastJoinAt = now
      const payload: JoinPayload = { playerId, name: myName }
      try {
        void ch.send({ type: 'broadcast', event: EVT.JOIN, payload })
      } catch {
        /* not joined yet; the next SUBSCRIBED / SNAPSHOT will retry */
      }
    }

    const teardownChannel = () => {
      const ch = channel
      channel = null
      channelRef.current = null
      if (ch) {
        try {
          void client.removeChannel(ch)
        } catch {
          /* ignore */
        }
      }
    }

    const scheduleRecreate = (delayMs: number) => {
      if (disposed || retryTimer !== null) return
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        if (disposed) return
        teardownChannel()
        connect()
      }, delayMs)
    }

    // ---- incoming events ----------------------------------------------------------------------

    const onPhase = (p: PhasePayload) => {
      if (!p || typeof p.phase !== 'string') return
      setNet((s) => {
        if ((p.phase === 'COUNTDOWN' || p.phase === 'LOBBY') && s.hostPhase !== p.phase) return freshRound(s, p.phase)
        return { ...s, hostPhase: p.phase }
      })
    }

    const onSnapshot = (p: SnapshotPayload) => {
      if (!p || typeof p.phase !== 'string') return
      const mine = p.players ? p.players[playerId] : undefined
      // Self-healing handshake: the host does not know us while a game can still be joined.
      if (!mine && isPreOrInGame(p.phase)) sendJoin(false)
      setNet((s) => {
        let next: NetState =
          (p.phase === 'COUNTDOWN' || p.phase === 'LOBBY') && s.hostPhase !== p.phase
            ? freshRound(s, p.phase)
            : { ...s, hostPhase: p.phase }
        if (mine) next = { ...next, me: meFromNet(mine) }
        if (p.result && Array.isArray(p.ranking) && isPostGame(p.phase)) {
          next = { ...next, result: p.result, ranking: p.ranking }
        }
        return next
      })
    }

    const onPlayerState = (p: PlayerStatePayload) => {
      const mine = p && p.players ? p.players[playerId] : undefined
      if (!mine) return
      setNet((s) => ({ ...s, me: meFromNet(mine) }))
    }

    const onGameOver = (p: GameOverPayload) => {
      if (!p || (p.result !== 'VICTORY' && p.result !== 'DEFEAT')) return
      setNet((s) => ({
        ...s,
        result: p.result,
        ranking: Array.isArray(p.ranking) ? p.ranking : s.ranking,
        // PHASE normally arrives first; if not, GAME_OVER itself proves the fight is over.
        hostPhase: isPostGame(s.hostPhase) ? s.hostPhase : p.result,
      }))
    }

    const onReset = () => {
      setNet((s) => freshRound(s, 'LOBBY'))
    }

    const onWelcome = (p: WelcomePayload) => {
      if (!p || p.playerId !== playerId) return
      setNet((s) => ({
        ...s,
        welcomed: true,
        color: typeof p.color === 'string' && p.color ? p.color : s.color,
        hostPhase: typeof p.phase === 'string' ? p.phase : s.hostPhase,
      }))
    }

    // ---- channel lifecycle ---------------------------------------------------------------------

    const connect = () => {
      if (disposed) return
      attempts += 1
      setNet((s) => ({ ...s, status: 'connecting' }))

      const ch = client.channel(channelNameFor(roomId), {
        config: { presence: { key: playerId }, broadcast: { self: false, ack: false } },
      })
      channel = ch
      channelRef.current = ch

      ch.on('broadcast', { event: EVT.PHASE }, (msg) => onPhase(msg.payload as PhasePayload))
      ch.on('broadcast', { event: EVT.SNAPSHOT }, (msg) => onSnapshot(msg.payload as SnapshotPayload))
      ch.on('broadcast', { event: EVT.PLAYER_STATE }, (msg) => onPlayerState(msg.payload as PlayerStatePayload))
      ch.on('broadcast', { event: EVT.GAME_OVER }, (msg) => onGameOver(msg.payload as GameOverPayload))
      ch.on('broadcast', { event: EVT.RESET }, () => onReset())
      ch.on('broadcast', { event: EVT.WELCOME }, (msg) => onWelcome(msg.payload as WelcomePayload))

      ch.subscribe((status) => {
        if (disposed || channel !== ch) return
        if (status === 'SUBSCRIBED') {
          attempts = 0
          clearRetry()
          setNet((s) => ({ ...s, status: 'connected' }))
          const meta: PresenceMeta = { role: 'player', playerId, name: myName, joinedAt: Date.now() }
          try {
            void ch.track(meta)
          } catch {
            /* ignore */
          }
          sendJoin(true)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setNet((s) => ({ ...s, status: 'error' }))
          // realtime-js retries by itself while the socket is alive; hard-reset if that stalls.
          scheduleRecreate(Math.min(15000, 3000 * 2 ** Math.min(attempts - 1, 2)))
        } else if (status === 'CLOSED') {
          setNet((s) => ({ ...s, status: 'error' }))
          scheduleRecreate(Math.min(8000, 800 * 2 ** Math.min(attempts - 1, 3)))
        }
      })
    }

    connect()

    return () => {
      disposed = true
      clearRetry()
      teardownChannel()
    }
  }, [roomId, playerId, name])

  const sendInput = useCallback(
    (state: InputState) => {
      const ch = channelRef.current
      if (!ch || ch.state !== 'joined') return
      const payload: InputPayload = {
        p: playerId,
        l: state.l ? 1 : 0,
        r: state.r ? 1 : 0,
        f: state.f ? 1 : 0,
        s: state.s,
        t: Date.now(),
      }
      try {
        void ch.send({ type: 'broadcast', event: EVT.INPUT, payload })
      } catch {
        /* channel not joined; heartbeat / next change will retry */
      }
    },
    [playerId],
  )

  return {
    status: net.status,
    hostPhase: net.hostPhase,
    welcomed: net.welcomed,
    color: net.color,
    me: net.me,
    result: net.result,
    ranking: net.ranking,
    sendInput,
  }
}
