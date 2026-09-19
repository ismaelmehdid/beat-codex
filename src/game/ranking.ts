import type { RankedPlayer } from '../lib/protocol'
import type { Player } from './types'

/** Highest damage first, then fewer deaths, then earliest joiner, then id (fully deterministic). */
export function rankPlayers(players: Player[]): RankedPlayer[] {
  const sorted = [...players].sort((a, b) => {
    if (b.damageDealt !== a.damageDealt) return b.damageDealt - a.damageDealt
    if (a.deaths !== b.deaths) return a.deaths - b.deaths
    if (a.index !== b.index) return a.index - b.index
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return sorted.map((p, i) => ({
    rank: i + 1,
    playerId: p.id,
    name: p.name,
    color: p.color,
    damageDealt: Math.round(p.damageDealt),
    deaths: p.deaths,
    shotsFired: p.shotsFired,
  }))
}
