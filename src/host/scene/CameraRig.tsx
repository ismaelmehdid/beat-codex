/**
 * Fixed cinematic camera. The fight rig sits behind and to the side of the squad, looking down
 * the lane at CODEX: the audience sees the fighters' backs, CODEX looms ahead, and the strafe
 * axis (Z) reads across the screen. Podium framing is a separate head-on rig.
 *
 * The fight distance is solved exactly: every corner of the must-fit box is projected against the
 * frustum, so the whole arena stays in frame at any window aspect without hand-tuned numbers.
 */
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import {
  BOSS_X,
  BOSS_Y,
  PLAYER_LINE_X,
  PLAYER_MAX_Z,
  PLAYER_MIN_Z,
  VICTORY_DURATION_MS,
} from '../../game/constants'
import { getWorld } from '../../game/store'

const FOV = 50
/** Swing away from straight-behind, toward +Z. Keeps it a three-quarter view, not a flat rail shot. */
const YAW = THREE.MathUtils.degToRad(22)
/** Camera elevation above the look target. */
const PITCH = THREE.MathUtils.degToRad(13)
/** Breathing room around the must-fit box. */
const MARGIN = 1.04

/** Everything that must stay on screen during a fight. */
const FIT_MIN = new THREE.Vector3(PLAYER_LINE_X - 2, 0, PLAYER_MIN_Z - 1.8)
const FIT_MAX = new THREE.Vector3(BOSS_X + 4.5, 9.7, PLAYER_MAX_Z + 1.8)
const FIGHT_LOOK = new THREE.Vector3(1.5, 3.3, 0)

const PODIUM_POS = new THREE.Vector3(0, 4.5, 15)
const PODIUM_LOOK = new THREE.Vector3(0, 2.5, 0)
const VICTORY_LOOK = new THREE.Vector3(BOSS_X - 1, BOSS_Y - 0.5, 0)
const DEFEAT_LOOK = new THREE.Vector3(BOSS_X - 3, BOSS_Y - 1.5, 0)

const _goalPos = new THREE.Vector3()
const _goalLook = new THREE.Vector3()
const _fightPos = new THREE.Vector3()
const _victoryPos = new THREE.Vector3()
const _offset = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _corner = new THREE.Vector3()

/** Unit vector from the look target back to the camera. */
function offsetDir(out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(PITCH)
  // -X is "behind the squad"; swinging toward +Z puts the camera off to one side.
  return out.set(-Math.cos(YAW) * cp, Math.sin(PITCH), Math.sin(YAW) * cp)
}

/** Smallest distance along `offsetDir` that keeps the whole fit box inside the frustum. */
function fightFraming(aspect: number, pos: THREE.Vector3): void {
  offsetDir(_offset)
  _fwd.copy(_offset).multiplyScalar(-1)
  _right.set(-_fwd.z, 0, _fwd.x).normalize()
  _up.crossVectors(_right, _fwd).normalize()

  const tanV = Math.tan((FOV * Math.PI) / 360)
  const tanH = tanV * Math.max(0.5, aspect)

  let d = 0
  for (let i = 0; i < 8; i++) {
    _corner
      .set(i & 1 ? FIT_MAX.x : FIT_MIN.x, i & 2 ? FIT_MAX.y : FIT_MIN.y, i & 4 ? FIT_MAX.z : FIT_MIN.z)
      .sub(FIGHT_LOOK)
    const need =
      Math.max(Math.abs(_corner.dot(_right)) / tanH, Math.abs(_corner.dot(_up)) / tanV) - _corner.dot(_fwd)
    if (need > d) d = need
  }
  pos.copy(FIGHT_LOOK).addScaledVector(_offset, d * MARGIN)
}

export default function CameraRig() {
  const cur = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false })

  useFrame(({ camera, clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const w = getWorld()
    const phase = w.phase
    const cam = camera as THREE.PerspectiveCamera
    const aspect = cam.aspect || 16 / 9
    fightFraming(aspect, _fightPos)

    if (phase === 'PODIUM' || phase === 'RESULTS') {
      _goalPos.copy(PODIUM_POS)
      _goalLook.copy(PODIUM_LOOK)
    } else if (phase === 'VICTORY') {
      // Same angle, pushed in on CODEX for the death sequence.
      _victoryPos.set(BOSS_X, BOSS_Y - 0.5, 0).addScaledVector(offsetDir(_offset), 19)
      const p = Math.max(0, Math.min(1, (w.now - w.phaseStartedAt) / VICTORY_DURATION_MS))
      const e = p * p * (3 - 2 * p)
      _goalPos.copy(_fightPos).lerp(_victoryPos, e * 0.7)
      _goalLook.copy(FIGHT_LOOK).lerp(VICTORY_LOOK, e * 0.8)
    } else if (phase === 'DEFEAT') {
      _goalPos.copy(_fightPos)
      _goalLook.copy(FIGHT_LOOK).lerp(DEFEAT_LOOK, 0.4)
    } else {
      _goalPos.copy(_fightPos)
      _goalLook.copy(FIGHT_LOOK)
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
