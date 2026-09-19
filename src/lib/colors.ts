/** Claude brand orange: the body color every hacker wears. */
export const CLAUDE_ORANGE = '#D97757'
export const CLAUDE_ORANGE_DEEP = '#B85C3F'

/** Codex brand blues: base body, mid highlight, light glow. */
export const CODEX_BLUE = '#3F4BFF'
export const CODEX_BLUE_MID = '#7596FF'
export const CODEX_BLUE_LIGHT = '#ADA6FF'
/** The boss accent used by scene FX, projectiles and HUD. */
export const CODEX_ACCENT = CODEX_BLUE_MID

/**
 * Per-player accent colors. Fighters share the Claude orange body, so these drive the parts that
 * have to stay legible in a crowd of 20: visor, boots, antenna, ground ring, name label, fireballs.
 */
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

export const FIREBALL_ORANGE = '#ffa726'

export const LOGO_CLAUDE = '/logos/claude.png'
export const LOGO_CODEX = '/logos/codex.png'
