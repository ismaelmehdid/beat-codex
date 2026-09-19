/**
 * Instanced projectile rendering. Reads world.projectiles every frame; no React per projectile.
 * Player fireballs: sphere + 2 stretched trail blobs (instanceColor = player color).
 * Boss orbs: dark red core + additive glow shell + crackling wireframe inner sphere.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BOSS_PROJECTILE_RADIUS, FIREBALL_RADIUS } from '../../game/constants'
import { getWorld } from '../../game/store'

const FIRE_POOL = 512
const TRAIL_PER_FIREBALL = 2
const TRAIL_POOL = FIRE_POOL * TRAIL_PER_FIREBALL
const ORB_POOL = 64

const _obj = new THREE.Object3D()
const _color = new THREE.Color()
const _dir = new THREE.Vector3()
const _xAxis = new THREE.Vector3(1, 0, 0)
const _quat = new THREE.Quaternion()
const _pos = new THREE.Vector3()
const _scl = new THREE.Vector3()
const _m = new THREE.Matrix4()

function ensureColor(mesh: THREE.InstancedMesh, capacity: number): THREE.InstancedBufferAttribute {
  if (mesh.instanceColor === null) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
  }
  return mesh.instanceColor
}

export default function Projectiles() {
  const fireRef = useRef<THREE.InstancedMesh>(null)
  const trailRef = useRef<THREE.InstancedMesh>(null)
  const orbRef = useRef<THREE.InstancedMesh>(null)
  const orbGlowRef = useRef<THREE.InstancedMesh>(null)
  const orbInnerRef = useRef<THREE.InstancedMesh>(null)

  const geos = useMemo(
    () => ({
      fire: new THREE.SphereGeometry(FIREBALL_RADIUS, 12, 10),
      trail: new THREE.SphereGeometry(FIREBALL_RADIUS * 0.75, 8, 6),
      orb: new THREE.SphereGeometry(BOSS_PROJECTILE_RADIUS * 0.6, 16, 12),
      orbGlow: new THREE.SphereGeometry(BOSS_PROJECTILE_RADIUS, 16, 12),
      orbInner: new THREE.IcosahedronGeometry(BOSS_PROJECTILE_RADIUS * 0.85, 1),
    }),
    [],
  )
  const mats = useMemo(
    () => ({
      fire: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      trail: new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      orb: new THREE.MeshStandardMaterial({ color: '#3a0008', emissive: '#ff2a2a', emissiveIntensity: 1.6, roughness: 0.3 }),
      orbGlow: new THREE.MeshBasicMaterial({
        color: '#ff2a2a',
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      orbInner: new THREE.MeshBasicMaterial({ color: '#ffb070', wireframe: true, toneMapped: false }),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const fire = fireRef.current
    const trail = trailRef.current
    const orb = orbRef.current
    const orbGlow = orbGlowRef.current
    const orbInner = orbInnerRef.current
    if (!fire || !trail || !orb || !orbGlow || !orbInner) return

    const fireColor = ensureColor(fire, FIRE_POOL)
    const trailColor = ensureColor(trail, TRAIL_POOL)
    const fireArr = fire.instanceMatrix.array as Float32Array
    const trailArr = trail.instanceMatrix.array as Float32Array
    const orbArr = orb.instanceMatrix.array as Float32Array
    const glowArr = orbGlow.instanceMatrix.array as Float32Array
    const innerArr = orbInner.instanceMatrix.array as Float32Array

    const t = clock.elapsedTime
    const prs = getWorld().projectiles
    let nf = 0
    let nt = 0
    let no = 0

    for (let i = 0; i < prs.length; i++) {
      const pr = prs[i]
      if (pr.kind === 'player') {
        if (nf >= FIRE_POOL) continue
        _color.set(pr.color)
        // core: bright, slightly pulsing
        const pulse = 1 + Math.sin(t * 30 + pr.id) * 0.12
        _pos.set(pr.x, pr.y, pr.z)
        _scl.set(pulse, pulse, pulse)
        _dir.set(pr.vx, pr.vy, pr.vz)
        const len = _dir.length() || 1
        _dir.divideScalar(len)
        _quat.setFromUnitVectors(_xAxis, _dir)
        _m.compose(_pos, _quat, _scl)
        _m.toArray(fireArr, nf * 16)
        // white-hot core tint for bloom
        fireColor.setXYZ(nf, 0.6 + _color.r * 1.2, 0.6 + _color.g * 1.2, 0.6 + _color.b * 1.2)
        nf++
        // trail: stretched blobs behind the fireball along -velocity
        for (let k = 0; k < TRAIL_PER_FIREBALL; k++) {
          const back = 0.55 + k * 0.6
          _pos.set(pr.x - _dir.x * back, pr.y - _dir.y * back, pr.z - _dir.z * back)
          const s = 1 - k * 0.35
          _scl.set(2.2 * s, 0.8 * s, 0.8 * s)
          _m.compose(_pos, _quat, _scl)
          _m.toArray(trailArr, nt * 16)
          const f = 1 - k * 0.4
          trailColor.setXYZ(nt, _color.r * f, _color.g * f, _color.b * f)
          nt++
        }
      } else {
        if (no >= ORB_POOL) continue
        const wob = 1 + Math.sin(t * 9 + pr.id) * 0.08
        _obj.position.set(pr.x, pr.y, pr.z)
        _obj.rotation.set(t * 3 + pr.id, t * 4.2, 0)
        _obj.scale.setScalar(wob)
        _obj.updateMatrix()
        _obj.matrix.toArray(orbArr, no * 16)
        _obj.rotation.set(-t * 5, t * 2.5 + pr.id, t * 1.5)
        _obj.scale.setScalar(1 + Math.sin(t * 17 + pr.id * 2) * 0.15)
        _obj.updateMatrix()
        _obj.matrix.toArray(innerArr, no * 16)
        _obj.rotation.set(0, 0, 0)
        _obj.scale.setScalar(1.25 + Math.sin(t * 6 + pr.id) * 0.12)
        _obj.updateMatrix()
        _obj.matrix.toArray(glowArr, no * 16)
        no++
      }
    }

    fire.count = nf
    trail.count = nt
    orb.count = no
    orbGlow.count = no
    orbInner.count = no
    fire.instanceMatrix.needsUpdate = true
    fireColor.needsUpdate = true
    trail.instanceMatrix.needsUpdate = true
    trailColor.needsUpdate = true
    orb.instanceMatrix.needsUpdate = true
    orbGlow.instanceMatrix.needsUpdate = true
    orbInner.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={fireRef} args={[geos.fire, mats.fire, FIRE_POOL]} frustumCulled={false} count={0} />
      <instancedMesh ref={trailRef} args={[geos.trail, mats.trail, TRAIL_POOL]} frustumCulled={false} count={0} renderOrder={4} />
      <instancedMesh ref={orbRef} args={[geos.orb, mats.orb, ORB_POOL]} frustumCulled={false} count={0} />
      <instancedMesh ref={orbInnerRef} args={[geos.orbInner, mats.orbInner, ORB_POOL]} frustumCulled={false} count={0} />
      <instancedMesh ref={orbGlowRef} args={[geos.orbGlow, mats.orbGlow, ORB_POOL]} frustumCulled={false} count={0} renderOrder={4} />
    </group>
  )
}
