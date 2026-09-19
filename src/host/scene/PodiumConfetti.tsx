import { useFrame } from '@react-three/fiber'
import { useRapier, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getWorld } from '../../game/store'
import { PLAYER_COLORS } from '../../lib/colors'
import { CONFETTI_AT, CONFETTI_LIFETIME_S, CONFETTI_REBURST_EVERY_S, podiumT } from './podiumTiming'

/**
 * Physics confetti: a fixed pool of thin boxes rendered with ONE InstancedMesh. Bodies are created
 * imperatively in the rapier world (inside GameScene's <Physics>) and removed after their lifetime
 * so the simulation stays cheap. First big burst at CONFETTI_AT, smaller re-bursts while RESULTS.
 */
const MAX = 200
const FIRST_BURST = 170
const REBURST = 70
const SIZE: [number, number, number] = [0.26, 0.035, 0.16]
const COLORS = [...PLAYER_COLORS, '#ffd23f', '#ffffff', '#ffd23f']

interface Slot {
  body: RapierRigidBody | null
  dieAt: number
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min)

export default function PodiumConfetti() {
  const { world, rapier } = useRapier()
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const slots = useRef<Slot[]>([])
  if (slots.current.length === 0) {
    for (let i = 0; i < MAX; i++) slots.current.push({ body: null, dieAt: 0 })
  }
  const nextBurstAt = useRef(CONFETTI_AT)
  const firstDone = useRef(false)

  const geometry = useMemo(() => new THREE.BoxGeometry(SIZE[0], SIZE[1], SIZE[2]), [])
  const material = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const hidden = useMemo(() => new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001), [])
  const scratchQuat = useMemo(() => new THREE.Quaternion(), [])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const c = new THREE.Color()
    for (let i = 0; i < MAX; i++) {
      c.set(COLORS[i % COLORS.length])
      mesh.setColorAt(i, c)
      mesh.setMatrixAt(i, hidden)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.instanceMatrix.needsUpdate = true
  }, [hidden])

  // Remove every body we created when the stage unmounts.
  useEffect(() => {
    const pool = slots.current
    return () => {
      for (const s of pool) {
        if (s.body) {
          world.removeRigidBody(s.body)
          s.body = null
        }
      }
      geometry.dispose()
      material.dispose()
    }
  }, [world, geometry, material])

  const spawn = (count: number, t: number): void => {
    let n = 0
    for (const s of slots.current) {
      if (n >= count) break
      if (s.body) continue
      scratchQuat.random()
      const desc = rapier.RigidBodyDesc.dynamic()
        .setTranslation(rand(-5, 5), rand(7.5, 9.5), rand(-2.5, 1.5))
        .setRotation({ x: scratchQuat.x, y: scratchQuat.y, z: scratchQuat.z, w: scratchQuat.w })
        .setLinvel(rand(-6, 6), rand(1, 8), rand(-3, 4))
        .setAngvel({ x: rand(-12, 12), y: rand(-12, 12), z: rand(-12, 12) })
        .setLinearDamping(1.2)
        .setAngularDamping(0.8)
        .setGravityScale(0.45)
        .setCanSleep(true)
      const body = world.createRigidBody(desc)
      const collider = rapier.ColliderDesc.cuboid(SIZE[0] / 2, SIZE[1] / 2, SIZE[2] / 2)
        .setRestitution(0.35)
        .setFriction(0.9)
        .setDensity(0.5)
      world.createCollider(collider, body)
      s.body = body
      s.dieAt = t + CONFETTI_LIFETIME_S + Math.random() * 1.5
      n++
    }
  }

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const t = podiumT()

    if (t >= nextBurstAt.current) {
      if (!firstDone.current) {
        spawn(FIRST_BURST, t)
        firstDone.current = true
        nextBurstAt.current = t + CONFETTI_REBURST_EVERY_S
      } else if (getWorld().phase === 'RESULTS') {
        spawn(REBURST, t)
        nextBurstAt.current = t + CONFETTI_REBURST_EVERY_S
      }
      // else: still in PODIUM, keep waiting for RESULTS (re-checked every frame)
    }

    const pool = slots.current
    for (let i = 0; i < MAX; i++) {
      const s = pool[i]
      const body = s.body
      if (!body) continue
      if (t >= s.dieAt) {
        world.removeRigidBody(body)
        s.body = null
        mesh.setMatrixAt(i, hidden)
        continue
      }
      const p = body.translation()
      const q = body.rotation()
      dummy.position.set(p.x, p.y, p.z)
      dummy.quaternion.set(q.x, q.y, q.z, q.w)
      const life = s.dieAt - t
      dummy.scale.setScalar(life < 0.8 ? Math.max(0.001, life / 0.8) : 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={meshRef} args={[geometry, material, MAX]} frustumCulled={false} />
}
