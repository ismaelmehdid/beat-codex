/**
 * Arena backdrop: neon floor grid, boundary lines, drifting wireframe shapes, starfield, lights.
 * Everything is cheap and static apart from a few per-frame transform tweaks.
 */
import { Grid } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BOSS_X, BOSS_Y, PLAYER_MAX_X, PLAYER_MIN_X } from '../../game/constants'
import { getWorld } from '../../game/store'

const CYAN = '#00f0ff'
const MAGENTA = '#ff2bd6'
const VIOLET = '#7b61ff'

function rnd(i: number, k: number): number {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}

function BossLight() {
  const ref = useRef<THREE.PointLight>(null)
  useFrame(({ clock }) => {
    const l = ref.current
    if (!l) return
    const w = getWorld()
    const t = clock.elapsedTime
    const hit = w.now < w.boss.hitFlashUntil ? 60 : 0
    const dead = w.boss.dead ? 0.4 : 1
    l.intensity = (90 + Math.sin(t * 3.1) * 30 + hit) * dead
    l.position.set(BOSS_X - 5, BOSS_Y + 2 + Math.sin(t * 1.1) * 0.3, 4)
  })
  return <pointLight ref={ref} color="#ff2a2a" intensity={90} distance={48} decay={2} />
}

const lineMat = (c: string) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false })

function Boundaries() {
  const mats = useMemo(
    () => ({
      cyan: lineMat(CYAN),
      magenta: lineMat(MAGENTA),
      red: lineMat('#7a1424'),
      dim: new THREE.MeshBasicMaterial({ color: '#0d3a40', toneMapped: false }),
    }),
    [],
  )
  const geos = useMemo(
    () => ({
      side: new THREE.BoxGeometry(0.08, 0.06, 13),
      post: new THREE.BoxGeometry(0.14, 2.4, 0.14),
      back: new THREE.BoxGeometry(40, 0.06, 0.08),
      front: new THREE.BoxGeometry(40, 0.04, 0.06),
      barrier: new THREE.BoxGeometry(0.06, 0.05, 13),
    }),
    [],
  )
  const xMin = PLAYER_MIN_X - 0.6
  return (
    <group>
      <mesh geometry={geos.side} material={mats.cyan} position={[xMin, 0.03, 0]} />
      <mesh geometry={geos.post} material={mats.cyan} position={[xMin, 1.2, -6.5]} />
      <mesh geometry={geos.post} material={mats.cyan} position={[xMin, 1.2, 6.5]} />
      <mesh geometry={geos.back} material={mats.magenta} position={[0, 0.03, -6.5]} />
      <mesh geometry={geos.front} material={mats.dim} position={[0, 0.02, 6.5]} />
      <mesh geometry={geos.barrier} material={mats.red} position={[PLAYER_MAX_X + 1.2, 0.03, 0]} />
    </group>
  )
}

const SHAPES = Array.from({ length: 8 }, (_, i) => ({
  kind: i % 3,
  pos: [-30 + rnd(i, 1) * 62, 2.5 + rnd(i, 2) * 13, -12 - rnd(i, 3) * 16] as [number, number, number],
  scale: 1.2 + rnd(i, 4) * 1.6,
  speed: 0.15 + rnd(i, 5) * 0.3,
  phase: rnd(i, 6) * Math.PI * 2,
  color: [CYAN, MAGENTA, VIOLET][i % 3],
}))

function FloatingShapes() {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const geos = useMemo(
    () => [new THREE.IcosahedronGeometry(1, 0), new THREE.OctahedronGeometry(1, 0), new THREE.TorusGeometry(1, 0.28, 8, 20)],
    [],
  )
  const mats = useMemo(
    () =>
      [CYAN, MAGENTA, VIOLET].map(
        (c) => new THREE.MeshBasicMaterial({ color: c, wireframe: true, transparent: true, opacity: 0.4, toneMapped: false }),
      ),
    [],
  )
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    for (let i = 0; i < SHAPES.length; i++) {
      const m = refs.current[i]
      if (!m) continue
      const s = SHAPES[i]
      m.rotation.set(t * s.speed, t * s.speed * 0.7 + s.phase, 0)
      m.position.y = s.pos[1] + Math.sin(t * 0.5 + s.phase) * 0.9
      m.position.x = s.pos[0] + Math.sin(t * 0.2 + s.phase) * 1.2
    }
  })
  return (
    <group>
      {SHAPES.map((s, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m
          }}
          geometry={geos[s.kind]}
          material={mats[i % 3]}
          position={s.pos}
          scale={s.scale}
        />
      ))}
    </group>
  )
}

function Starfield() {
  const geometry = useMemo(() => {
    const n = 900
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd(i, 11) - 0.5) * 240
      pos[i * 3 + 1] = -6 + rnd(i, 12) * 90
      pos[i * 3 + 2] = -45 - rnd(i, 13) * 90
      const k = rnd(i, 14)
      c.set(k < 0.7 ? '#cfe6ff' : k < 0.85 ? CYAN : MAGENTA)
      const b = 0.5 + rnd(i, 15) * 0.7
      col[i * 3] = c.r * b
      col[i * 3 + 1] = c.g * b
      col[i * 3 + 2] = c.b * b
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [])
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.5,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false,
      }),
    [],
  )
  const ref = useRef<THREE.Points>(null)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = Math.sin(clock.elapsedTime * 0.03) * 0.02
  })
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />
}

export default function Arena() {
  return (
    <group>
      <ambientLight intensity={0.35} color="#8fa8ff" />
      <hemisphereLight args={['#2a3f8f', '#050510', 0.6]} />
      <directionalLight position={[-18, 16, 14]} intensity={1.6} color="#a8e4ff" />
      <directionalLight position={[12, 8, -10]} intensity={0.45} color="#ff4a6a" />
      <BossLight />
      <Grid
        position={[0, 0.001, 0]}
        args={[10, 10]}
        cellSize={1}
        cellThickness={0.7}
        cellColor="#0b6f7a"
        sectionSize={5}
        sectionThickness={1.3}
        sectionColor="#c21fa5"
        fadeDistance={85}
        fadeStrength={1.3}
        infiniteGrid
      />
      <Boundaries />
      <FloatingShapes />
      <Starfield />
    </group>
  )
}
