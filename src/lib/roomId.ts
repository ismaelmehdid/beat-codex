// Unambiguous alphabet: no 0/O, 1/I.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const STORAGE_KEY = 'beatcodex.hostRoomId'

export function generateRoomId(length = 4): string {
  let out = ''
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function isValidRoomId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^[A-Z2-9]{4,6}$/.test(id)
}

/**
 * Host room id: `?room=XXXX` wins, otherwise reuse the id stored for this tab (so an accidental
 * host reload keeps the same room), otherwise generate a new one.
 */
export function getOrCreateHostRoomId(search: string): string {
  const fromQuery = new URLSearchParams(search).get('room')?.toUpperCase()
  if (isValidRoomId(fromQuery)) {
    sessionStorage.setItem(STORAGE_KEY, fromQuery)
    return fromQuery
  }
  const stored = sessionStorage.getItem(STORAGE_KEY)
  if (isValidRoomId(stored)) return stored
  const fresh = generateRoomId()
  sessionStorage.setItem(STORAGE_KEY, fresh)
  return fresh
}

export function joinUrlFor(roomId: string): string {
  return `${window.location.origin}/join?room=${roomId}`
}
