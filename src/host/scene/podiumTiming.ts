/**
 * Shared podium constants: layout, medal colors, reveal timeline (seconds since PODIUM began),
 * easing helpers and the podium clock. Everything on the stage is driven from `podiumT()`.
 */
import { getWorld } from '../../game/store'

export type PodiumRank = 1 | 2 | 3

export interface RankSlot {
  rank: PodiumRank
  /** x position of the block center (camera looks down -Z, so x is left -> right) */
  x: number
  /** block height */
  height: number
  /** medal color: gold / silver-blue / bronze */
  color: string
}

export const BLOCK_SIZE = 2.6
export const SLOTS: RankSlot[] = [
  { rank: 1, x: 0, height: 2.4, color: '#ffd23f' },
  { rank: 2, x: -3.2, height: 1.6, color: '#9fd8ff' },
  { rank: 3, x: 3.2, height: 1.0, color: '#ff8a3d' },
]

// ---- Timeline (seconds) ----
export const REVEAL_AT: Record<PodiumRank, number> = { 3: 0.6, 2: 3.0, 1: 6.5 }
export const BLOCK_RISE_S = 0.7
/** the fighter starts dropping a beat after the block starts rising */
export const FIGHTER_DROP_DELAY_S = 0.25
export const FIGHTER_DROP_S = 0.6
export const DRUMROLL_START = 5.5
export const DRUMROLL_END = 6.5
export const CONFETTI_AT = 6.8
export const CONFETTI_REBURST_EVERY_S = 5
export const CONFETTI_LIFETIME_S = 7
/** by this time every rank is on stage (used when the host skips straight to RESULTS) */
export const FULLY_REVEALED_T = 9

export function landedAt(rank: PodiumRank): number {
  return REVEAL_AT[rank] + FIGHTER_DROP_DELAY_S + FIGHTER_DROP_S
}

// ---- Easing ----
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 0..1 progress of a segment starting at `start` lasting `dur` seconds. */
export const seg = (t: number, start: number, dur: number): number => clamp01((t - start) / dur)

export const easeOutCubic = (u: number): number => 1 - Math.pow(1 - u, 3)

export function easeOutBack(u: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2)
}

export function easeOutBounce(u: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (u < 1 / d1) return n1 * u * u
  if (u < 2 / d1) return n1 * (u -= 1.5 / d1) * u + 0.75
  if (u < 2.5 / d1) return n1 * (u -= 2.25 / d1) * u + 0.9375
  return n1 * (u -= 2.625 / d1) * u + 0.984375
}

// ---- Clock ----
// One module-level clock so every stage component agrees on `t` without prop drilling or
// useFrame ordering concerns. PodiumStage resets it on mount/unmount.
let startedAt: number | null = null

export function resetPodiumClock(): void {
  startedAt = null
}

/**
 * Seconds since the PODIUM phase began (host clock). When the phase is RESULTS and the reveal
 * has not finished (host skipped ahead), the clock jumps forward once so everything is revealed,
 * then keeps advancing smoothly so celebrations continue.
 */
export function podiumT(): number {
  const w = getWorld()
  if (startedAt === null) {
    startedAt = w.phase === 'PODIUM' ? w.phaseStartedAt : w.now - FULLY_REVEALED_T * 1000
  }
  let t = (w.now - startedAt) / 1000
  if (w.phase === 'RESULTS' && t < FULLY_REVEALED_T) {
    startedAt = w.now - FULLY_REVEALED_T * 1000
    t = FULLY_REVEALED_T
  }
  return t < 0 ? 0 : t
}
