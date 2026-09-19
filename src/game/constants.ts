/**
 * Arena layout (world units).
 *
 *   X is the LANE axis: the squad holds a line near -X, CODEX looms at +X, and every projectile
 *   travels along it. Players do not control X.
 *   Z is the STRAFE axis: the only axis players move on. CODEX fires straight down a lane at a
 *   fixed Z, so dodging means moving sideways.
 *
 * The camera sits behind the squad looking down the lane, which puts Z across the screen.
 */
export const FLOOR_Y = 0
/** Where the squad holds the line. */
export const PLAYER_LINE_X = -9
/** Rows of depth around the line so a crowd never overlaps exactly. */
export const PLAYER_ROWS = 3
export const PLAYER_ROW_STEP = 1.6
/** Strafe limits. */
export const PLAYER_MIN_Z = -7.5
export const PLAYER_MAX_Z = 7.5
export const PLAYER_RADIUS = 0.8
export const PLAYER_HEIGHT = 1.8
export const PLAYER_HP = 100
export const PLAYER_SPEED = 9 // units / second

export const BOSS_X = 11
export const BOSS_Y = 5.6
export const BOSS_Z = 0
// Seen down the lane, CODEX sits far from the camera, so it needs real bulk to loom.
export const BOSS_CORE_SIZE = 7.5 // edge length of the main cube
export const BOSS_HIT_RADIUS = 5.6 // sphere used for fireball collision

// ---- Combat ----
export const FIRE_COOLDOWN_MS = 450
export const FIREBALL_SPEED = 30
export const FIREBALL_DAMAGE = 10
export const FIREBALL_RADIUS = 0.35
export const FIREBALL_SPAWN_Y = 1.3
export const FIREBALL_MAX_AGE_MS = 3000

// Tuned for a ~40% shorter fight: team damage output is unchanged, so the round length
// scales directly with these two numbers.
export const BOSS_BASE_HP = 240
export const BOSS_HP_PER_PLAYER = 270
export const BOSS_ATTACK_INTERVAL_MS = 1500
export const BOSS_ATTACK_INTERVAL_MIN_MS = 900
export const BOSS_ATTACK_INTERVAL_MAX_MS = 2400
export const BOSS_FIRST_ATTACK_DELAY_MS = 2000
export const BOSS_PROJECTILE_SPEED = 10
export const BOSS_PROJECTILE_DAMAGE = 35
export const BOSS_PROJECTILE_RADIUS = 0.9
export const BOSS_PROJECTILE_SPLASH_RADIUS = 2.0
export const BOSS_PROJECTILE_MAX_AGE_MS = 6000

export const RESPAWN_DELAY_MS = 3000
/** No INPUT for this long -> release the player's controls. Must clear the phone heartbeat + jitter. */
export const INPUT_TIMEOUT_MS = 2400
/** PLAYING with nobody connected for this long ends the round instead of hanging forever. */
export const EMPTY_ROOM_ABORT_MS = 15000

// ---- Phase timings ----
export const COUNTDOWN_MS = 4000 // 3, 2, 1, BEAT CODEX!
export const VICTORY_DURATION_MS = 5500
export const DEFEAT_DURATION_MS = 4500
export const PODIUM_DURATION_MS = 14000
export const FX_TTL_MS = 3000

export function bossHpFor(playerCount: number): number {
  return BOSS_BASE_HP + Math.max(1, playerCount) * BOSS_HP_PER_PLAYER
}

export function teamLivesFor(playerCount: number): number {
  return Math.max(8, Math.max(1, playerCount) * 3)
}

/**
 * CODEX fires at one random living player, so a small squad gets focused hard while a big crowd
 * barely notices. Scale the cadence with the crowd: slow against few players, relentless against many.
 */
export function bossAttackIntervalFor(playerCount: number): number {
  const raw = 2600 - Math.max(1, playerCount) * 100
  return Math.max(BOSS_ATTACK_INTERVAL_MIN_MS, Math.min(BOSS_ATTACK_INTERVAL_MAX_MS, raw))
}

/** Fixed lane depth for a fighter: rows staggered around the line so a crowd reads as a squad. */
export function xForIndex(index: number): number {
  const row = index % PLAYER_ROWS
  const centered = row - (PLAYER_ROWS - 1) / 2
  // nudge each wrap so the 4th, 7th... fighter doesn't sit exactly on the 1st
  const wrap = Math.floor(index / PLAYER_ROWS)
  return PLAYER_LINE_X + centered * PLAYER_ROW_STEP + ((wrap % 3) - 1) * 0.45
}

/** Deterministic spread along the strafe axis so a crowd never spawns on one spot. */
export function spawnZForIndex(index: number): number {
  const span = PLAYER_MAX_Z - PLAYER_MIN_Z - 3
  const t = ((index * 5) % 13) / 13
  return PLAYER_MIN_Z + 1.5 + t * span
}
