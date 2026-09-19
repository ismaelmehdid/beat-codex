// ---- Arena layout (world units). X is the gameplay axis. Players left, CODEX right. ----
export const FLOOR_Y = 0
export const PLAYER_MIN_X = -14
export const PLAYER_MAX_X = -2.5
export const PLAYER_SPAWN_X = -9
export const PLAYER_SPAWN_X_JITTER = 2.5
export const PLAYER_Z_LANES = 7 // lanes across depth
export const PLAYER_Z_STEP = 1.1
export const PLAYER_RADIUS = 0.8
export const PLAYER_HEIGHT = 1.8
export const PLAYER_HP = 100
export const PLAYER_SPEED = 9 // units / second

export const BOSS_X = 10
export const BOSS_Y = 5.5
export const BOSS_Z = 0
export const BOSS_CORE_SIZE = 6 // edge length of the main cube
export const BOSS_HIT_RADIUS = 4.6 // sphere used for fireball collision

// ---- Combat ----
export const FIRE_COOLDOWN_MS = 450
export const FIREBALL_SPEED = 30
export const FIREBALL_DAMAGE = 10
export const FIREBALL_RADIUS = 0.35
export const FIREBALL_SPAWN_Y = 1.3
export const FIREBALL_MAX_AGE_MS = 3000

export const BOSS_BASE_HP = 400
export const BOSS_HP_PER_PLAYER = 450
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

/** Deterministic depth lane so fighters stay visually distinct. */
export function zForIndex(index: number): number {
  const lane = index % PLAYER_Z_LANES
  const centered = lane - (PLAYER_Z_LANES - 1) / 2
  // alternate direction on each wrap so late joiners don't stack exactly behind early ones
  const wrap = Math.floor(index / PLAYER_Z_LANES)
  const offset = (wrap % 2 === 0 ? 1 : -1) * centered * PLAYER_Z_STEP
  return offset + (wrap * 0.35) % PLAYER_Z_STEP
}

export function spawnXForIndex(index: number): number {
  // spread spawns a little so a crowd doesn't spawn inside one another
  const t = ((index * 7) % 11) / 10 // 0..1 pseudo-random but deterministic
  return PLAYER_SPAWN_X + (t - 0.5) * 2 * PLAYER_SPAWN_X_JITTER
}
