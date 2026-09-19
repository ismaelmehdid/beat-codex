import type { RankedPlayer } from '../lib/protocol'

export type Phase = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'VICTORY' | 'DEFEAT' | 'PODIUM' | 'RESULTS'

export type GameResult = 'VICTORY' | 'DEFEAT'

export interface PlayerInput {
  left: boolean
  right: boolean
  fire: boolean
  /** host clock (performance.now) of the last valid update; used for the stuck-input timeout */
  updatedAt: number
}

export interface Player {
  id: string
  name: string
  color: string
  /** stable join order, used for z lanes and deterministic tie-breaks */
  index: number
  joinedAt: number

  hp: number
  alive: boolean
  connected: boolean
  isFake: boolean

  x: number
  z: number
  vx: number
  facing: 1 | -1

  damageDealt: number
  deaths: number
  shotsFired: number
  lastFireTime: number
  /** set when dead: host clock at which the player respawns */
  respawnAt: number | null
  /** host clock when the player last died (for death FX) */
  diedAt: number | null
  /** host clock when the player last took damage (for hit flash) */
  lastHitAt: number

  input: PlayerInput
  /** last fire tap sequence number seen from the phone; null until first INPUT */
  lastFireSeq: number | null
  /** a tap was received while on cooldown: fire as soon as possible */
  pendingShots: number
}

export type ProjectileKind = 'player' | 'boss'

export interface Projectile {
  id: number
  kind: ProjectileKind
  ownerPlayerId: string | null
  targetPlayerId: string | null
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  radius: number
  damage: number
  bornAt: number
  color: string
}

export interface Boss {
  hp: number
  maxHp: number
  /** ms between attacks, chosen from the player count when the round starts */
  attackIntervalMs: number
  x: number
  y: number
  z: number
  nextAttackAt: number
  /** host clock until which the boss shows its hit flash */
  hitFlashUntil: number
  /** host clock of the last attack (for charge/recoil animation) */
  lastAttackAt: number
  dead: boolean
  deathStartedAt: number | null
}

export type FxType =
  | 'fire' // player launched a fireball
  | 'boss_hit' // fireball hit the boss
  | 'damage_number' // floating damage number (value)
  | 'boss_fire' // boss launched a projectile
  | 'boss_impact' // boss projectile exploded (ground or player)
  | 'player_hit' // player took damage
  | 'player_death' // player exploded
  | 'respawn' // player respawned
  | 'boss_death' // boss started its death sequence

export interface FxEvent {
  id: number
  type: FxType
  x: number
  y: number
  z: number
  t: number // host clock when emitted
  value?: number
  color?: string
  playerId?: string
}

/** Events for the host network layer to broadcast; drained every tick. */
export type NetEvent =
  | { type: 'PHASE' }
  | { type: 'PLAYER_STATE'; playerId: string }
  | { type: 'GAME_OVER' }
  | { type: 'RESET' }

export interface GameState {
  roomId: string
  phase: Phase
  /** host clock when the current phase began */
  phaseStartedAt: number
  players: Record<string, Player>
  /** join order */
  playerOrder: string[]
  projectiles: Projectile[]
  boss: Boss
  teamLives: number
  maxTeamLives: number
  result: GameResult | null
  ranking: RankedPlayer[]
  /** transient FX events (purged after a few seconds); renderer reads and animates them */
  fx: FxEvent[]
  /** camera shake intensity 0..1, decays every step */
  shake: number
  /** pending events for the network layer */
  netEvents: NetEvent[]
  tick: number
  /** host clock of the last step */
  now: number
  /** host clock since when PLAYING has had zero connected players (null when someone is present) */
  emptySince: number | null
  /** CODEX holds fire (rehearsal / tests). Players can still shoot. */
  bossPaused: boolean
}
