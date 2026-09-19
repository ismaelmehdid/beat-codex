const ID_KEY = 'beatcodex.playerId'
const NAME_KEY = 'beatcodex.playerName'

export const MAX_NAME_LENGTH = 15

function randomId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return 'p_' + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
}

/** Stable per-device player id, persisted so a refresh reconnects as the same fighter. */
export function getOrCreatePlayerId(): string {
  let id = localStorage.getItem(ID_KEY)
  if (!id || !id.startsWith('p_')) {
    id = randomId()
    localStorage.setItem(ID_KEY, id)
  }
  return id
}

export function getStoredName(): string {
  return localStorage.getItem(NAME_KEY) ?? ''
}

export function storeName(name: string): void {
  localStorage.setItem(NAME_KEY, name)
}

/** Returns the cleaned name or an error message. */
export function validateName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, ' ').trim()
  if (!name) return { ok: false, error: 'Enter a name' }
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Max ${MAX_NAME_LENGTH} characters` }
  return { ok: true, name }
}
