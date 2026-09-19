/** Bright, distinct neon colors for fighters. Index wraps. */
export const PLAYER_COLORS = [
  '#00f0ff', // cyan
  '#ff2bd6', // magenta
  '#39ff14', // green
  '#ffe600', // yellow
  '#ff8a00', // orange
  '#7b61ff', // violet
  '#ff4f8b', // pink
  '#00ffb3', // mint
  '#4dc9ff', // sky
  '#ff5e3a', // coral
  '#c6ff00', // lime
  '#ff9de2', // light pink
  '#00c2ff', // azure
  '#ffb700', // amber
  '#b3ff66', // pale green
  '#ff6ec7', // hot pink
  '#66fff2', // aqua
  '#ffd166', // gold
  '#9d4edd', // purple
  '#f15bb5', // rose
]

export function colorForIndex(i: number): string {
  return PLAYER_COLORS[((i % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length]
}

export const CODEX_RED = '#ff2a2a'
export const FIREBALL_ORANGE = '#ffa726'
