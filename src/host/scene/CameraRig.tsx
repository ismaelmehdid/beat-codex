/**
 * Fixed cinematic side camera. Fight framing fits the whole player zone + boss for the current
 * aspect; podium framing for PODIUM/RESULTS. Smooth lerp between rigs, screen shake from
 * world.shake, and a slow dolly-in toward CODEX during VICTORY.
 */
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { BOSS_X, BOSS_Y, PLAYER_MIN_X, VICTORY_DURATION_MS } from '../../game/constants'
import { getWorld } from '../../game/store'

const FOV = 50
const LEFT = PLAYER_MIN_X - 1.2
const RIGHT = BOSS_X + 5.6 // satellites orbit past the core
const TOP = 9.8
const BOTTOM = -0.6

const PODIUM_POS = new THREE.Vector3(0, 4.5, 15)
const PODIUM_LOOK = new THREE.Vector3(0, 2.5, 0)
const VICTORY_POS = new THREE.Vector3(BOSS_X - 9, 6.5, 15)
const VICTORY_LOOK = new THREE.Vector3(BOSS_X - 1, BOSS_Y - 1, 0)
const DEFEAT_LOOK = new THREE.Vector3(BOSS_X - 4, BOSS_Y - 1, 0)

const _goalPos = new THREE.Vector3()
const _goalLook = new THREE.Vector3()
const _fightPos = new THREE.Vector3()
const _fightLook = new THREE.Vector3()

function fightFraming(aspect: number, pos: THREE.Vector3, look: THREE.Vector3): void {
  const tanHalf = Math.tan((FOV * Math.PI) / 360)
  const cx = (LEFT + RIGHT) / 2
  const cy = (TOP + BOTTOM) / 2
  const halfW = ((RIGHT - LEFT) / 2) * 1.03
  const halfH = ((TOP - BOTTOM) / 2) * 1.08
  const d = Math.max(halfW / (tanHalf * Math.max(0.5, aspect)), halfH / tanHalf)
  look.set(cx, cy - 0.75, 0)
  pos.set(cx, cy + 2.5, d)
}

export default function CameraRig() {
  const cur = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false })

  useFrame(({ camera, clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const w = getWorld()
    const phase = w.phase
    const cam = camera as THREE.PerspectiveCamera
    const aspect = cam.aspect || 16 / 9
    fightFraming(aspect, _fightPos, _fightLook)

    if (phase === 'PODIUM' || phase === 'RESULTS') {
      _goalPos.copy(PODIUM_POS)
      _goalLook.copy(PODIUM_LOOK)
    } else if (phase === 'VICTORY') {
      const p = Math.max(0, Math.min(1, (w.now - w.phaseStartedAt) / VICTORY_DURATION_MS))
      const e = p * p * (3 - 2 * p)
      _goalPos.copy(_fightPos).lerp(VICTORY_POS, e * 0.55)
      _goalLook.copy(_fightLook).lerp(VICTORY_LOOK, e * 0.7)
    } else if (phase === 'DEFEAT') {
      _goalPos.copy(_fightPos)
      _goalLook.copy(_fightLook).lerp(DEFEAT_LOOK, 0.35)
    } else {
      _goalPos.copy(_fightPos)
      _goalLook.copy(_fightLook)
    }

    const c = cur.current
    if (!c.init) {
      c.pos.copy(_goalPos)
      c.look.copy(_goalLook)
      c.init = true
    } else {
      const k = 1 - Math.exp(-dt * 3.5)
      c.pos.lerp(_goalPos, k)
      c.look.lerp(_goalLook, k)
    }

    cam.position.copy(c.pos)
    const s = w.shake
    let roll = 0
    if (s > 0) {
      const t = clock.elapsedTime
      const a = 0.35 * s
      cam.position.x += a * (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7 + 1.3) * 0.4)
      cam.position.y += a * (Math.sin(t * 43.3 + 2.1) * 0.6 + Math.sin(t * 71.9 + 0.7) * 0.4)
      roll = 0.018 * s * Math.sin(t * 29.3)
    }
    cam.lookAt(c.look)
    if (roll !== 0) cam.rotateZ(roll)
    if (Math.abs(cam.fov - FOV) > 0.01) {
      cam.fov = FOV
      cam.updateProjectionMatrix()
    }
  })

  return null
}
