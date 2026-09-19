import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { CLAUDE_ORANGE } from '../../lib/colors'

export interface VoxelFighterProps {
  /** per-player accent (visor, boots, antenna, chest plate): what tells fighters apart */
  color: string
  /** body color; defaults to the Claude brand orange the whole team wears */
  bodyColor?: string
  /** 0..1 walk intensity read every frame (no React re-render needed). 0 = idle bob only. */
  walkRef?: MutableRefObject<number>
  /** static scale of the whole fighter (default 1 ~ 1.8 units tall) */
  scale?: number
  /** brighter emissive (podium winner glow) */
  glow?: number
  /** freeze animation */
  frozen?: boolean
  /** 0..1 hit flash read every frame: 1 = whitened/brightened (optional, additive) */
  flashRef?: MutableRefObject<number>
  /** 0..1 brightness multiplier read every frame: 1 = normal, ~0.35 = disconnected (optional, additive) */
  dimRef?: MutableRefObject<number>
}

/**
 * Procedural voxel fighter (Anthropic hacker). Pure geometry: head + visor, torso, arms, legs.
 * Origin is at the feet (y = 0). Faces +X by default; the parent group handles facing/position.
 */
const WHITE = new THREE.Color('#ffffff')
const DARK = new THREE.Color('#12131f')

export default function VoxelFighter({
  color,
  bodyColor = CLAUDE_ORANGE,
  walkRef,
  scale = 1,
  glow = 0.55,
  frozen = false,
  flashRef,
  dimRef,
}: VoxelFighterProps) {
  const leftLeg = useRef<THREE.Mesh>(null)
  const rightLeg = useRef<THREE.Mesh>(null)
  const leftArm = useRef<THREE.Mesh>(null)
  const rightArm = useRef<THREE.Mesh>(null)
  const body = useRef<THREE.Group>(null)
  const t0 = useMemo(() => Math.random() * 10, [])

  const mainMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: bodyColor,
        emissive: bodyColor,
        emissiveIntensity: glow,
        roughness: 0.4,
        metalness: 0.2,
      }),
    [bodyColor, glow],
  )
  const accentMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: glow * 1.6,
        roughness: 0.35,
        metalness: 0.25,
      }),
    [color, glow],
  )
  const darkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#12131f', roughness: 0.7, metalness: 0.3 }), [])
  // The visor carries the player's color: it is the brightest identity marker at projector distance.
  const visorMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: 2.2, roughness: 0.2 }),
    [color],
  )

  const baseColor = useMemo(() => new THREE.Color(bodyColor), [bodyColor])
  const accentColor = useMemo(() => new THREE.Color(color), [color])
  const lastFx = useRef({ flash: -1, dim: -1 })

  useFrame(({ clock }) => {
    // Optional per-frame hit flash / dimming (only touches materials when the values change).
    const flash = flashRef?.current ?? 0
    const dim = dimRef?.current ?? 1
    if (flash !== lastFx.current.flash || dim !== lastFx.current.dim) {
      lastFx.current.flash = flash
      lastFx.current.dim = dim
      mainMat.color.copy(baseColor).lerp(WHITE, flash).multiplyScalar(dim)
      mainMat.emissive.copy(baseColor).lerp(WHITE, flash)
      mainMat.emissiveIntensity = (glow + flash * 2.5) * dim
      accentMat.color.copy(accentColor).lerp(WHITE, flash).multiplyScalar(dim)
      accentMat.emissive.copy(accentColor).lerp(WHITE, flash)
      accentMat.emissiveIntensity = (glow * 1.6 + flash * 2.5) * dim
      darkMat.color.copy(DARK).lerp(WHITE, flash * 0.85).multiplyScalar(dim)
      visorMat.emissiveIntensity = (2.2 + flash) * dim
    }
    if (frozen) return
    const t = clock.elapsedTime + t0
    const walk = walkRef?.current ?? 0
    const swing = Math.sin(t * 12) * 0.7 * walk
    if (leftLeg.current) leftLeg.current.rotation.z = swing
    if (rightLeg.current) rightLeg.current.rotation.z = -swing
    if (leftArm.current) leftArm.current.rotation.z = -swing * 0.8 + 0.1
    if (rightArm.current) rightArm.current.rotation.z = swing * 0.8 - 0.1
    if (body.current) body.current.position.y = Math.sin(t * 3) * 0.04 + Math.abs(Math.sin(t * 12)) * 0.08 * walk
  })

  return (
    <group scale={scale}>
      <group ref={body}>
        {/* legs (pivot at hip) */}
        <mesh ref={leftLeg} position={[0, 0.7, -0.2]} material={darkMat}>
          <boxGeometry args={[0.3, 0.7, 0.3]} />
          <mesh position={[0, -0.35, 0]} material={accentMat}>
            <boxGeometry args={[0.32, 0.16, 0.34]} />
          </mesh>
        </mesh>
        <mesh ref={rightLeg} position={[0, 0.7, 0.2]} material={darkMat}>
          <boxGeometry args={[0.3, 0.7, 0.3]} />
          <mesh position={[0, -0.35, 0]} material={accentMat}>
            <boxGeometry args={[0.32, 0.16, 0.34]} />
          </mesh>
        </mesh>
        {/* torso */}
        <mesh position={[0, 1.15, 0]} material={mainMat}>
          <boxGeometry args={[0.55, 0.8, 0.8]} />
        </mesh>
        {/* chest plate: accent so a crowd stays readable head-on */}
        <mesh position={[0.29, 1.2, 0]} material={accentMat}>
          <boxGeometry args={[0.06, 0.5, 0.5]} />
        </mesh>
        {/* arms (pivot at shoulder) */}
        <mesh ref={leftArm} position={[0, 1.5, -0.52]} material={mainMat}>
          <boxGeometry args={[0.22, 0.7, 0.22]} />
        </mesh>
        <mesh ref={rightArm} position={[0, 1.5, 0.52]} material={mainMat}>
          <boxGeometry args={[0.22, 0.7, 0.22]} />
        </mesh>
        {/* head */}
        <mesh position={[0, 1.95, 0]} material={darkMat}>
          <boxGeometry args={[0.7, 0.7, 0.7]} />
        </mesh>
        {/* visor facing +X */}
        <mesh position={[0.36, 1.98, 0]} material={visorMat}>
          <boxGeometry args={[0.04, 0.18, 0.56]} />
        </mesh>
        {/* antenna */}
        <mesh position={[0, 2.42, 0]} material={accentMat}>
          <boxGeometry args={[0.08, 0.25, 0.08]} />
        </mesh>
      </group>
    </group>
  )
}
