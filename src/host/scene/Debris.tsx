/**
 * Rapier debris: short-lived dynamic boxes (boss collapse, satellites, player deaths).
 * Anyone may call `spawnDebris` (even from useFrame); `<DebrisLayer>` renders the bodies and
 * prunes them when they expire or when the phase leaves the fight.
 */
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { memo, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { create } from 'zustand'
import { useWorld } from '../../game/store'

export interface DebrisPiece {
  id: number
  pos: [number, number, number]
  rot: [number, number, number]
  vel: [number, number, number]
  ang: [number, number, number]
  size: [number, number, number]
  color: string
  emissive: string
  emissiveIntensity: number
}

interface DebrisGroup {
  id: number
  pieces: DebrisPiece[]
  expiresAt: number
}

interface DebrisStore {
  groups: DebrisGroup[]
  spawn: (pieces: DebrisPiece[], ttlMs: number) => void
  prune: (now: number) => void
  clear: () => void
}

/** Hard cap on simultaneous bodies: oldest groups are dropped first. */
const MAX_BODIES = 320

let nextGroupId = 1
let nextPieceId = 1

export const useDebrisStore = create<DebrisStore>((set, get) => ({
  groups: [],
  spawn: (pieces, ttlMs) => {
    if (pieces.length === 0) return
    let groups = [...get().groups, { id: nextGroupId++, pieces, expiresAt: performance.now() + ttlMs }]
    let total = groups.reduce((n, g) => n + g.pieces.length, 0)
    while (total > MAX_BODIES && groups.length > 1) {
      total -= groups[0].pieces.length
      groups = groups.slice(1)
    }
    set({ groups })
  },
  prune: (now) => {
    const groups = get().groups
    if (groups.length && groups.some((g) => g.expiresAt <= now)) set({ groups: groups.filter((g) => g.expiresAt > now) })
  },
  clear: () => {
    if (get().groups.length) set({ groups: [] })
  },
}))

export function spawnDebris(pieces: DebrisPiece[], ttlMs: number): void {
  useDebrisStore.getState().spawn(pieces, ttlMs)
}

export function clearDebris(): void {
  useDebrisStore.getState().clear()
}

export interface PieceInit {
  pos: [number, number, number]
  rot?: [number, number, number]
  vel: [number, number, number]
  ang?: [number, number, number]
  size: number | [number, number, number]
  color: string
  emissive?: string
  emissiveIntensity?: number
}

export function makePiece(p: PieceInit): DebrisPiece {
  const size: [number, number, number] = typeof p.size === 'number' ? [p.size, p.size, p.size] : p.size
  return {
    id: nextPieceId++,
    pos: p.pos,
    rot: p.rot ?? [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
    vel: p.vel,
    ang: p.ang ?? [(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12],
    size,
    color: p.color,
    emissive: p.emissive ?? p.color,
    emissiveIntensity: p.emissiveIntensity ?? 0.6,
  }
}

/** Convenience: n cubes exploding outward from a point. */
export function explosionPieces(
  x: number,
  y: number,
  z: number,
  n: number,
  color: string,
  opts: { speed?: number; up?: number; spread?: number; sizeMin?: number; sizeMax?: number; emissive?: string; emissiveIntensity?: number } = {},
): DebrisPiece[] {
  const speed = opts.speed ?? 8
  const up = opts.up ?? 4
  const spread = opts.spread ?? 0.6
  const sizeMin = opts.sizeMin ?? 0.2
  const sizeMax = opts.sizeMax ?? 0.45
  const out: DebrisPiece[] = []
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.max(0, 1 - u * u))
    const dx = r * Math.cos(a)
    const dy = u
    const dz = r * Math.sin(a)
    const s = speed * (0.5 + Math.random())
    out.push(
      makePiece({
        pos: [x + dx * spread, Math.max(0.2, y + dy * spread), z + dz * spread],
        vel: [dx * s, Math.abs(dy) * s + up, dz * s],
        size: sizeMin + Math.random() * (sizeMax - sizeMin),
        color,
        emissive: opts.emissive,
        emissiveIntensity: opts.emissiveIntensity,
      }),
    )
  }
  return out
}

const unitBox = new THREE.BoxGeometry(1, 1, 1)
const matCache = new Map<string, THREE.MeshStandardMaterial>()
function materialFor(color: string, emissive: string, intensity: number): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive}|${intensity}`
  let m = matCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: 0.5, metalness: 0.3 })
    if (matCache.size > 64) matCache.clear()
    matCache.set(key, m)
  }
  return m
}

const PieceBody = memo(function PieceBody({ p }: { p: DebrisPiece }) {
  const material = useMemo(() => materialFor(p.color, p.emissive, p.emissiveIntensity), [p.color, p.emissive, p.emissiveIntensity])
  return (
    <RigidBody
      type="dynamic"
      colliders={false}
      position={p.pos}
      rotation={p.rot}
      linearVelocity={p.vel}
      angularVelocity={p.ang}
      linearDamping={0.2}
      angularDamping={0.4}
    >
      <CuboidCollider args={[p.size[0] / 2, p.size[1] / 2, p.size[2] / 2]} restitution={0.35} friction={0.9} />
      <mesh geometry={unitBox} material={material} scale={p.size} />
    </RigidBody>
  )
})

const GroupView = memo(function GroupView({ group }: { group: DebrisGroup }) {
  return (
    <>
      {group.pieces.map((p) => (
        <PieceBody key={p.id} p={p} />
      ))}
    </>
  )
})

export function DebrisLayer() {
  const groups = useDebrisStore((s) => s.groups)
  const phase = useWorld((w) => w.phase)
  useEffect(() => {
    // Leaving the fight (or starting a new one): nothing may linger on the podium.
    if (phase === 'PODIUM' || phase === 'RESULTS' || phase === 'LOBBY' || phase === 'COUNTDOWN') clearDebris()
  }, [phase])
  useFrame(() => {
    useDebrisStore.getState().prune(performance.now())
  })
  return (
    <>
      {groups.map((g) => (
        <GroupView key={g.id} group={g} />
      ))}
    </>
  )
}
