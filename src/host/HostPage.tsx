import { useLayoutEffect, useMemo } from 'react'
import { connectedPlayerCount, skipToResults } from '../game/engine'
import { bumpWorld, getWorld, useHostStore, useWorld } from '../game/store'
import { getOrCreateHostRoomId } from '../lib/roomId'
import { useHostChannel, type NetStatus } from '../net/useHostChannel'
import Countdown from './Countdown'
import DebugPanel from './DebugPanel'
import EndBanner from './EndBanner'
import HUD from './HUD'
import Lobby from './Lobby'
import Results from './Results'
import GameScene from './scene/GameScene'
import { useGameLoop } from './useGameLoop'
import './host.css'

const NET_LABEL: Record<NetStatus, string> = {
  disabled: 'offline',
  connecting: 'connecting',
  connected: 'online',
  error: 'error',
}

function RoomBadge({ roomId, status }: { roomId: string; status: NetStatus }) {
  const count = useWorld(connectedPlayerCount)
  return (
    <div className="room-badge">
      Room <b>{roomId}</b> {'·'} {count} connected {'·'} net:{' '}
      <span className={`net-${status}`}>{NET_LABEL[status]}</span>
    </div>
  )
}

function PodiumOverlay() {
  const onSkip = () => {
    skipToResults(getWorld(), performance.now())
    bumpWorld()
  }
  return (
    <>
      <div className="podium-banner">Top 3</div>
      <button className="btn btn-small podium-skip" onClick={onSkip}>
        Skip
      </button>
    </>
  )
}

export default function HostPage() {
  const roomId = useMemo(() => getOrCreateHostRoomId(window.location.search), [])
  const debug = useMemo(() => new URLSearchParams(window.location.search).get('debug') === 'true', [])

  useLayoutEffect(() => {
    getWorld().roomId = roomId
    useHostStore.getState().setDebug(debug)
    bumpWorld()
  }, [roomId, debug])

  const net = useHostChannel(roomId)
  useGameLoop(net.drain)

  const phase = useWorld((w) => w.phase)
  const inGame = phase !== 'LOBBY'
  const showHud = phase === 'PLAYING' || phase === 'VICTORY' || phase === 'DEFEAT'
  const showEnd = phase === 'VICTORY' || phase === 'DEFEAT'

  return (
    <div className="host-root">
      {!inGame ? (
        <Lobby roomId={roomId} netStatus={net.status} />
      ) : (
        <>
          <div className="host-scene">
            <GameScene />
          </div>
          {phase === 'COUNTDOWN' && <Countdown />}
          {showHud && <HUD />}
          {showEnd && <EndBanner />}
          {phase === 'PODIUM' && <PodiumOverlay />}
          {phase === 'RESULTS' && <Results />}
          <RoomBadge roomId={roomId} status={net.status} />
        </>
      )}
      {debug && <DebugPanel />}
    </div>
  )
}
