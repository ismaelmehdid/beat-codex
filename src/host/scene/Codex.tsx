/**
 * CODEX: the giant evil AI cube. Six dark glossy plates around a pulsing red core (seams glow),
 * red edge lines, a big eye on the -X face that tracks the players, orbiting satellites and
 * floating wire fragments. Reacts to hits, telegraphs attacks, cracks as HP drops, and runs the
 * full death sequence (shake -> satellites detach -> collapse -> voxel burst -> eye falls).
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BOSS_CORE_SIZE, BOSS_X, BOSS_Y, BOSS_Z, PLAYER_HEIGHT } from '../../game/constants'
import { getWorld } from '../../game/store'
import { CODEX_RED } from '../../lib/colors'
import { explosionPieces, makePiece, spawnDebris, type DebrisPiece } from './Debris'
import { flashes, particles, rings } from './particles'

const HALF = BOSS_CORE_SIZE / 2
const PLATE = BOSS_CORE_SIZE - 0.7
const PLATE_T = 0.35
const INNER = BOSS_CORE_SIZE - 0.8
const EYE_R = 1.15
const EYE_LOCAL: [number, number, number] = [-(HALF + 0.2), 0.55, 0]

type V3 = [number, number, number]

const PLATES: { pos: V3; rot: V3; normal: V3 }[] = [
  { pos: [-(HALF - PLATE_T / 2), 0, 0], rot: [0, -Math.PI / 2, 0], normal: [-1, 0, 0] },
  { pos: [HALF - PLATE_T / 2, 0, 0], rot: [0, Math.PI / 2, 0], normal: [1, 0, 0] },
  { pos: [0, HALF - PLATE_T / 2, 0], rot: [-Math.PI / 2, 0, 0], normal: [0, 1, 0] },
  { pos: [0, -(HALF - PLATE_T / 2), 0], rot: [Math.PI / 2, 0, 0], normal: [0, -1, 0] },
  { pos: [0, 0, HALF - PLATE_T / 2], rot: [0, 0, 0], normal: [0, 0, 1] },
  { pos: [0, 0, -(HALF - PLATE_T / 2)], rot: [0, Math.PI, 0], normal: [0, 0, -1] },
]

const RINGS = [
  { tilt: [0.45, 0, 0.2] as V3, radius: 5.6, speed: 0.9, count: 4 },
  { tilt: [-0.35, 0, 1.0] as V3, radius: 6.7, speed: -0.65, count: 3 },
  { tilt: [1.25, 0, -0.4] as V3, radius: 7.7, speed: 0.5, count: 3 },
]
const SAT_SIZE = 0.75
const SAT_COUNT = RINGS.reduce((n, r) => n + r.count, 0)

/** deterministic pseudo-random in [0,1) */
function rnd(i: number, k: number): number {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}

const FRAG_COUNT = 12
const FRAGS = Array.from({ length: FRAG_COUNT }, (_, i) => {
  const a = rnd(i, 1) * Math.PI * 2
  const r = 4.8 + rnd(i, 2) * 3.5
  return {
    base: [Math.cos(a) * r, (rnd(i, 3) - 0.5) * 8, Math.sin(a) * r * 0.8] as V3,
    size: 0.3 + rnd(i, 4) * 0.35,
    phase: rnd(i, 5) * Math.PI * 2,
    speed: 0.4 + rnd(i, 6) * 0.6,
  }
})

/** cracks on the front (-X) plate and the top plate: [y or x, z, length, angle] */
const CRACKS_50: { pos: V3; rot: V3; len: number }[] = [
  { pos: [-(HALF + 0.01), 1.6, -1.2], rot: [0.9, 0, 0], len: 1.6 },
  { pos: [-(HALF + 0.01), -1.4, 1.3], rot: [-0.6, 0, 0], len: 1.9 },
  { pos: [-(HALF + 0.01), 0.3, 2.0], rot: [0.2, 0, 0], len: 1.1 },
  { pos: [-1.5, HALF + 0.01, 0.8], rot: [0, 0.7, Math.PI / 2], len: 1.5 },
]
const CRACKS_25: { pos: V3; rot: V3; len: number }[] = [
  { pos: [-(HALF + 0.01), -0.4, -2.1], rot: [1.3, 0, 0], len: 1.4 },
  { pos: [-(HALF + 0.01), 2.2, 0.6], rot: [-1.1, 0, 0], len: 1.2 },
  { pos: [-(HALF + 0.01), -2.2, -0.3], rot: [0.4, 0, 0], len: 1.6 },
  { pos: [-(HALF + 0.01), 0.9, 0.2], rot: [1.9, 0, 0], len: 2.2 },
  { pos: [1.2, HALF + 0.01, -1.4], rot: [0, -0.5, Math.PI / 2], len: 1.3 },
  { pos: [0.4, -1.0, HALF + 0.01], rot: [0, 0, 0.8], len: 1.5 },
]

const WHITE = new THREE.Color('#ffffff')
const RED = new THREE.Color(CODEX_RED)
const PLATE_EMISSIVE = new THREE.Color('#2a0006')
const HIT_FLASH = new THREE.Color('#8a1a14')
const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()

export default function Codex() {
  const root = useRef<THREE.Group>(null)
  const shell = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Mesh>(null)
  const eye = useRef<THREE.Group>(null)
  const eyeBall = useRef<THREE.Group>(null)
  const satsRoot = useRef<THREE.Group>(null)
  const ringRefs = useRef<(THREE.Group | null)[]>([])
  const satRefs = useRef<(THREE.Mesh | null)[]>([])
  const fragRefs = useRef<(THREE.Mesh | null)[]>([])
  const plateRefs = useRef<(THREE.Mesh | null)[]>([])
  const cracks50 = useRef<THREE.Group>(null)
  const cracks25 = useRef<THREE.Group>(null)

  const anim = useRef({
    ringAngles: [0, 0, 0],
    sparkAcc: 0,
    deathStage: 0,
    nextRingAt: 0,
    eyeY: EYE_LOCAL[1],
    eyeVy: 0,
    eyeYaw: 0,
    eyePitch: 0,
  })

  const mats = useMemo(
    () => ({
      plate: new THREE.MeshStandardMaterial({
        color: '#0b0b16',
        metalness: 0.85,
        roughness: 0.28,
        emissive: PLATE_EMISSIVE.clone(),
        emissiveIntensity: 0.6,
      }),
      inner: new THREE.MeshStandardMaterial({ color: '#3a0008', emissive: CODEX_RED, emissiveIntensity: 1.6, roughness: 0.4 }),
      edge: new THREE.LineBasicMaterial({ color: '#ff3a3a', toneMapped: false }),
      eye: new THREE.MeshStandardMaterial({ color: '#ff1010', emissive: CODEX_RED, emissiveIntensity: 1.8, roughness: 0.25 }),
      eyeRing: new THREE.MeshStandardMaterial({ color: '#2a0000', emissive: CODEX_RED, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.5 }),
      pupil: new THREE.MeshBasicMaterial({ color: '#050005' }),
      sat: new THREE.MeshStandardMaterial({ color: '#150005', emissive: CODEX_RED, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.35 }),
      frag: new THREE.MeshBasicMaterial({ color: '#ff3a3a', wireframe: true, transparent: true, opacity: 0.6, toneMapped: false }),
      crack: new THREE.MeshBasicMaterial({ color: '#ff7a4a', toneMapped: false }),
    }),
    [],
  )
  const geos = useMemo(
    () => ({
      plate: new THREE.BoxGeometry(PLATE, PLATE, PLATE_T),
      inner: new THREE.BoxGeometry(INNER, INNER, INNER),
      edges: new THREE.EdgesGeometry(new THREE.BoxGeometry(BOSS_CORE_SIZE, BOSS_CORE_SIZE, BOSS_CORE_SIZE)),
      eye: new THREE.SphereGeometry(EYE_R, 24, 18),
      pupil: new THREE.SphereGeometry(EYE_R * 0.42, 16, 12),
      eyeRing: new THREE.TorusGeometry(EYE_R * 1.35, 0.1, 10, 48),
      sat: new THREE.BoxGeometry(SAT_SIZE, SAT_SIZE, SAT_SIZE),
      frag: new THREE.TetrahedronGeometry(1, 0),
      crack: new THREE.BoxGeometry(0.07, 1, 0.07),
    }),
    [],
  )

  useFrame(({ clock }, rawDt) => {
    const r = root.current
    const sh = shell.current
    const inn = inner.current
    const ey = eye.current
    const ball = eyeBall.current
    const sats = satsRoot.current
    if (!r || !sh || !inn || !ey || !ball || !sats) return
    const dt = Math.min(rawDt, 0.05)
    const w = getWorld()
    const b = w.boss
    const now = w.now
    const t = clock.elapsedTime
    const phase = w.phase
    const a = anim.current
    const hpFrac = b.maxHp > 0 ? Math.max(0, Math.min(1, b.hp / b.maxHp)) : 1
    const damage = 1 - hpFrac
    const dying = phase === 'VICTORY' && b.dead && b.deathStartedAt !== null
    const td = dying ? (now - (b.deathStartedAt as number)) / 1000 : 0

    if (!b.dead && a.deathStage !== 0) {
      // fresh fight after a victory without remount: restore everything
      a.deathStage = 0
      a.nextRingAt = 0
      a.eyeY = EYE_LOCAL[1]
      a.eyeVy = 0
      sh.visible = true
      inn.visible = true
      sats.visible = true
      ey.position.set(EYE_LOCAL[0], EYE_LOCAL[1], EYE_LOCAL[2])
      ey.rotation.set(0, 0, 0)
      mats.eye.color.set('#ff1010')
      mats.eyeRing.emissiveIntensity = 1.3
      for (const f of fragRefs.current) if (f) f.visible = true
    }

    // ---- base pose ----
    r.position.set(BOSS_X, BOSS_Y, BOSS_Z)
    r.rotation.set(0, 0, 0)
    sh.scale.setScalar(1)
    inn.scale.setScalar(1)
    let plateEmissive = PLATE_EMISSIVE
    let plateIntensity = 0.6
    let innerIntensity = 1.4 + Math.sin(t * 2.2) * 0.4 + damage * 1.2
    let eyeIntensity = 1.8
    let eyeScale = 1
    let satSpeedMul = 1 + damage * 1.6

    if (!dying) {
      r.position.y = BOSS_Y + Math.sin(t * 1.1) * 0.25
      sh.rotation.set(Math.sin(t * 0.3) * 0.04, Math.sin(t * 0.4) * 0.1, Math.sin(t * 0.23) * 0.03)
      inn.rotation.set(t * 0.15, t * 0.2, 0)

      // hit flash + nudge
      if (now < b.hitFlashUntil) {
        plateEmissive = HIT_FLASH
        plateIntensity = 0.75
        innerIntensity = 2.4
        r.position.x += 0.18
      }
      // attack recoil
      const sinceAttack = now - b.lastAttackAt
      if (sinceAttack >= 0 && sinceAttack < 260) {
        const k = 1 - sinceAttack / 260
        r.position.x += k * k * 0.9
        eyeScale *= 1 + k * 0.25
      }
      // attack telegraph
      if (phase === 'PLAYING') {
        const until = b.nextAttackAt - now
        if (until > 0 && until < 400) {
          const k = 1 - until / 400
          eyeScale *= 1 + k * 0.5
          eyeIntensity += k * 3.5
        }
      }

      if (phase === 'DEFEAT') {
        // mocking: brighter pulses, tilting wobble
        const p = Math.sin(t * 6)
        r.rotation.z = Math.sin(t * 2.2) * 0.14
        r.rotation.x = Math.sin(t * 1.7) * 0.06
        r.position.y = BOSS_Y + Math.sin(t * 3) * 0.45
        plateEmissive = RED
        plateIntensity = 0.9 + p * 0.45
        innerIntensity = 3.5 + p * 1.5
        eyeIntensity = 3 + p
        eyeScale *= 1.15 + p * 0.1
        satSpeedMul = 2.2
      }

      // eye tracks the crowd
      let tx = -12
      let ty = PLAYER_HEIGHT / 2
      let tz = 0
      let n = 0
      for (let i = 0; i < w.playerOrder.length; i++) {
        const p = w.players[w.playerOrder[i]]
        if (!p || !p.alive || !p.connected) continue
        if (n === 0) {
          tx = 0
          tz = 0
        }
        tx += p.x
        tz += p.z
        n++
      }
      if (n > 0) {
        tx /= n
        tz /= n
      }
      const ex = BOSS_X + EYE_LOCAL[0]
      const eyW = r.position.y + EYE_LOCAL[1]
      const dx = tx - ex
      const dy = ty - eyW
      const dz = tz - BOSS_Z
      const len = Math.hypot(dx, dy, dz) || 1
      const yaw = Math.atan2(dz, -dx) * 0.6
      const pitch = -Math.asin(Math.max(-1, Math.min(1, dy / len))) * 0.5
      const k = 1 - Math.exp(-dt * 4)
      a.eyeYaw += (yaw - a.eyeYaw) * k
      a.eyePitch += (pitch - a.eyePitch) * k
      ey.position.set(EYE_LOCAL[0], EYE_LOCAL[1], EYE_LOCAL[2])
      ey.rotation.set(0, a.eyeYaw, a.eyePitch)

      // damage sparks
      if (phase === 'PLAYING' && damage > 0.05) {
        a.sparkAcc += Math.pow(damage, 1.4) * 40 * dt
        while (a.sparkAcc >= 1) {
          a.sparkAcc -= 1
          const side = Math.random()
          let sx: number
          let sy: number
          let sz: number
          if (side < 0.6) {
            sx = -HALF
            sy = (Math.random() - 0.5) * PLATE
            sz = (Math.random() - 0.5) * PLATE
          } else {
            sx = (Math.random() - 0.5) * PLATE
            sy = HALF
            sz = (Math.random() - 0.5) * PLATE
          }
          particles.emit(
            r.position.x + sx,
            r.position.y + sy,
            r.position.z + sz,
            -2 - Math.random() * 4,
            1 + Math.random() * 4,
            (Math.random() - 0.5) * 3,
            0.35 + Math.random() * 0.4,
            0.08 + Math.random() * 0.08,
            Math.random() < 0.7 ? CODEX_RED : '#ffb070',
            14,
            1.5,
            false,
            1.6,
          )
        }
      }
    } else {
      // ---------------- DEATH SEQUENCE ----------------
      ey.position.set(EYE_LOCAL[0], a.eyeY, EYE_LOCAL[2])
      if (td < 1.5) {
        const k = td / 1.5
        const amp = 0.25 + k * 0.6
        r.position.x += (Math.random() - 0.5) * amp
        r.position.y += (Math.random() - 0.5) * amp
        r.position.z += (Math.random() - 0.5) * amp * 0.5
        r.rotation.z = (Math.random() - 0.5) * 0.05 * (1 + k)
        const on = Math.sin(td * 55) > 0
        plateEmissive = on ? WHITE : RED
        plateIntensity = on ? 1.6 : 0.7
        innerIntensity = on ? 6 : 1.5
        eyeIntensity = on ? 4 : 2
        eyeScale = 1.2 + Math.sin(td * 20) * 0.1
        satSpeedMul = 3 + k * 3
        if (td >= a.nextRingAt) {
          rings.spawn(BOSS_X - HALF - 0.5, BOSS_Y, BOSS_Z, 1.5, 9 + k * 4, 600, on ? '#ffffff' : CODEX_RED, { facing: true })
          a.nextRingAt = td + 0.22
        }
      } else {
        if (a.deathStage < 1) {
          a.deathStage = 1
          detachSatellites(satRefs.current)
          sats.visible = false
          for (const f of fragRefs.current) if (f) f.visible = false
          flashes.spawn(BOSS_X, BOSS_Y, BOSS_Z, 3, 8, 400, '#ffffff', 1)
        }
        if (td < 2.2) {
          const k = (td - 1.5) / 0.7
          const s = 1 - k * 0.72
          sh.scale.setScalar(s)
          inn.scale.setScalar(s * (1 + k * 0.25))
          inn.rotation.set(t * 6, t * 8, 0)
          plateEmissive = WHITE
          plateIntensity = 0.6 + k * 1.2
          innerIntensity = 2 + k * 8
          eyeIntensity = 3 + k * 2
          eyeScale = 1.25 - k * 0.2
          r.position.x += (Math.random() - 0.5) * 0.35
          r.position.y += (Math.random() - 0.5) * 0.35
        } else {
          if (a.deathStage < 2) {
            a.deathStage = 2
            burstCore(plateRefs.current)
            sh.visible = false
            inn.visible = false
            a.eyeVy = 3
          }
          // only the eye remains: it falls and goes dark
          a.eyeVy -= 20 * dt
          a.eyeY += a.eyeVy * dt
          const floorLocal = EYE_R * 1.4 - BOSS_Y
          if (a.eyeY < floorLocal) {
            a.eyeY = floorLocal
            a.eyeVy = Math.abs(a.eyeVy) > 2 ? -a.eyeVy * 0.3 : 0
          }
          ey.position.set(EYE_LOCAL[0] - (td - 2.2) * 0.8, a.eyeY, EYE_LOCAL[2])
          ey.rotation.set(0, a.eyeYaw, a.eyePitch + (td - 2.2) * 1.4)
          const dark = Math.max(0, 1 - (td - 2.2) / 1.6)
          eyeIntensity = 2.5 * dark
          eyeScale = 1
          mats.eyeRing.emissiveIntensity = 1.3 * dark
          mats.eye.color.setRGB(0.1 + 0.9 * dark, 0.06 * dark, 0.06 * dark)
        }
      }
    }

    // ---- apply materials ----
    mats.plate.emissive.copy(plateEmissive)
    mats.plate.emissiveIntensity = plateIntensity
    mats.inner.emissiveIntensity = innerIntensity
    mats.eye.emissiveIntensity = eyeIntensity
    ball.scale.setScalar(eyeScale)

    // ---- cracks ----
    if (cracks50.current) cracks50.current.visible = hpFrac < 0.5 && !dying
    if (cracks25.current) cracks25.current.visible = hpFrac < 0.25 && !dying
    mats.crack.color.setRGB(1.6, 0.5 + Math.sin(t * 9) * 0.25, 0.3)

    // ---- satellites ----
    if (sats.visible) {
      const erratic = damage
      let si = 0
      for (let ri = 0; ri < RINGS.length; ri++) {
        const cfg = RINGS[ri]
        a.ringAngles[ri] += cfg.speed * satSpeedMul * dt
        const g = ringRefs.current[ri]
        if (g) g.rotation.set(cfg.tilt[0], a.ringAngles[ri], cfg.tilt[2])
        for (let j = 0; j < cfg.count; j++, si++) {
          const m = satRefs.current[si]
          if (!m) continue
          const ang = (j / cfg.count) * Math.PI * 2
          const rad = cfg.radius + Math.sin(t * 5.3 + si * 1.7) * erratic * 1.1
          m.position.set(Math.cos(ang) * rad, Math.sin(t * 7.1 + si) * erratic * 0.8, Math.sin(ang) * rad)
          m.rotation.set(t * (1 + si * 0.2), t * 0.7, 0)
        }
      }
      // fragments
      for (let i = 0; i < FRAG_COUNT; i++) {
        const m = fragRefs.current[i]
        if (!m) continue
        const f = FRAGS[i]
        const tt = t * f.speed + f.phase
        m.position.set(f.base[0] + Math.sin(tt) * 0.6, f.base[1] + Math.sin(tt * 1.3) * 0.8, f.base[2] + Math.cos(tt * 0.7) * 0.5)
        m.rotation.set(tt * 0.8, tt * 0.5, 0)
      }
    }
  })

  return (
    <group ref={root} position={[BOSS_X, BOSS_Y, BOSS_Z]}>
      <group ref={shell}>
        {PLATES.map((p, i) => (
          <mesh
            key={i}
            ref={(m) => {
              plateRefs.current[i] = m
            }}
            geometry={geos.plate}
            material={mats.plate}
            position={p.pos}
            rotation={p.rot}
          />
        ))}
        <lineSegments geometry={geos.edges} material={mats.edge} />
        <group ref={cracks50} visible={false}>
          {CRACKS_50.map((c, i) => (
            <mesh key={i} geometry={geos.crack} material={mats.crack} position={c.pos} rotation={c.rot} scale={[1, c.len, 1]} />
          ))}
        </group>
        <group ref={cracks25} visible={false}>
          {CRACKS_25.map((c, i) => (
            <mesh key={i} geometry={geos.crack} material={mats.crack} position={c.pos} rotation={c.rot} scale={[1, c.len, 1]} />
          ))}
        </group>
      </group>
      <mesh ref={inner} geometry={geos.inner} material={mats.inner} />

      {/* eye: group handles look direction, inner group handles scale */}
      <group ref={eye} position={EYE_LOCAL}>
        <group ref={eyeBall}>
          <mesh geometry={geos.eye} material={mats.eye} />
          <mesh geometry={geos.pupil} material={mats.pupil} position={[-EYE_R * 0.72, 0, 0]} />
          <mesh geometry={geos.eyeRing} material={mats.eyeRing} rotation={[0, Math.PI / 2, 0]} />
        </group>
      </group>

      <group ref={satsRoot}>
        {RINGS.map((cfg, ri) => (
          <group
            key={ri}
            ref={(g) => {
              ringRefs.current[ri] = g
            }}
            rotation={cfg.tilt}
          >
            {Array.from({ length: cfg.count }, (_, j) => {
              const idx = RINGS.slice(0, ri).reduce((n, r) => n + r.count, 0) + j
              return (
                <mesh
                  key={j}
                  ref={(m) => {
                    satRefs.current[idx] = m
                  }}
                  geometry={geos.sat}
                  material={mats.sat}
                />
              )
            })}
          </group>
        ))}
        {FRAGS.map((f, i) => (
          <mesh
            key={i}
            ref={(m) => {
              fragRefs.current[i] = m
            }}
            geometry={geos.frag}
            material={mats.frag}
            position={f.base}
            scale={f.size}
          />
        ))}
      </group>
    </group>
  )
}

// ------------------------------------------------------------------------------------------------
// Death helpers (spawn rapier debris at the current world transforms)
// ------------------------------------------------------------------------------------------------

function detachSatellites(sats: (THREE.Mesh | null)[]): void {
  const pieces: DebrisPiece[] = []
  for (let i = 0; i < SAT_COUNT; i++) {
    const m = sats[i]
    if (!m) continue
    m.getWorldPosition(_v)
    const dx = _v.x - BOSS_X
    const dy = _v.y - BOSS_Y
    const dz = _v.z - BOSS_Z
    const len = Math.hypot(dx, dy, dz) || 1
    const s = 9 + Math.random() * 7
    pieces.push(
      makePiece({
        pos: [_v.x, Math.max(0.5, _v.y), _v.z],
        vel: [(dx / len) * s, (dy / len) * s + 4, (dz / len) * s],
        size: SAT_SIZE,
        color: '#150005',
        emissive: CODEX_RED,
        emissiveIntensity: 0.9,
      }),
    )
    particles.burst(_v.x, _v.y, _v.z, 8, CODEX_RED, { speed: 4, life: 0.5, size: 0.12, gravity: 8 })
  }
  spawnDebris(pieces, 6000)
}

function burstCore(plates: (THREE.Mesh | null)[]): void {
  const pieces: DebrisPiece[] = []
  // the six plates fly off as slabs
  for (let i = 0; i < PLATES.length; i++) {
    const m = plates[i]
    if (!m) continue
    m.getWorldPosition(_v)
    m.getWorldQuaternion(_q)
    _e.setFromQuaternion(_q)
    const n = PLATES[i].normal
    const s = 8 + Math.random() * 6
    const scl = m.getWorldScale(new THREE.Vector3()).x || 1
    pieces.push(
      makePiece({
        pos: [_v.x, Math.max(0.4, _v.y), _v.z],
        rot: [_e.x, _e.y, _e.z],
        vel: [n[0] * s - 2, n[1] * s + 5, n[2] * s],
        ang: [(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6],
        size: [PLATE * scl, PLATE * scl, PLATE_T],
        color: '#0b0b16',
        emissive: CODEX_RED,
        emissiveIntensity: 0.5,
      }),
    )
  }
  // voxel debris from the collapsed core
  pieces.push(
    ...explosionPieces(BOSS_X, BOSS_Y, BOSS_Z, 50, '#1a0006', {
      speed: 13,
      up: 6,
      spread: 1.4,
      sizeMin: 0.35,
      sizeMax: 0.95,
      emissive: CODEX_RED,
      emissiveIntensity: 0.9,
    }),
  )
  spawnDebris(pieces, 6000)

  flashes.spawn(BOSS_X, BOSS_Y, BOSS_Z, 3, 20, 750, '#ffd8c8', 1.6)
  flashes.spawn(BOSS_X, BOSS_Y, BOSS_Z, 1, 10, 450, CODEX_RED, 1.4)
  rings.spawn(BOSS_X, 0.05, BOSS_Z, 2, 22, 1000, CODEX_RED, { brightness: 1.6 })
  rings.spawn(BOSS_X - HALF, BOSS_Y, BOSS_Z, 2, 18, 800, '#ffffff', { facing: true })
  particles.burst(BOSS_X, BOSS_Y, BOSS_Z, 260, CODEX_RED, { speed: 16, life: 1.8, size: 0.26, gravity: 14, drag: 0.7 })
  particles.burst(BOSS_X, BOSS_Y, BOSS_Z, 120, '#ffb070', { speed: 12, life: 1.4, size: 0.2, gravity: 14, drag: 0.7 })
  particles.burst(BOSS_X, BOSS_Y, BOSS_Z, 80, '#ffffff', { speed: 20, life: 0.9, size: 0.14, gravity: 6, drag: 0.5 })
}
