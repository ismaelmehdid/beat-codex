import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useWorld } from '../../game/store'
import type { GameResult, GameState } from '../../game/types'
import type { RankedPlayer } from '../../lib/protocol'
import PodiumConfetti from './PodiumConfetti'
import { PodiumCrown, PodiumHalo, PodiumWinnerRings } from './PodiumCrown'
import TextSprite from './TextSprite'
import VoxelFighter from './VoxelFighter'
import {
  BLOCK_RISE_S,
  BLOCK_SIZE,
  DRUMROLL_END,
  DRUMROLL_START,
  FIGHTER_DROP_DELAY_S,
  FIGHTER_DROP_S,
  REVEAL_AT,
  SLOTS,
  easeOutBack,
  easeOutBounce,
  easeOutCubic,
  landedAt,
  podiumT,
  resetPodiumClock,
  seg,
  type RankSlot,
} from './podiumTiming'

const VICTORY_ACCENT = '#00f0ff'
const DEFEAT_ACCENT = '#ff2a2a'
const CONE_APEX_Y = 9.5

/**
 * 3D top-3 reveal. Mounted by GameScene inside its <Physics> while phase is PODIUM or RESULTS.
 * Camera: (0, 4.5, 15) looking at (0, 2.5, 0). Everything is driven from podiumT() every frame.
 */
export default function PodiumStage() {
  const ranking = useWorld(useShallow((w: GameState) => w.ranking))
  const result = useWorld((w) => w.result)

  useLayoutEffect(() => {
    resetPodiumClock()
    return resetPodiumClock
  }, [])

  const defeat = result === 'DEFEAT'
  const accent = defeat ? DEFEAT_ACCENT : VICTORY_ACCENT
  const top3 = useMemo(() => ranking.slice(0, 3), [ranking])

  return (
    <group>
      <PodiumFloor accent={accent} />
      <StageColliders count={top3.length} />
      <pointLight
        position={[0, 7.5, 4]}
        intensity={defeat ? 45 : 35}
        color={defeat ? '#ff3b3b' : '#ffe2a8'}
        distance={40}
        decay={2}
      />
      {SLOTS.map((slot) => {
        const entry = top3[slot.rank - 1]
        return entry ? <PodiumSlot key={slot.rank} slot={slot} entry={entry} /> : null
      })}
      <DrumrollSpot active={top3.length > 0} />
      <ResultLabel result={result} empty={ranking.length === 0} />
      <PodiumConfetti />
    </group>
  )
}

// ------------------------------------------------------------------------------------------------

function PodiumFloor({ accent }: { accent: string }) {
  const discMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#06071a',
        roughness: 0.3,
        metalness: 0.6,
        emissive: accent,
        emissiveIntensity: 0.1,
      }),
    [accent],
  )
  const rimMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.2, roughness: 0.4 }),
    [accent],
  )
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [accent],
  )

  useEffect(() => () => {
    discMat.dispose()
    rimMat.dispose()
    ringMat.dispose()
  }, [discMat, rimMat, ringMat])

  useFrame(() => {
    const t = podiumT()
    const fade = seg(t, 0, 0.8)
    rimMat.emissiveIntensity = (0.3 + 1.1 * fade) * (0.9 + 0.1 * Math.sin(t * 2.5))
    ringMat.opacity = 0.22 * fade * (0.8 + 0.2 * Math.sin(t * 1.7 + 1))
    discMat.emissiveIntensity = 0.04 + 0.08 * fade
  })

  return (
    <group>
      <mesh position={[0, -0.07, 0]} material={discMat}>
        <cylinderGeometry args={[7, 7.4, 0.16, 56]} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={rimMat}>
        <ringGeometry args={[6.82, 7.0, 72]} />
      </mesh>
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} material={ringMat}>
        <ringGeometry args={[5.2, 5.3, 72]} />
      </mesh>
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} material={ringMat}>
        <ringGeometry args={[1.9, 1.96, 64]} />
      </mesh>
    </group>
  )
}

/** Fixed colliders for confetti: a big floor slab (top at y=0) plus one box per revealed block. */
function StageColliders({ count }: { count: number }) {
  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, -0.5, 0]}>
        <CuboidCollider args={[20, 0.5, 20]} />
      </RigidBody>
      {SLOTS.filter((s) => s.rank <= count).map((s) => (
        <RigidBody key={s.rank} type="fixed" colliders={false} position={[s.x, s.height / 2, 0]}>
          <CuboidCollider args={[BLOCK_SIZE / 2, s.height / 2, BLOCK_SIZE / 2]} />
        </RigidBody>
      ))}
    </>
  )
}

// ------------------------------------------------------------------------------------------------

function PodiumSlot({ slot, entry }: { slot: RankSlot; entry: RankedPlayer }) {
  const { rank, x, height: h, color } = slot
  const blockRef = useRef<THREE.Group>(null)
  const fighterRef = useRef<THREE.Group>(null)
  const labelRef = useRef<THREE.Group>(null)
  const winnerFxRef = useRef<THREE.Group>(null)
  const revealAt = REVEAL_AT[rank]
  const landAt = landedAt(rank)
  const swayPhase = rank * 1.7

  const bodyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#0c0d1f',
        roughness: 0.25,
        metalness: 0.7,
        emissive: color,
        emissiveIntensity: 0.08,
      }),
    [color],
  )
  const topMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.5 }),
    [color],
  )
  const edgeMat = useMemo(() => new THREE.LineBasicMaterial({ color, toneMapped: false }), [color])
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(BLOCK_SIZE, h, BLOCK_SIZE)), [h])
  const coneMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [color],
  )

  useEffect(() => () => {
    bodyMat.dispose()
    topMat.dispose()
    edgeMat.dispose()
    edgesGeo.dispose()
    coneMat.dispose()
  }, [bodyMat, topMat, edgeMat, edgesGeo, coneMat])

  useFrame(() => {
    const block = blockRef.current
    const fighter = fighterRef.current
    const label = labelRef.current
    if (!block || !fighter || !label) return
    const t = podiumT()

    // Drumroll: the winner's light cone flickers before it rises.
    if (rank === 1 && t >= DRUMROLL_START && t < revealAt) {
      coneMat.opacity = 0.05 * Math.abs(Math.sin(t * 22))
    }

    const rise = seg(t, revealAt, BLOCK_RISE_S)
    if (rise <= 0) {
      block.visible = false
      fighter.visible = false
      label.visible = false
      if (winnerFxRef.current) winnerFxRef.current.visible = false
      if (rank !== 1) coneMat.opacity = 0
      return
    }

    block.visible = true
    block.position.y = -(h + 0.6) * (1 - easeOutCubic(rise))
    coneMat.opacity = 0.14 * seg(t, revealAt, 1.0) * (0.85 + 0.15 * Math.sin(t * 9 + swayPhase))

    const drop = seg(t, revealAt + FIGHTER_DROP_DELAY_S, FIGHTER_DROP_S)
    fighter.visible = drop > 0
    let y = h + 5 * (1 - easeOutBounce(drop))
    if (drop >= 1) {
      const since = t - landAt
      if (rank === 1) {
        // victory bounce forever
        y += Math.abs(Math.sin(since * 4.5)) * 0.35
        fighter.rotation.z = 0
        fighter.rotation.y = Math.sin(since * 0.9) * 0.15
      } else {
        fighter.rotation.z = Math.sin(since * 1.6 + swayPhase) * 0.06
        fighter.rotation.y = Math.sin(since * 1.1 + swayPhase) * 0.14
      }
    } else {
      fighter.rotation.z = 0
      fighter.rotation.y = 0
    }
    fighter.position.y = y

    const pop = seg(t, landAt, 0.4)
    label.visible = pop > 0
    label.scale.setScalar(Math.max(0.001, easeOutBack(pop)))

    const fx = winnerFxRef.current
    if (fx) {
      const s = seg(t, landAt + 0.1, 0.5)
      fx.visible = s > 0
      fx.scale.setScalar(Math.max(0.001, easeOutBack(s)))
    }
  })

  const coneH = CONE_APEX_Y - h
  const labelY = h + (rank === 1 ? 3.35 : 2.95)
  const name = entry.name.trim().slice(0, 14).toUpperCase() || 'HACKER'

  return (
    <group>
      {/* light cone (static; opacity animated) */}
      <mesh position={[x, h + coneH / 2, 0]} material={coneMat} renderOrder={2}>
        <cylinderGeometry args={[0.12, 1.65, coneH, 24, 1, true]} />
      </mesh>

      {/* block: origin at its base, rises from below the floor */}
      <group ref={blockRef} position={[x, 0, 0]} visible={false}>
        <mesh position={[0, h / 2, 0]} material={bodyMat}>
          <boxGeometry args={[BLOCK_SIZE, h, BLOCK_SIZE]} />
        </mesh>
        <lineSegments position={[0, h / 2, 0]} geometry={edgesGeo} material={edgeMat} />
        <mesh position={[0, h + 0.005, 0]} material={topMat}>
          <boxGeometry args={[BLOCK_SIZE - 0.25, 0.015, BLOCK_SIZE - 0.25]} />
        </mesh>
        <TextSprite text={String(rank)} color={color} height={0.9} position={[0, h / 2, BLOCK_SIZE / 2 + 0.08]} />
      </group>

      {/* fighter: drops in from above, then bounces (1st) or sways (2nd/3rd) */}
      <group ref={fighterRef} position={[x, h, 0]} visible={false}>
        <group rotation={[0, -Math.PI / 2, 0]}>
          <VoxelFighter color={entry.color} glow={rank === 1 ? 1.6 : 0.7} />
        </group>
        {rank === 1 && <PodiumCrown color={color} />}
      </group>

      {/* winner-only FX anchored to the block top (does not bounce) */}
      {rank === 1 && (
        <group ref={winnerFxRef} position={[x, h, 0]} visible={false}>
          <PodiumWinnerRings color={color} />
          <PodiumHalo color={color} />
        </group>
      )}

      {/* name + damage, pops in after landing */}
      <group ref={labelRef} position={[x, labelY, 0]} visible={false}>
        <TextSprite text={name} color={entry.color} height={0.5} position={[0, 0.3, 0]} />
        <TextSprite text={`${entry.damageDealt} DMG`} color="#f4f6ff" outline="#101226" height={0.3} position={[0, -0.18, 0]} />
      </group>
    </group>
  )
}

// ------------------------------------------------------------------------------------------------

/** Pulsing floor marker on the 1st place spot during the drumroll (t 5.5 -> 6.5). */
function DrumrollSpot({ active }: { active: boolean }) {
  const ringRef = useRef<THREE.Mesh>(null)
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SLOTS[0].color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  )
  const discMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SLOTS[0].color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  )

  useEffect(() => () => {
    ringMat.dispose()
    discMat.dispose()
  }, [ringMat, discMat])

  useFrame(() => {
    const t = podiumT()
    if (!active || t < DRUMROLL_START || t >= DRUMROLL_END + 0.3) {
      ringMat.opacity = 0
      discMat.opacity = 0
      return
    }
    const fadeOut = 1 - seg(t, DRUMROLL_END, 0.3)
    const beat = Math.abs(Math.sin((t - DRUMROLL_START) * 22))
    ringMat.opacity = (0.35 + 0.65 * beat) * fadeOut
    discMat.opacity = (0.05 + 0.2 * beat) * fadeOut
    if (ringRef.current) ringRef.current.scale.setScalar(1 + 0.1 * beat)
  })

  return (
    <group position={[SLOTS[0].x, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={ringRef} material={ringMat}>
        <ringGeometry args={[1.35, 1.6, 48]} />
      </mesh>
      <mesh material={discMat}>
        <circleGeometry args={[1.35, 48]} />
      </mesh>
    </group>
  )
}

// ------------------------------------------------------------------------------------------------

function ResultLabel({ result, empty }: { result: GameResult | null; empty: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const defeat = result === 'DEFEAT'

  useFrame(() => {
    const g = ref.current
    if (!g) return
    const t = podiumT()
    const pop = seg(t, 0.3, 0.6)
    g.visible = pop > 0
    g.scale.setScalar(Math.max(0.001, easeOutBack(pop)))
    g.position.y = 6.6 + Math.sin(t * 1.5) * 0.08
  })

  return (
    <group ref={ref} position={[0, 6.6, 0]} visible={false}>
      {defeat ? (
        <TextSprite text="CODEX WINS" color="#ff2a2a" outline="#3a0008" height={0.9} />
      ) : (
        <TextSprite text="YOU BEAT CODEX!" color="#ffd23f" outline="#00a8b8" height={0.9} />
      )}
      {empty && <TextSprite text="NO FIGHTERS" color="#8b90b8" outline="#05050f" height={0.6} position={[0, -3.4, 0]} />}
    </group>
  )
}
