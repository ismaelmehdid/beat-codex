/**
 * Authoritative game simulation. Pure-ish: mutates the GameState passed in, no React, no network.
 * All times are host clock ms (performance.now()). The host loop calls `step` every frame.
 */
import { colorForIndex, CODEX_RED, FIREBALL_ORANGE } from '../lib/colors'
import * as C from './constants'
import { rankPlayers } from './ranking'
import type { Boss, FxEvent, FxType, GameResult, GameState, Phase, Player, Projectile } from './types'

let nextProjectileId = 1
let nextFxId = 1

// ------------------------------------------------------------------------------------------------
// Construction / reset
// ------------------------------------------------------------------------------------------------

function createBoss(maxHp: number, attackIntervalMs: number): Boss {
  return {
    hp: maxHp,
    maxHp,
    attackIntervalMs,
    x: C.BOSS_X,
    y: C.BOSS_Y,
    z: C.BOSS_Z,
    nextAttackAt: 0,
    hitFlashUntil: 0,
    lastAttackAt: 0,
    dead: false,
    deathStartedAt: null,
  }
}

export function createInitialState(roomId: string): GameState {
  return {
    roomId,
    phase: 'LOBBY',
    phaseStartedAt: 0,
    players: {},
    playerOrder: [],
    projectiles: [],
    boss: createBoss(C.bossHpFor(0), C.bossAttackIntervalFor(0)),
    teamLives: C.teamLivesFor(0),
    maxTeamLives: C.teamLivesFor(0),
    result: null,
    ranking: [],
    fx: [],
    shake: 0,
    netEvents: [],
    tick: 0,
    now: 0,
    emptySince: null,
    bossPaused: false,
  }
}

function setPhase(state: GameState, phase: Phase, now: number): void {
  state.phase = phase
  state.phaseStartedAt = now
  state.netEvents.push({ type: 'PHASE' })
}

function pushFx(state: GameState, type: FxType, x: number, y: number, z: number, extra?: Partial<FxEvent>): void {
  state.fx.push({ id: nextFxId++, type, x, y, z, t: state.now, ...extra })
}

function addShake(state: GameState, amount: number): void {
  state.shake = Math.min(1, state.shake + amount)
}

// ------------------------------------------------------------------------------------------------
// Players
// ------------------------------------------------------------------------------------------------

export function connectedPlayers(state: GameState): Player[] {
  return state.playerOrder.map((id) => state.players[id]).filter((p) => p && p.connected)
}

export function allPlayers(state: GameState): Player[] {
  return state.playerOrder.map((id) => state.players[id]).filter(Boolean)
}

export function connectedPlayerCount(state: GameState): number {
  return connectedPlayers(state).length
}

function placeAtSpawn(p: Player): void {
  p.x = C.spawnXForIndex(p.index)
  p.z = C.zForIndex(p.index)
  p.vx = 0
  p.facing = 1
}

function clearInput(p: Player, now: number): void {
  p.input.left = false
  p.input.right = false
  p.input.fire = false
  p.input.updatedAt = now
  p.pendingShots = 0
}

/** Adds a player (or reconnects/renames an existing one). Safe to call repeatedly. */
export function addPlayer(state: GameState, id: string, name: string, opts: { isFake?: boolean } = {}): Player {
  const now = state.now
  const existing = state.players[id]
  if (existing) {
    existing.name = name || existing.name
    if (!existing.connected) {
      existing.connected = true
      clearInput(existing, now)
      state.netEvents.push({ type: 'PLAYER_STATE', playerId: id })
    }
    return existing
  }
  // Indices drive color, depth lane and spawn x, so they must be unique among *present* players.
  // playerOrder.length would recycle an index after a lobby leave and overlap two fighters exactly.
  const used = new Set(allPlayers(state).map((q) => q.index))
  let index = 0
  while (used.has(index)) index++
  const p: Player = {
    id,
    name,
    color: colorForIndex(index),
    index,
    joinedAt: now,
    hp: C.PLAYER_HP,
    alive: true,
    connected: true,
    isFake: Boolean(opts.isFake),
    x: 0,
    z: 0,
    vx: 0,
    facing: 1,
    damageDealt: 0,
    deaths: 0,
    shotsFired: 0,
    lastFireTime: -Infinity,
    respawnAt: null,
    diedAt: null,
    lastHitAt: -Infinity,
    input: { left: false, right: false, fire: false, updatedAt: now },
    lastFireSeq: null,
    pendingShots: 0,
  }
  placeAtSpawn(p)
  state.players[id] = p
  state.playerOrder = [...state.playerOrder, id]
  // Late joiner mid-fight: the boss does not scale up (fair to the team), they just jump in.
  if (state.phase === 'PLAYING') pushFx(state, 'respawn', p.x, 0.5, p.z, { color: p.color, playerId: id })
  state.netEvents.push({ type: 'PLAYER_STATE', playerId: id })
  return p
}

/** Presence left. In the lobby the player is removed; mid-game they are frozen + untargetable. */
export function setPlayerConnected(state: GameState, id: string, connected: boolean): void {
  const p = state.players[id]
  if (!p) return
  if (connected) {
    if (!p.connected) {
      p.connected = true
      clearInput(p, state.now)
      state.netEvents.push({ type: 'PLAYER_STATE', playerId: id })
    }
    return
  }
  clearInput(p, state.now)
  p.connected = false
  if (state.phase === 'LOBBY' || state.phase === 'RESULTS') removePlayer(state, id)
}

export function removePlayer(state: GameState, id: string): void {
  if (!state.players[id]) return
  delete state.players[id]
  state.playerOrder = state.playerOrder.filter((x) => x !== id)
  state.projectiles = state.projectiles.filter((pr) => pr.ownerPlayerId !== id && pr.targetPlayerId !== id)
}

/** Full input state from a phone. `fireSeq` increments on every FIRE tap so taps are never lost. */
export function applyInput(
  state: GameState,
  id: string,
  input: { left: boolean; right: boolean; fire: boolean; fireSeq?: number },
): void {
  const p = state.players[id]
  if (!p) return
  const now = state.now
  p.input.left = input.left
  p.input.right = input.right
  p.input.fire = input.fire
  p.input.updatedAt = now
  if (typeof input.fireSeq === 'number') {
    // Strictly greater: a *decrease* means the phone remounted (its counter restarted at 0), so
    // rebase silently instead of spawning a phantom fireball on the first input of a new round.
    if (p.lastFireSeq !== null && input.fireSeq > p.lastFireSeq) p.pendingShots = 1
    p.lastFireSeq = input.fireSeq
  }
  if (!p.connected) {
    p.connected = true
    state.netEvents.push({ type: 'PLAYER_STATE', playerId: id })
  }
}

/** Explicit single fire intent (debug keyboard, or a dedicated tap message). Cooldown still enforced. */
export function fireIntent(state: GameState, id: string): void {
  const p = state.players[id]
  if (!p) return
  p.pendingShots = 1
  p.input.updatedAt = state.now
}

// ------------------------------------------------------------------------------------------------
// Phase control (host actions)
// ------------------------------------------------------------------------------------------------

function resetCombatStats(state: GameState): void {
  for (const p of allPlayers(state)) {
    p.hp = C.PLAYER_HP
    p.alive = true
    p.damageDealt = 0
    p.deaths = 0
    p.shotsFired = 0
    p.lastFireTime = -Infinity
    p.respawnAt = null
    p.diedAt = null
    p.lastHitAt = -Infinity
    p.pendingShots = 0
    clearInput(p, state.now)
    placeAtSpawn(p)
  }
  state.projectiles = []
  state.fx = []
  state.shake = 0
  state.result = null
  state.ranking = []
  state.emptySince = null
}

/** START pressed. Works from LOBBY or RESULTS. */
export function startCountdown(state: GameState, now: number): void {
  state.now = now
  // Drop players who left during the lobby/results so they don't haunt the arena.
  for (const p of allPlayers(state)) if (!p.connected) removePlayer(state, p.id)
  const n = connectedPlayerCount(state)
  const maxHp = C.bossHpFor(n)
  state.boss = createBoss(maxHp, C.bossAttackIntervalFor(n))
  state.teamLives = C.teamLivesFor(n)
  state.maxTeamLives = state.teamLives
  resetCombatStats(state)
  setPhase(state, 'COUNTDOWN', now)
}

function beginPlaying(state: GameState, now: number): void {
  setPhase(state, 'PLAYING', now)
  state.boss.nextAttackAt = now + C.BOSS_FIRST_ATTACK_DELAY_MS
  for (const p of allPlayers(state)) clearInput(p, now)
}

/** PLAY AGAIN pressed (or host wants back to lobby). Keeps connected players, resets everything else. */
export function resetToLobby(state: GameState, now: number): void {
  state.now = now
  for (const p of allPlayers(state)) if (!p.connected) removePlayer(state, p.id)
  const n = connectedPlayerCount(state)
  state.boss = createBoss(C.bossHpFor(n), C.bossAttackIntervalFor(n))
  state.teamLives = C.teamLivesFor(n)
  state.maxTeamLives = state.teamLives
  resetCombatStats(state)
  setPhase(state, 'LOBBY', now)
  state.netEvents.push({ type: 'RESET' })
}

/** Host skip: jump from VICTORY/DEFEAT/PODIUM straight to RESULTS. */
export function skipToResults(state: GameState, now: number): void {
  if (state.phase === 'VICTORY' || state.phase === 'DEFEAT' || state.phase === 'PODIUM') {
    setPhase(state, 'RESULTS', now)
  }
}

// ------------------------------------------------------------------------------------------------
// Combat helpers
// ------------------------------------------------------------------------------------------------

function finishGame(state: GameState, result: GameResult, now: number): void {
  state.result = result
  state.ranking = rankPlayers(allPlayers(state))
  state.projectiles = []
  for (const p of allPlayers(state)) clearInput(p, now)
  if (result === 'VICTORY') {
    state.boss.dead = true
    state.boss.deathStartedAt = now
    state.boss.hp = 0
    pushFx(state, 'boss_death', state.boss.x, state.boss.y, state.boss.z)
    addShake(state, 1)
    setPhase(state, 'VICTORY', now)
  } else {
    addShake(state, 0.6)
    setPhase(state, 'DEFEAT', now)
  }
  state.netEvents.push({ type: 'GAME_OVER' })
}

/** Apply damage to CODEX. Attributes the *actual* damage (capped at remaining hp) to the player. */
export function damageBoss(state: GameState, amount: number, byPlayerId: string | null, at?: { x: number; y: number; z: number }): void {
  if (state.phase !== 'PLAYING' || state.boss.dead) return
  const before = state.boss.hp
  const actual = Math.max(0, Math.min(amount, before))
  state.boss.hp = before - actual
  state.boss.hitFlashUntil = state.now + 90
  const p = byPlayerId ? state.players[byPlayerId] : undefined
  if (p) p.damageDealt += actual
  const pos = at ?? { x: state.boss.x - C.BOSS_CORE_SIZE / 2, y: state.boss.y, z: state.boss.z }
  pushFx(state, 'boss_hit', pos.x, pos.y, pos.z, { color: p?.color ?? FIREBALL_ORANGE, playerId: byPlayerId ?? undefined })
  pushFx(state, 'damage_number', pos.x, pos.y + 0.5, pos.z, { value: actual, color: p?.color ?? FIREBALL_ORANGE, playerId: byPlayerId ?? undefined })
  addShake(state, 0.06)
  if (state.boss.hp <= 0) finishGame(state, 'VICTORY', state.now)
}

export function damagePlayer(state: GameState, id: string, amount: number, at?: { x: number; y: number; z: number }): void {
  if (state.phase !== 'PLAYING') return
  const p = state.players[id]
  if (!p || !p.alive) return
  p.hp = Math.max(0, p.hp - amount)
  p.lastHitAt = state.now
  pushFx(state, 'player_hit', at?.x ?? p.x, at?.y ?? 1, at?.z ?? p.z, { color: p.color, playerId: id, value: amount })
  addShake(state, 0.12)
  state.netEvents.push({ type: 'PLAYER_STATE', playerId: id })
  if (p.hp <= 0) killPlayer(state, id)
}

/** Kill a player outright (hp -> 0). Consumes a team life. */
export function killPlayer(state: GameState, id: string): void {
  if (state.phase !== 'PLAYING') return
  const p = state.players[id]
  if (!p || !p.alive) return
  const now = state.now
  p.hp = 0
  p.alive = false
  p.deaths += 1
  p.diedAt = now
  p.respawnAt = now + C.RESPAWN_DELAY_MS
  clearInput(p, now)
  state.teamLives = Math.max(0, state.teamLives - 1)
  pushFx(state, 'player_death', p.x, 1, p.z, { color: p.color, playerId: id })
  addShake(state, 0.35)
  state.netEvents.push({ type: 'PLAYER_STATE', playerId: id })
  if (state.teamLives <= 0) finishGame(state, 'DEFEAT', now)
}

function respawnPlayer(state: GameState, p: Player): void {
  p.hp = C.PLAYER_HP
  p.alive = true
  p.respawnAt = null
  placeAtSpawn(p)
  clearInput(p, state.now)
  pushFx(state, 'respawn', p.x, 0.5, p.z, { color: p.color, playerId: p.id })
  state.netEvents.push({ type: 'PLAYER_STATE', playerId: p.id })
}

function spawnFireball(state: GameState, p: Player): void {
  const now = state.now
  const sx = p.x + 0.9
  const sy = C.FIREBALL_SPAWN_Y
  const sz = p.z
  // Aim at the boss core (slightly randomized so a crowd's shots fan out across the boss face).
  const tx = state.boss.x
  const ty = state.boss.y + (Math.random() - 0.5) * 3
  const tz = state.boss.z + (Math.random() - 0.5) * 3
  const dx = tx - sx
  const dy = ty - sy
  const dz = tz - sz
  const len = Math.hypot(dx, dy, dz) || 1
  const s = C.FIREBALL_SPEED / len
  state.projectiles.push({
    id: nextProjectileId++,
    kind: 'player',
    ownerPlayerId: p.id,
    targetPlayerId: null,
    x: sx,
    y: sy,
    z: sz,
    vx: dx * s,
    vy: dy * s,
    vz: dz * s,
    radius: C.FIREBALL_RADIUS,
    damage: C.FIREBALL_DAMAGE,
    bornAt: now,
    color: p.color,
  })
  p.lastFireTime = now
  p.shotsFired += 1
  p.pendingShots = 0
  p.facing = 1
  pushFx(state, 'fire', sx, sy, sz, { color: p.color, playerId: p.id })
}

function bossAttack(state: GameState): void {
  const now = state.now
  const targets = connectedPlayers(state).filter((p) => p.alive)
  if (targets.length === 0) {
    state.boss.nextAttackAt = now + 500
    return
  }
  const target = targets[Math.floor(Math.random() * targets.length)]
  const sx = state.boss.x - C.BOSS_CORE_SIZE / 2
  const sy = state.boss.y
  const sz = state.boss.z
  // Aim at where the target stands now (+ a little lead), so moving dodges it.
  const tx = target.x + target.vx * 0.35
  const ty = 0.9
  const tz = target.z
  const dx = tx - sx
  const dy = ty - sy
  const dz = tz - sz
  const len = Math.hypot(dx, dy, dz) || 1
  const s = C.BOSS_PROJECTILE_SPEED / len
  state.projectiles.push({
    id: nextProjectileId++,
    kind: 'boss',
    ownerPlayerId: null,
    targetPlayerId: target.id,
    x: sx,
    y: sy,
    z: sz,
    vx: dx * s,
    vy: dy * s,
    vz: dz * s,
    radius: C.BOSS_PROJECTILE_RADIUS,
    damage: C.BOSS_PROJECTILE_DAMAGE,
    bornAt: now,
    color: CODEX_RED,
  })
  state.boss.lastAttackAt = now
  state.boss.nextAttackAt = now + state.boss.attackIntervalMs
  pushFx(state, 'boss_fire', sx, sy, sz, { color: CODEX_RED, playerId: target.id })
  addShake(state, 0.05)
}

function explodeBossProjectile(state: GameState, pr: Projectile): void {
  pushFx(state, 'boss_impact', pr.x, Math.max(0.2, pr.y), pr.z, { color: CODEX_RED })
  addShake(state, 0.15)
  // Splash: anyone standing close takes the hit.
  for (const p of connectedPlayers(state)) {
    if (!p.alive) continue
    const d = Math.hypot(p.x - pr.x, p.z - pr.z)
    if (d <= C.BOSS_PROJECTILE_SPLASH_RADIUS) damagePlayer(state, p.id, pr.damage, { x: p.x, y: 1, z: p.z })
    if (state.phase !== 'PLAYING') return
  }
}

// ------------------------------------------------------------------------------------------------
// Simulation
// ------------------------------------------------------------------------------------------------

function simulatePlaying(state: GameState, dt: number): void {
  const now = state.now

  // Everyone's phone died or walked out: end the round instead of hanging on this screen forever.
  if (connectedPlayerCount(state) === 0) {
    if (state.emptySince === null) state.emptySince = now
    else if (now - state.emptySince >= C.EMPTY_ROOM_ABORT_MS) {
      finishGame(state, 'DEFEAT', now)
      return
    }
  } else if (state.emptySince !== null) {
    state.emptySince = null
  }

  for (const p of allPlayers(state)) {
    // Stuck-input safety: no fresh update for a while -> release everything.
    if (now - p.input.updatedAt > C.INPUT_TIMEOUT_MS && (p.input.left || p.input.right || p.input.fire)) {
      p.input.left = false
      p.input.right = false
      p.input.fire = false
    }

    if (!p.alive) {
      p.vx = 0
      if (p.respawnAt !== null && now >= p.respawnAt) respawnPlayer(state, p)
      continue
    }

    if (!p.connected) {
      p.vx = 0
      continue
    }

    const dir = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0)
    p.vx = dir * C.PLAYER_SPEED
    if (dir !== 0) {
      p.x = Math.min(C.PLAYER_MAX_X, Math.max(C.PLAYER_MIN_X, p.x + p.vx * dt))
      p.facing = dir > 0 ? 1 : -1
    }

    const wantsFire = p.pendingShots > 0 || p.input.fire
    if (wantsFire && now - p.lastFireTime >= C.FIRE_COOLDOWN_MS) spawnFireball(state, p)
  }

  if (state.bossPaused) state.boss.nextAttackAt = now + state.boss.attackIntervalMs
  else if (now >= state.boss.nextAttackAt) bossAttack(state)

  // Projectiles
  const survivors: Projectile[] = []
  for (const pr of state.projectiles) {
    if (state.phase !== 'PLAYING') break
    pr.x += pr.vx * dt
    pr.y += pr.vy * dt
    pr.z += pr.vz * dt
    const age = now - pr.bornAt

    if (pr.kind === 'player') {
      const b = state.boss
      const d = Math.hypot(pr.x - b.x, pr.y - b.y, pr.z - b.z)
      if (d <= C.BOSS_HIT_RADIUS + pr.radius) {
        damageBoss(state, pr.damage, pr.ownerPlayerId, { x: pr.x, y: pr.y, z: pr.z })
        continue
      }
      if (age > C.FIREBALL_MAX_AGE_MS || pr.x > C.BOSS_X + 8) continue
      survivors.push(pr)
      continue
    }

    // boss projectile
    let hit = false
    for (const p of connectedPlayers(state)) {
      if (!p.alive) continue
      const dx = p.x - pr.x
      const dy = C.PLAYER_HEIGHT / 2 - pr.y
      const dz = p.z - pr.z
      const d = Math.hypot(dx, dy * 0.6, dz)
      if (d <= pr.radius + C.PLAYER_RADIUS) {
        hit = true
        break
      }
    }
    if (hit || pr.y <= 0.15) {
      explodeBossProjectile(state, pr)
      continue
    }
    if (age > C.BOSS_PROJECTILE_MAX_AGE_MS || pr.x < C.PLAYER_MIN_X - 6) continue
    survivors.push(pr)
  }
  if (state.phase === 'PLAYING') state.projectiles = survivors
}

/** Advance the world. `now` = performance.now(), `dt` seconds (clamped by the caller). */
export function step(state: GameState, now: number, dt: number): void {
  state.now = now
  state.tick += 1

  switch (state.phase) {
    case 'COUNTDOWN':
      if (now - state.phaseStartedAt >= C.COUNTDOWN_MS) beginPlaying(state, now)
      break
    case 'PLAYING':
      simulatePlaying(state, dt)
      break
    case 'VICTORY':
      if (now - state.phaseStartedAt >= C.VICTORY_DURATION_MS) setPhase(state, 'PODIUM', now)
      break
    case 'DEFEAT':
      if (now - state.phaseStartedAt >= C.DEFEAT_DURATION_MS) setPhase(state, 'PODIUM', now)
      break
    case 'PODIUM':
      if (now - state.phaseStartedAt >= C.PODIUM_DURATION_MS) setPhase(state, 'RESULTS', now)
      break
    case 'LOBBY':
    case 'RESULTS':
      break
  }

  // Decay shake, purge old FX.
  state.shake *= Math.exp(-dt * 5)
  if (state.shake < 0.001) state.shake = 0
  if (state.fx.length) {
    const cutoff = now - C.FX_TTL_MS
    state.fx = state.fx.filter((f) => f.t >= cutoff)
  }
}

// ------------------------------------------------------------------------------------------------
// Debug helpers
// ------------------------------------------------------------------------------------------------

export function forceVictory(state: GameState, now: number): void {
  state.now = now
  if (state.phase === 'PLAYING') finishGame(state, 'VICTORY', now)
}

export function forceDefeat(state: GameState, now: number): void {
  state.now = now
  if (state.phase === 'PLAYING') finishGame(state, 'DEFEAT', now)
}

/** Drive fake players with a tiny AI: wander and fire. Call from the host loop in debug mode. */
export function driveFakePlayers(state: GameState): void {
  if (state.phase !== 'PLAYING') return
  const now = state.now
  for (const p of allPlayers(state)) {
    if (!p.isFake || !p.alive) continue
    // Change direction occasionally; keep inputs fresh so the timeout never trips.
    if (Math.random() < 0.02) {
      const r = Math.random()
      p.input.left = r < 0.3
      p.input.right = r > 0.7
    }
    p.input.fire = Math.random() < 0.85
    p.input.updatedAt = now
  }
}
