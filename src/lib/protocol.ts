/**
 * Network protocol over ONE Supabase Realtime channel: `raid:${roomId}`.
 *
 * Presence  (join/leave + metadata only, never controls): PresenceMeta
 * Broadcast (everything else): the events below. Payloads are small and never contain
 * positions or physics state. Host time is never sent as absolute values; durations only.
 */
import type { Phase } from '../game/types'

export type Role = 'host' | 'player'

/** Presence payload tracked by every client. */
export interface PresenceMeta {
  role: Role
  playerId: string // 'host' for the host
  name: string
  joinedAt: number // client clock, informational only
}

export const EVT = {
  /** phone -> host. Handshake, also re-sent on reconnect. */
  JOIN: 'JOIN',
  /** phone -> host. Full input state (sent on every change + heartbeat while any control is held). */
  INPUT: 'INPUT',
  /** host -> all. Phase changed. */
  PHASE: 'PHASE',
  /** host -> all. Periodic (~1Hz) reliability snapshot: phase + per-player personal state. */
  SNAPSHOT: 'SNAPSHOT',
  /** host -> all. Immediate personal state change for one or more players (hit / death / respawn), batched per tick. */
  PLAYER_STATE: 'PLAYER_STATE',
  /** host -> all. Final result + ranking. */
  GAME_OVER: 'GAME_OVER',
  /** host -> all. Back to lobby / waiting state (PLAY AGAIN). */
  RESET: 'RESET',
  /** host -> one phone (by playerId filter on the phone). Confirms the host knows this player. */
  WELCOME: 'WELCOME',
} as const

export type EventName = (typeof EVT)[keyof typeof EVT]

export interface JoinPayload {
  playerId: string
  name: string
}

export interface InputPayload {
  p: string // playerId
  l: 0 | 1 // left held
  r: 0 | 1 // right held
  f: 0 | 1 // fire held
  s: number // fire tap sequence: increments on every FIRE pointerdown
  t: number // phone clock ms, informational
}

export interface PhasePayload {
  phase: Phase
  countdownMs?: number // present when phase === 'COUNTDOWN'
}

/** Personal state a phone needs to render. */
export interface PlayerNetState {
  hp: number
  alive: boolean
  respawnInMs: number | null // remaining ms until respawn while dead
  connected: boolean
}

/** Batched: only the players whose state changed this tick. Phones read `players[myId]`. */
export interface PlayerStatePayload {
  players: Record<string, PlayerNetState>
}

export interface RankedPlayer {
  rank: number
  playerId: string
  name: string
  color: string
  damageDealt: number
  deaths: number
  shotsFired: number
}

export interface SnapshotPayload {
  phase: Phase
  bossHp: number
  bossMaxHp: number
  teamLives: number
  players: Record<string, PlayerNetState>
  result?: 'VICTORY' | 'DEFEAT' | null
  ranking?: RankedPlayer[]
  /** Host-chosen minimum gap between INPUT sends for this room size. */
  inputIntervalMs?: number
}

export interface GameOverPayload {
  result: 'VICTORY' | 'DEFEAT'
  ranking: RankedPlayer[]
}

export interface WelcomePayload {
  playerId: string
  phase: Phase
  color: string
  /** Host-chosen minimum gap between INPUT sends for this room size (see inputIntervalForPlayers). */
  inputIntervalMs?: number
}

/** Phones coalesce INPUT sends to at most one per this interval (taps are never lost thanks to `s`). */
export const INPUT_SEND_MIN_INTERVAL_MS = 150
/** While any control is held, phones re-send INPUT at this interval so the host timeout never trips. */
export const INPUT_HEARTBEAT_MS = 600
/** Upper bound for the adaptive interval; must stay well under INPUT_TIMEOUT_MS. */
export const INPUT_SEND_MAX_INTERVAL_MS = 500

/**
 * Every broadcast on a shared channel costs one event per subscriber, so phone traffic grows with
 * playerCount^2. The host advertises a floor for the send interval so a big room stays inside the
 * project's events/second budget. Taps are never dropped (the `s` counter accumulates), they are
 * only delivered a little later.
 */
export function inputIntervalForPlayers(playerCount: number): number {
  if (playerCount <= 6) return INPUT_SEND_MIN_INTERVAL_MS
  return Math.min(INPUT_SEND_MAX_INTERVAL_MS, INPUT_SEND_MIN_INTERVAL_MS + (playerCount - 6) * 25)
}
