/**
 * CPU-simulated FX pools shared by the whole scene. Data only (no React): any component may
 * spawn into them from useFrame; `Effects.tsx` owns the InstancedMeshes that draw them.
 * All times are performance.now() ms (same clock base as the engine's host clock).
 */
import * as THREE from 'three'

const _c = new THREE.Color()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _scl = new THREE.Vector3()
const _m = new THREE.Matrix4()

export type ColorLike = string | number | THREE.Color

function writeColor(color: ColorLike, out: Float32Array, o: number, mul: number): void {
  _c.set(color as THREE.ColorRepresentation)
  out[o] = _c.r * mul
  out[o + 1] = _c.g * mul
  out[o + 2] = _c.b * mul
}

/** Uniform random direction on the unit sphere into (out[0..2]). */
const _dir: [number, number, number] = [0, 0, 0]
function randomDir(): [number, number, number] {
  const u = Math.random() * 2 - 1
  const a = Math.random() * Math.PI * 2
  const r = Math.sqrt(Math.max(0, 1 - u * u))
  _dir[0] = r * Math.cos(a)
  _dir[1] = u
  _dir[2] = r * Math.sin(a)
  return _dir
}

// ------------------------------------------------------------------------------------------------
// Particles: small spinning cubes with gravity/drag, faded via scale. Dense storage (swap-remove).
// ------------------------------------------------------------------------------------------------

export interface BurstOptions {
  speed?: number
  /** 0..1 randomization of speed (default 0.6) */
  spread?: number
  life?: number
  size?: number
  gravity?: number
  drag?: number
  /** directional bias added to every velocity (world units/s) */
  bias?: [number, number, number]
  /** HDR multiplier so particles bloom (default 1.4) */
  brightness?: number
  bounce?: boolean
}

export class ParticlePool {
  readonly capacity: number
  count = 0
  readonly pos: Float32Array
  readonly vel: Float32Array
  readonly life: Float32Array
  readonly maxLife: Float32Array
  readonly size: Float32Array
  readonly color: Float32Array
  readonly gravity: Float32Array
  readonly drag: Float32Array
  readonly spin: Float32Array
  readonly bounce: Uint8Array

  constructor(capacity: number) {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 3)
    this.vel = new Float32Array(capacity * 3)
    this.life = new Float32Array(capacity)
    this.maxLife = new Float32Array(capacity)
    this.size = new Float32Array(capacity)
    this.color = new Float32Array(capacity * 3)
    this.gravity = new Float32Array(capacity)
    this.drag = new Float32Array(capacity)
    this.spin = new Float32Array(capacity)
    this.bounce = new Uint8Array(capacity)
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    color: ColorLike,
    gravity = 20,
    drag = 1.2,
    bounce = true,
    brightness = 1.4,
  ): void {
    let i: number
    if (this.count < this.capacity) i = this.count++
    else i = Math.floor(Math.random() * this.capacity) // pool full: recycle a random particle
    const i3 = i * 3
    this.pos[i3] = x
    this.pos[i3 + 1] = y
    this.pos[i3 + 2] = z
    this.vel[i3] = vx
    this.vel[i3 + 1] = vy
    this.vel[i3 + 2] = vz
    this.life[i] = life
    this.maxLife[i] = life
    this.size[i] = size
    this.gravity[i] = gravity
    this.drag[i] = drag
    this.spin[i] = (Math.random() - 0.5) * 12
    this.bounce[i] = bounce ? 1 : 0
    writeColor(color, this.color, i3, brightness)
  }

  burst(x: number, y: number, z: number, n: number, color: ColorLike, o: BurstOptions = {}): void {
    const speed = o.speed ?? 6
    const spread = o.spread ?? 0.6
    const life = o.life ?? 0.6
    const size = o.size ?? 0.15
    const gravity = o.gravity ?? 20
    const drag = o.drag ?? 1.2
    const bx = o.bias?.[0] ?? 0
    const by = o.bias?.[1] ?? 0
    const bz = o.bias?.[2] ?? 0
    const brightness = o.brightness ?? 1.4
    const bounce = o.bounce ?? true
    for (let k = 0; k < n; k++) {
      const d = randomDir()
      const s = speed * (1 - spread + Math.random() * spread * 2)
      const l = life * (0.6 + Math.random() * 0.8)
      const sz = size * (0.6 + Math.random() * 0.8)
      this.emit(x, y, z, d[0] * s + bx, d[1] * s + by, d[2] * s + bz, l, sz, color, gravity, drag, bounce, brightness)
    }
  }

  private remove(i: number): void {
    const last = --this.count
    if (i === last) return
    const i3 = i * 3
    const l3 = last * 3
    this.pos[i3] = this.pos[l3]
    this.pos[i3 + 1] = this.pos[l3 + 1]
    this.pos[i3 + 2] = this.pos[l3 + 2]
    this.vel[i3] = this.vel[l3]
    this.vel[i3 + 1] = this.vel[l3 + 1]
    this.vel[i3 + 2] = this.vel[l3 + 2]
    this.color[i3] = this.color[l3]
    this.color[i3 + 1] = this.color[l3 + 1]
    this.color[i3 + 2] = this.color[l3 + 2]
    this.life[i] = this.life[last]
    this.maxLife[i] = this.maxLife[last]
    this.size[i] = this.size[last]
    this.gravity[i] = this.gravity[last]
    this.drag[i] = this.drag[last]
    this.spin[i] = this.spin[last]
    this.bounce[i] = this.bounce[last]
  }

  update(dt: number): void {
    let i = 0
    while (i < this.count) {
      const life = this.life[i] - dt
      if (life <= 0) {
        this.remove(i)
        continue
      }
      this.life[i] = life
      const i3 = i * 3
      const dr = Math.max(0, 1 - this.drag[i] * dt)
      let vx = this.vel[i3] * dr
      let vy = (this.vel[i3 + 1] - this.gravity[i] * dt) * dr
      let vz = this.vel[i3 + 2] * dr
      let y = this.pos[i3 + 1] + vy * dt
      if (y < 0.04 && this.bounce[i]) {
        y = 0.04
        vy = -vy * 0.45
        vx *= 0.75
        vz *= 0.75
      }
      this.pos[i3] += vx * dt
      this.pos[i3 + 1] = y
      this.pos[i3 + 2] += vz * dt
      this.vel[i3] = vx
      this.vel[i3 + 1] = vy
      this.vel[i3 + 2] = vz
      i++
    }
  }

  /** Writes dense instance matrices + colors into the mesh and sets count. */
  write(mesh: THREE.InstancedMesh, timeSec: number): void {
    const arr = mesh.instanceMatrix.array as Float32Array
    if (mesh.instanceColor === null) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3)
    }
    const col = mesh.instanceColor.array as Float32Array
    const n = this.count
    for (let i = 0; i < n; i++) {
      const i3 = i * 3
      const o = i * 16
      const f = this.life[i] / this.maxLife[i]
      const s = this.size[i] * Math.min(1, f * 1.6)
      const a = this.spin[i] * timeSec
      const c = Math.cos(a) * s
      const sn = Math.sin(a) * s
      arr[o] = c
      arr[o + 1] = 0
      arr[o + 2] = -sn
      arr[o + 3] = 0
      arr[o + 4] = 0
      arr[o + 5] = s
      arr[o + 6] = 0
      arr[o + 7] = 0
      arr[o + 8] = sn
      arr[o + 9] = 0
      arr[o + 10] = c
      arr[o + 11] = 0
      arr[o + 12] = this.pos[i3]
      arr[o + 13] = this.pos[i3 + 1]
      arr[o + 14] = this.pos[i3 + 2]
      arr[o + 15] = 1
      col[i3] = this.color[i3]
      col[i3 + 1] = this.color[i3 + 1]
      col[i3 + 2] = this.color[i3 + 2]
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
  }
}

// ------------------------------------------------------------------------------------------------
// Flashes: expanding additive spheres fading over a duration.
// ------------------------------------------------------------------------------------------------

export class FlashPool {
  readonly capacity: number
  private next = 0
  readonly active: Uint8Array
  readonly pos: Float32Array
  readonly start: Float64Array
  readonly dur: Float32Array
  readonly r0: Float32Array
  readonly r1: Float32Array
  readonly color: Float32Array

  constructor(capacity: number) {
    this.capacity = capacity
    this.active = new Uint8Array(capacity)
    this.pos = new Float32Array(capacity * 3)
    this.start = new Float64Array(capacity)
    this.dur = new Float32Array(capacity)
    this.r0 = new Float32Array(capacity)
    this.r1 = new Float32Array(capacity)
    this.color = new Float32Array(capacity * 3)
  }

  spawn(x: number, y: number, z: number, r0: number, r1: number, durMs: number, color: ColorLike, brightness = 1.2): void {
    const i = this.next
    this.next = (this.next + 1) % this.capacity
    const i3 = i * 3
    this.active[i] = 1
    this.pos[i3] = x
    this.pos[i3 + 1] = y
    this.pos[i3 + 2] = z
    this.start[i] = performance.now()
    this.dur[i] = durMs
    this.r0[i] = r0
    this.r1[i] = r1
    writeColor(color, this.color, i3, brightness)
  }

  write(mesh: THREE.InstancedMesh, now: number): void {
    const arr = mesh.instanceMatrix.array as Float32Array
    if (mesh.instanceColor === null) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3)
    }
    const col = mesh.instanceColor.array as Float32Array
    let n = 0
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue
      const k = (now - this.start[i]) / this.dur[i]
      if (k >= 1) {
        this.active[i] = 0
        continue
      }
      const i3 = i * 3
      const e = 1 - (1 - k) * (1 - k) // ease-out
      const r = this.r0[i] + (this.r1[i] - this.r0[i]) * e
      const fade = (1 - k) * (1 - k)
      const o = n * 16
      arr[o] = r
      arr[o + 1] = 0
      arr[o + 2] = 0
      arr[o + 3] = 0
      arr[o + 4] = 0
      arr[o + 5] = r
      arr[o + 6] = 0
      arr[o + 7] = 0
      arr[o + 8] = 0
      arr[o + 9] = 0
      arr[o + 10] = r
      arr[o + 11] = 0
      arr[o + 12] = this.pos[i3]
      arr[o + 13] = this.pos[i3 + 1]
      arr[o + 14] = this.pos[i3 + 2]
      arr[o + 15] = 1
      const c3 = n * 3
      col[c3] = this.color[i3] * fade
      col[c3 + 1] = this.color[i3 + 1] * fade
      col[c3 + 2] = this.color[i3 + 2] * fade
      n++
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
  }
}

// ------------------------------------------------------------------------------------------------
// Rings: expanding flat rings, either lying on the floor or facing the camera (XY plane).
// ------------------------------------------------------------------------------------------------

const FLOOR_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
const FACING_QUAT = new THREE.Quaternion()

export class RingPool {
  readonly capacity: number
  private next = 0
  readonly active: Uint8Array
  readonly pos: Float32Array
  readonly start: Float64Array
  readonly dur: Float32Array
  readonly r0: Float32Array
  readonly r1: Float32Array
  readonly rise: Float32Array
  readonly facing: Uint8Array
  readonly color: Float32Array

  constructor(capacity: number) {
    this.capacity = capacity
    this.active = new Uint8Array(capacity)
    this.pos = new Float32Array(capacity * 3)
    this.start = new Float64Array(capacity)
    this.dur = new Float32Array(capacity)
    this.r0 = new Float32Array(capacity)
    this.r1 = new Float32Array(capacity)
    this.rise = new Float32Array(capacity)
    this.facing = new Uint8Array(capacity)
    this.color = new Float32Array(capacity * 3)
  }

  spawn(
    x: number,
    y: number,
    z: number,
    r0: number,
    r1: number,
    durMs: number,
    color: ColorLike,
    opts: { rise?: number; facing?: boolean; delayMs?: number; brightness?: number } = {},
  ): void {
    const i = this.next
    this.next = (this.next + 1) % this.capacity
    const i3 = i * 3
    this.active[i] = 1
    this.pos[i3] = x
    this.pos[i3 + 1] = y
    this.pos[i3 + 2] = z
    this.start[i] = performance.now() + (opts.delayMs ?? 0)
    this.dur[i] = durMs
    this.r0[i] = r0
    this.r1[i] = r1
    this.rise[i] = opts.rise ?? 0
    this.facing[i] = opts.facing ? 1 : 0
    writeColor(color, this.color, i3, opts.brightness ?? 1.3)
  }

  write(mesh: THREE.InstancedMesh, now: number): void {
    const arr = mesh.instanceMatrix.array as Float32Array
    if (mesh.instanceColor === null) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3)
    }
    const col = mesh.instanceColor.array as Float32Array
    let n = 0
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue
      const k = (now - this.start[i]) / this.dur[i]
      if (k < 0) continue // delayed
      if (k >= 1) {
        this.active[i] = 0
        continue
      }
      const i3 = i * 3
      const e = 1 - (1 - k) * (1 - k)
      const r = this.r0[i] + (this.r1[i] - this.r0[i]) * e
      const fade = 1 - k
      _pos.set(this.pos[i3], this.pos[i3 + 1] + this.rise[i] * e, this.pos[i3 + 2])
      _scl.set(r, r, r)
      _quat.copy(this.facing[i] ? FACING_QUAT : FLOOR_QUAT)
      _m.compose(_pos, _quat, _scl)
      _m.toArray(arr, n * 16)
      const c3 = n * 3
      col[c3] = this.color[i3] * fade
      col[c3 + 1] = this.color[i3 + 1] * fade
      col[c3 + 2] = this.color[i3 + 2] * fade
      n++
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
  }
}

export const PARTICLE_CAPACITY = 3000
export const FLASH_CAPACITY = 48
export const RING_CAPACITY = 48

export const particles = new ParticlePool(PARTICLE_CAPACITY)
export const flashes = new FlashPool(FLASH_CAPACITY)
export const rings = new RingPool(RING_CAPACITY)
