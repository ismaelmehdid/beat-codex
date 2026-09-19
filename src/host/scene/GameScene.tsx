/**
 * Full-viewport 3D scene for the host. One WebGL context for the whole session: fight content
 * during LOBBY/COUNTDOWN/PLAYING/VICTORY/DEFEAT, the podium during PODIUM/RESULTS.
 * Append `?nobloom=1` to the host URL to disable post-processing on weak GPUs.
 */
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Canvas } from '@react-three/fiber'
import { CuboidCollider, Physics } from '@react-three/rapier'
import { Suspense, useMemo } from 'react'
import { useWorld } from '../../game/store'
import Arena from './Arena'
import CameraRig from './CameraRig'
import Codex from './Codex'
import Effects from './Effects'
import Fighters from './Fighters'
import PodiumStage from './PodiumStage'
import Projectiles from './Projectiles'

const BG = '#050510'

export default function GameScene() {
  const phase = useWorld((w) => w.phase)
  const podium = phase === 'PODIUM' || phase === 'RESULTS'
  const bloom = useMemo(() => !/(^|[?&])nobloom=1(&|$)/.test(window.location.search), [])

  return (
    <Canvas
      style={{ position: 'absolute', inset: 0 }}
      dpr={[1, 1.5]}
      flat
      camera={{ fov: 50, near: 0.5, far: 300, position: [0, 6, 24] }}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false }}
    >
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 50, 140]} />
      <CameraRig />
      <Arena />
      <Suspense fallback={null}>
        <Physics gravity={[0, -20, 0]}>
          {/* invisible floor for debris and the podium */}
          <CuboidCollider args={[80, 0.5, 40]} position={[0, -0.5, 0]} friction={0.9} />
          {!podium && (
            <>
              <Fighters />
              <Codex />
              <Projectiles />
            </>
          )}
          {podium && <PodiumStage />}
          <Effects />
        </Physics>
      </Suspense>
      {bloom && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.72} luminanceSmoothing={0.3} radius={0.7} />
        </EffectComposer>
      )}
    </Canvas>
  )
}
