import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * Winner FX: procedural crown (ring of gold voxels with spikes), orbiting particle halo
 * (InstancedMesh) and additive rings behind the fighter. All animated from the R3F clock;
 * the parent decides visibility / pop-in scale.
 */

const GOLD = '#ffd23f'

interface CrownPart {
  pos: [number, number, number]
  size: [number, number, number]
  rotY: number
}

/** Floating crown above the head. Fighter head top is ~2.3, antenna ~2.55 (scale 1). */
export function PodiumCrown({ color = GOLD, y = 2.85 }: { color?: string; y?: number }) {
  const ref = useRef<THREE.Group>(null)
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.6 }),
    [color],
  )
  const gemMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#00f0ff', emissive: '#00f0ff', emissiveIntensity: 2.2, roughness: 0.2 }),
    [],
  )
  const parts = useMemo<CrownPart[]>(() => {
    const out: CrownPart[] = []
    const n = 8
    const r = 0.36
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const cx = Math.cos(a) * r
      const cz = Math.sin(a) * r
      out.push({ pos: [cx, 0, cz], size: [0.16, 0.14, 0.16], rotY: -a })
      if (i % 2 === 0) out.push({ pos: [cx, 0.2, cz], size: [0.1, 0.26, 0.1], rotY: -a })
    }
    return out
  }, [])

  useEffect(() => () => {
    mat.dispose()
    gemMat.dispose()
  }, [mat, gemMat])

  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const t = clock.elapsedTime
    g.rotation.y = t * 0.9
    g.position.y = y + Math.sin(t * 2.1) * 0.06
  })

  return (
    <group ref={ref} position={[0, y, 0]}>
      {parts.map((p, i) => (
        <mesh key={i} position={p.pos} rotation={[0, p.rotY, 0]} material={mat}>
          <boxGeometry args={p.size} />
        </mesh>
      ))}
      {/* gems on the four spikes */}
      {[0, 2, 4, 6].map((i) => {
        const a = (i / 8) * Math.PI * 2
        return (
          <mesh key={`gem${i}`} position={[Math.cos(a) * 0.36, 0.37, Math.sin(a) * 0.36]} material={gemMat}>
            <boxGeometry args={[0.07, 0.07, 0.07]} />
          </mesh>
        )
      })}
    </group>
  )
}

/** ~40 small emissive cubes orbiting the winner (one InstancedMesh, scratch objects only). */
export function PodiumHalo({ color = GOLD, count = 40 }: { color?: string; count?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => new THREE.BoxGeometry(0.09, 0.09, 0.09), [])
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color, toneMapped: false }), [color])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  // per-particle seeds: angle0, radius, angular speed, y phase, y speed
  const seeds = useMemo(() => {
    const s = new Float32Array(count * 5)
    for (let i = 0; i < count; i++) {
      s[i * 5] = Math.random() * Math.PI * 2
      s[i * 5 + 1] = 1.0 + Math.random() * 0.5
      s[i * 5 + 2] = (0.6 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1)
      s[i * 5 + 3] = Math.random() * Math.PI * 2
      s[i * 5 + 4] = 0.8 + Math.random() * 1.2
    }
    return s
  }, [count])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (mesh) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  }, [])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.elapsedTime
    for (let i = 0; i < count; i++) {
      const a = seeds[i * 5] + t * seeds[i * 5 + 2]
      const r = seeds[i * 5 + 1]
      const y = 1.3 + Math.sin(t * seeds[i * 5 + 4] + seeds[i * 5 + 3]) * 0.8
      dummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
      dummy.rotation.set(t * 2 + i, t * 1.5, 0)
      dummy.scale.setScalar(0.7 + 0.3 * Math.sin(t * 5 + i))
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, count]} frustumCulled={false} />
}

/** Additive glow rings behind the winner (XY plane, facing the camera). */
export function PodiumWinnerRings({ color = GOLD }: { color?: string }) {
  const r1 = useRef<THREE.Mesh>(null)
  const r2 = useRef<THREE.Mesh>(null)
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [color],
  )
  const arcMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  )
  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [color],
  )

  useEffect(() => () => {
    ringMat.dispose()
    arcMat.dispose()
    glowMat.dispose()
  }, [ringMat, arcMat, glowMat])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (r1.current) {
      r1.current.scale.setScalar(1 + 0.06 * Math.sin(t * 3))
      r1.current.rotation.z = t * 0.3
    }
    if (r2.current) r2.current.rotation.z = -t * 1.2
  })

  return (
    <group position={[0, 1.5, -0.7]}>
      <mesh material={glowMat}>
        <circleGeometry args={[1.05, 32]} />
      </mesh>
      <mesh ref={r1} material={ringMat}>
        <ringGeometry args={[1.05, 1.55, 48]} />
      </mesh>
      <mesh ref={r2} material={arcMat}>
        <ringGeometry args={[1.72, 1.8, 48, 1, 0, Math.PI * 1.25]} />
      </mesh>
    </group>
  )
}
