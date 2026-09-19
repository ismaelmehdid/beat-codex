/**
 * One VoxelFighter per player, reconciled from world.playerOrder. Per-frame transforms, HP bar,
 * hit flash and the dead/respawn beacon are driven from getWorld() without React re-renders.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { PLAYER_HP, PLAYER_SPEED, RESPAWN_DELAY_MS, spawnZForIndex, xForIndex } from '../../game/constants'
import { getWorld, useWorld } from '../../game/store'
import TextSprite from './TextSprite'
import VoxelFighter from './VoxelFighter'

const discGeo = new THREE.CircleGeometry(0.95, 28)
const discRingGeo = new THREE.RingGeometry(0.88, 1.0, 36)
const beaconRingGeo = new THREE.RingGeometry(0.82, 1, 40)
const beamGeo = new THREE.CylinderGeometry(0.42, 0.42, 2.6, 14, 1, true)
const HP_W = 1.3
const hpBgGeo = new THREE.BoxGeometry(HP_W + 0.08, 0.14, 0.05)
const hpFillGeo = new THREE.BoxGeometry(HP_W, 0.09, 0.08)
const hpBgMat = new THREE.MeshBasicMaterial({ color: '#0a0a16' })
const LOW_HP = new THREE.Color('#ff2a2a')
const FLAT = new THREE.Euler(-Math.PI / 2, 0, 0)

function Fighter({ id }: { id: string }) {
  const color = useWorld((w) => w.players[id]?.color ?? '#ffffff')
  const name = useWorld((w) => w.players[id]?.name ?? '')

  const outer = useRef<THREE.Group>(null)
  const model = useRef<THREE.Group>(null)
  const live = useRef<THREE.Group>(null)
  const label = useRef<THREE.Group>(null)
  const hpFill = useRef<THREE.Mesh>(null)
  const beacon = useRef<THREE.Group>(null)
  const beaconRing = useRef<THREE.Mesh>(null)
  const beam = useRef<THREE.Mesh>(null)
  const walkRef = useRef(0)
  const flashRef = useRef(0)
  const dimRef = useRef(1)

  const mats = useMemo(() => {
    const base = new THREE.Color(color)
    return {
      base,
      disc: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
      ring: new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(1.3), toneMapped: false }),
      hpFill: new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      beacon: new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(1.3), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      beam: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    }
  }, [color])

  useFrame(({ clock }) => {
    const o = outer.current
    if (!o) return
    const w = getWorld()
    const p = w.players[id]
    if (!p) {
      o.visible = false
      return
    }
    o.visible = true
    const now = w.now
    const alive = p.alive
    o.position.set(p.x, 0, p.z)

    if (model.current) {
      model.current.visible = alive
      // Always squared up at CODEX (+X); strafing only leans the body.
      model.current.rotation.y = 0
      model.current.rotation.x = (p.vz / PLAYER_SPEED) * 0.12
    }
    if (live.current) live.current.visible = alive
    if (label.current) label.current.visible = p.connected
    walkRef.current = Math.min(1, Math.abs(p.vz) / PLAYER_SPEED)
    flashRef.current = now - p.lastHitAt < 120 ? 1 : 0
    dimRef.current = p.connected ? 1 : 0.35
    mats.disc.opacity = p.connected ? 0.35 : 0.12

    const f = Math.max(0, Math.min(1, p.hp / PLAYER_HP))
    const fill = hpFill.current
    if (fill) {
      fill.scale.x = Math.max(0.001, f)
      fill.position.x = -(1 - f) * (HP_W / 2)
      mats.hpFill.color.copy(mats.base)
      if (f < 0.35) mats.hpFill.color.lerp(LOW_HP, 0.75)
    }

    const bc = beacon.current
    if (bc) {
      bc.visible = !alive
      if (!alive) {
        bc.position.set(xForIndex(p.index) - p.x, 0.03, spawnZForIndex(p.index) - p.z)
        const remaining = p.respawnAt !== null ? Math.max(0, Math.min(1, (p.respawnAt - now) / RESPAWN_DELAY_MS)) : 1
        const s = 0.45 + remaining * 1.7
        const t = clock.elapsedTime
        if (beaconRing.current) {
          beaconRing.current.scale.set(s, s, 1)
          beaconRing.current.rotation.z = t * 1.5
        }
        if (beam.current) {
          const grow = 0.3 + (1 - remaining) * 0.9
          beam.current.scale.set(grow, 1, grow)
          mats.beam.opacity = 0.08 + (1 - remaining) * 0.2 + Math.sin(t * 8) * 0.03
        }
      }
    }
  })

  return (
    <group ref={outer}>
      <group ref={model}>
        <VoxelFighter color={color} walkRef={walkRef} flashRef={flashRef} dimRef={dimRef} scale={1.15} />
      </group>
      <group ref={live}>
        <mesh geometry={discGeo} material={mats.disc} rotation={FLAT} position={[0, 0.02, 0]} />
        <mesh geometry={discRingGeo} material={mats.ring} rotation={FLAT} position={[0, 0.03, 0]} />
        <group ref={label}>
          <TextSprite text={name} color={color} height={0.55} position={[0, 2.9, 0]} />
        </group>
        <group position={[0, 2.5, 0]}>
          <mesh geometry={hpBgGeo} material={hpBgMat} />
          <mesh ref={hpFill} geometry={hpFillGeo} material={mats.hpFill} />
        </group>
      </group>
      <group ref={beacon} visible={false}>
        <mesh ref={beaconRing} geometry={beaconRingGeo} material={mats.beacon} rotation={FLAT} />
        <mesh ref={beam} geometry={beamGeo} material={mats.beam} position={[0, 1.3, 0]} />
      </group>
    </group>
  )
}

export default function Fighters() {
  const ids = useWorld(useShallow((w) => w.playerOrder))
  return (
    <>
      {ids.map((id) => (
        <Fighter key={id} id={id} />
      ))}
    </>
  )
}
