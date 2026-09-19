/**
 * Visual effects: consumes world.fx events and drives the shared pools (particles, flashes,
 * rings), the pooled damage-number sprites and the rapier debris layer.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BOSS_CORE_SIZE } from '../../game/constants'
import { getWorld } from '../../game/store'
import type { FxEvent } from '../../game/types'
import { CODEX_RED, FIREBALL_ORANGE } from '../../lib/colors'
import { DebrisLayer, explosionPieces, spawnDebris } from './Debris'
import { FLASH_CAPACITY, PARTICLE_CAPACITY, RING_CAPACITY, flashes, particles, rings } from './particles'
import { getTextTexture } from './TextSprite'

// ------------------------------------------------------------------------------------------------
// Instanced layers for the shared pools
// ------------------------------------------------------------------------------------------------

function ParticleLayer() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), [])
  useFrame(({ clock }, dt) => {
    const mesh = ref.current
    if (!mesh) return
    particles.update(Math.min(dt, 0.05))
    particles.write(mesh, clock.elapsedTime)
  })
  return <instancedMesh ref={ref} args={[geometry, material, PARTICLE_CAPACITY]} frustumCulled={false} count={0} />
}

function FlashLayer() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 16, 12), [])
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  useFrame(() => {
    if (ref.current) flashes.write(ref.current, performance.now())
  })
  return <instancedMesh ref={ref} args={[geometry, material, FLASH_CAPACITY]} frustumCulled={false} count={0} renderOrder={5} />
}

function RingLayer() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => new THREE.RingGeometry(0.8, 1, 48), [])
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  )
  useFrame(() => {
    if (ref.current) rings.write(ref.current, performance.now())
  })
  return <instancedMesh ref={ref} args={[geometry, material, RING_CAPACITY]} frustumCulled={false} count={0} renderOrder={5} />
}

// ------------------------------------------------------------------------------------------------
// Damage numbers: a fixed pool of sprites whose textures are swapped (cached by text+color)
// ------------------------------------------------------------------------------------------------

const DAMAGE_POOL = 40
const DAMAGE_DURATION = 900
const DAMAGE_RISE = 1.5

class DamageNumberPool {
  readonly group = new THREE.Group()
  readonly sprites: THREE.Sprite[] = []
  readonly start = new Float64Array(DAMAGE_POOL)
  readonly baseY = new Float32Array(DAMAGE_POOL)
  readonly height = new Float32Array(DAMAGE_POOL)
  readonly aspect = new Float32Array(DAMAGE_POOL)
  readonly driftX = new Float32Array(DAMAGE_POOL)
  private next = 0

  constructor() {
    for (let i = 0; i < DAMAGE_POOL; i++) {
      const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })
      const s = new THREE.Sprite(mat)
      s.visible = false
      s.renderOrder = 20
      this.sprites.push(s)
      this.group.add(s)
    }
  }

  spawn(x: number, y: number, z: number, text: string, color: string, height = 0.7): void {
    const i = this.next
    this.next = (this.next + 1) % DAMAGE_POOL
    const s = this.sprites[i]
    const { texture, aspect } = getTextTexture(text, color, '#000000', 900)
    const mat = s.material as THREE.SpriteMaterial
    mat.map = texture
    mat.opacity = 1
    mat.needsUpdate = true
    s.position.set(x, y, z)
    s.visible = true
    this.start[i] = performance.now()
    this.baseY[i] = y
    this.height[i] = height
    this.aspect[i] = aspect
    this.driftX[i] = (Math.random() - 0.5) * 0.8
    s.scale.set(height * aspect, height, 1)
  }

  update(now: number): void {
    for (let i = 0; i < DAMAGE_POOL; i++) {
      const s = this.sprites[i]
      if (!s.visible) continue
      const k = (now - this.start[i]) / DAMAGE_DURATION
      if (k >= 1) {
        s.visible = false
        continue
      }
      const e = 1 - (1 - k) * (1 - k)
      s.position.y = this.baseY[i] + DAMAGE_RISE * e
      s.position.x += this.driftX[i] * 0.016 * (1 - k)
      const pop = k < 0.15 ? 1 + (0.15 - k) * 3 : 1
      const h = this.height[i] * pop
      s.scale.set(h * this.aspect[i], h, 1)
      ;(s.material as THREE.SpriteMaterial).opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4
    }
  }
}

const poolRef: { current: DamageNumberPool | null } = { current: null }

function DamageNumbers() {
  const pool = useMemo(() => new DamageNumberPool(), [])
  poolRef.current = pool
  useFrame(() => pool.update(performance.now()))
  return <primitive object={pool.group} />
}

// ------------------------------------------------------------------------------------------------
// FX dispatcher
// ------------------------------------------------------------------------------------------------

const WHITE = '#ffffff'

function handleFx(f: FxEvent): void {
  const color = f.color ?? WHITE
  switch (f.type) {
    case 'fire': {
      particles.burst(f.x, f.y, f.z, 6, color, { speed: 3.5, life: 0.25, size: 0.11, gravity: 0, drag: 2, bias: [6, 0, 0] })
      flashes.spawn(f.x, f.y, f.z, 0.15, 0.55, 110, color, 1.1)
      break
    }
    case 'boss_hit': {
      flashes.spawn(f.x, f.y, f.z, 0.3, 1.5, 200, color, 1.3)
      particles.burst(f.x, f.y, f.z, 11, color, { speed: 7, life: 0.5, size: 0.14, gravity: 14, drag: 1.5, bias: [-3, 1, 0] })
      break
    }
    case 'damage_number': {
      const v = Math.round(f.value ?? 0)
      poolRef.current?.spawn(f.x + (Math.random() - 0.5) * 0.6, f.y, f.z + 0.3, String(v), color, 0.75)
      break
    }
    case 'boss_fire': {
      flashes.spawn(f.x - 0.5, f.y, f.z, 0.6, 2.6, 260, CODEX_RED, 1.4)
      particles.burst(f.x, f.y, f.z, 14, CODEX_RED, { speed: 5, life: 0.4, size: 0.16, gravity: 2, drag: 2, bias: [-4, 0, 0] })
      break
    }
    case 'boss_impact': {
      rings.spawn(f.x, 0.05, f.z, 0.3, 3.2, 450, '#ff5a2a', { brightness: 1.5 })
      flashes.spawn(f.x, Math.max(0.5, f.y), f.z, 0.4, 2.2, 230, '#ff7a30', 1.4)
      particles.burst(f.x, Math.max(0.3, f.y), f.z, 32, Math.random() < 0.5 ? CODEX_RED : '#ff8a3a', {
        speed: 8,
        life: 0.75,
        size: 0.19,
        gravity: 18,
        drag: 1.2,
        bias: [0, 5, 0],
      })
      break
    }
    case 'player_hit': {
      particles.burst(f.x, f.y, f.z, 9, Math.random() < 0.5 ? CODEX_RED : WHITE, { speed: 5, life: 0.4, size: 0.12, gravity: 15, drag: 1.5 })
      flashes.spawn(f.x, f.y, f.z, 0.3, 1.1, 150, CODEX_RED, 1.1)
      break
    }
    case 'player_death': {
      spawnDebris(explosionPieces(f.x, f.y, f.z, 13, color, { speed: 7, up: 5, spread: 0.5, sizeMin: 0.22, sizeMax: 0.42, emissiveIntensity: 0.9 }), 2500)
      particles.burst(f.x, f.y, f.z, 34, color, { speed: 7, life: 0.8, size: 0.15, gravity: 16, drag: 1.2, bias: [0, 3, 0] })
      flashes.spawn(f.x, f.y, f.z, 0.5, 2.4, 260, color, 1.4)
      rings.spawn(f.x, 0.05, f.z, 0.3, 2.4, 400, color)
      break
    }
    case 'respawn': {
      rings.spawn(f.x, 0.05, f.z, 1.4, 0.7, 700, color, { rise: 2.3 })
      rings.spawn(f.x, 0.05, f.z, 0.4, 1.8, 500, color)
      particles.burst(f.x, 0.3, f.z, 22, color, { speed: 1.5, life: 0.9, size: 0.1, gravity: -3, drag: 0.5, bias: [0, 3, 0], bounce: false })
      flashes.spawn(f.x, 1, f.z, 0.3, 1.6, 300, color, 1.2)
      break
    }
    case 'boss_death': {
      const half = BOSS_CORE_SIZE / 2
      flashes.spawn(f.x, f.y, f.z, 2, 9, 500, '#ff6a4a', 1.2)
      rings.spawn(f.x - half, f.y, f.z, 1, 12, 900, CODEX_RED, { facing: true })
      rings.spawn(f.x - half, f.y, f.z, 1, 16, 1100, WHITE, { facing: true, delayMs: 250 })
      rings.spawn(f.x, 0.05, f.z, 2, 14, 1000, CODEX_RED, { delayMs: 120 })
      particles.burst(f.x, f.y, f.z, 160, CODEX_RED, { speed: 14, life: 1.5, size: 0.25, gravity: 12, drag: 0.8 })
      particles.burst(f.x, f.y, f.z, 80, FIREBALL_ORANGE, { speed: 10, life: 1.2, size: 0.2, gravity: 12, drag: 0.8 })
      break
    }
  }
}

function FxDispatcher() {
  const lastFxId = useRef(-1)
  useEffect(() => {
    // Skip events that happened before we mounted (avoid replaying a stale burst on mount).
    const fx = getWorld().fx
    lastFxId.current = fx.length ? fx[fx.length - 1].id : 0
  }, [])
  useFrame(() => {
    const fx = getWorld().fx
    if (!fx.length) return
    let last = lastFxId.current
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i]
      if (f.id <= last) continue
      handleFx(f)
      if (f.id > last) last = f.id
    }
    lastFxId.current = last
  })
  return null
}

export default function Effects() {
  return (
    <>
      <ParticleLayer />
      <FlashLayer />
      <RingLayer />
      <DamageNumbers />
      <DebrisLayer />
      <FxDispatcher />
    </>
  )
}
