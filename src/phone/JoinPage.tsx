/**
 * /join?room=XXXX - the phone client. Screens: invalid room / not configured, name entry,
 * waiting, controller (COUNTDOWN | PLAYING), result (VICTORY | DEFEAT | PODIUM | RESULTS).
 */
import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { RankedPlayer } from '../lib/protocol'
import { getOrCreatePlayerId, getStoredName, MAX_NAME_LENGTH, storeName, validateName } from '../lib/playerIdentity'
import { isValidRoomId } from '../lib/roomId'
import { supabase } from '../lib/supabase'
import { usePlayerChannel, type ChannelStatus } from '../net/usePlayerChannel'
import Controller from './Controller'
import './phone.css'

const prevent = (e: { preventDefault: () => void }) => e.preventDefault()

function safePlayerId(): string {
  try {
    return getOrCreatePlayerId()
  } catch {
    // Storage blocked: still playable for this session.
    return 'p_' + Math.random().toString(36).slice(2, 14)
  }
}

function safeStoredName(): string {
  try {
    return getStoredName()
  } catch {
    return ''
  }
}

function nameStyle(color: string | null | undefined): CSSProperties {
  return { ['--name-color' as string]: color || '#ffffff' } as CSSProperties
}

const STATUS_LABEL: Record<ChannelStatus, string> = {
  disabled: 'OFFLINE',
  connecting: 'CONNECTING',
  connected: 'CONNECTED',
  error: 'RECONNECTING',
}

function Dot({ status, label }: { status: ChannelStatus; label?: boolean }) {
  return (
    <div className="ph-corner">
      {label && <span>{STATUS_LABEL[status]}</span>}
      <span className={`ph-dot ph-dot--${status}`} title={status} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------

function MessageScreen({ children }: { children: ReactNode }) {
  return (
    <div className="ph ph--center" onContextMenu={prevent}>
      <h1 className="ph-title ph-title--small">BEAT CODEX</h1>
      <p className="ph-msg">{children}</p>
    </div>
  )
}

function NameEntry({ roomId, onJoin }: { roomId: string; onJoin: (name: string) => void }) {
  const [value, setValue] = useState(() => safeStoredName())
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = validateName(value)
    if (!v.ok) {
      setError(v.error)
      return
    }
    setError(null)
    onJoin(v.name)
  }

  return (
    <div className="ph ph--center" onContextMenu={prevent}>
      <h1 className="ph-title">BEAT CODEX</h1>
      <p className="ph-sub">ENTER YOUR FIGHTER NAME</p>
      <form className="ph-form" onSubmit={submit}>
        <input
          className="ph-input"
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          maxLength={MAX_NAME_LENGTH}
          autoFocus
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="FIGHTER NAME"
          aria-label="Fighter name"
        />
        <button type="submit" className="ph-join">
          JOIN
        </button>
        <p className="ph-error" role="alert">
          {error ?? ''}
        </p>
      </form>
      <p className="ph-room">
        ROOM <b>{roomId}</b>
      </p>
    </div>
  )
}

function WaitingScreen({
  name,
  color,
  roomId,
  status,
}: {
  name: string
  color: string | null
  roomId: string
  status: ChannelStatus
}) {
  return (
    <div className="ph ph--center" onContextMenu={prevent}>
      <Dot status={status} label />
      <p className="ph-in">YOU'RE IN</p>
      <h1 className="ph-bigname" style={nameStyle(color)}>
        {name}
      </h1>
      <p className="ph-sub ph-pulse">Waiting for the host...</p>
      <p className="ph-room">
        ROOM <b>{roomId}</b>
      </p>
    </div>
  )
}

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function ResultScreen({
  playerId,
  name,
  color,
  result,
  ranking,
  status,
}: {
  playerId: string
  name: string
  color: string | null
  result: 'VICTORY' | 'DEFEAT' | null
  ranking: RankedPlayer[] | null
  status: ChannelStatus
}) {
  if (!ranking || !result) {
    return (
      <div className="ph ph--center" onContextMenu={prevent}>
        <Dot status={status} label />
        <h1 className="ph-title ph-title--small">BEAT CODEX</h1>
        <p className="ph-headline ph-headline--lose">GAME OVER</p>
        <p className="ph-sub ph-pulse">waiting for results...</p>
        <div className="ph-bottom">
          <p className="ph-sub ph-pulse">Waiting for host...</p>
        </div>
      </div>
    )
  }

  const mine = ranking.find((r) => r.playerId === playerId) ?? null
  const win = result === 'VICTORY'
  const deaths = mine?.deaths ?? 0

  return (
    <div className="ph ph--center" onContextMenu={prevent}>
      <Dot status={status} label />
      <h1 className="ph-title ph-title--small">BEAT CODEX</h1>
      <p className={`ph-headline ${win ? 'ph-headline--win' : 'ph-headline--lose'}`}>
        {win ? 'YOU BEAT CODEX! 🎉' : 'CODEX WINS'}
      </p>

      {mine ? (
        <>
          <p className="ph-rank">#{mine.rank}</p>
          {mine.rank <= 3 && (
            <p className="ph-finished">
              YOU FINISHED #{mine.rank} {MEDALS[mine.rank]}
            </p>
          )}
          <p className="ph-result-name" style={nameStyle(mine.color || color)}>
            {mine.name || name}
          </p>
          <p className="ph-stat">🔥 {Math.round(mine.damageDealt)} DAMAGE</p>
          <p className="ph-stat">
            💀 {deaths} {deaths === 1 ? 'DEATH' : 'DEATHS'}
          </p>
        </>
      ) : (
        <>
          <p className="ph-rank ph-rank--spectator">SPECTATOR</p>
          <p className="ph-result-name" style={nameStyle(color)}>
            {name}
          </p>
        </>
      )}

      <div className="ph-bottom">
        <p className="ph-sub ph-pulse">Waiting for host...</p>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------

export default function JoinPage() {
  const [search] = useSearchParams()
  const roomParam = (search.get('room') ?? '').trim().toUpperCase()
  const roomValid = isValidRoomId(roomParam)
  const roomId = roomValid ? roomParam : ''

  const [playerId] = useState(() => safePlayerId())
  const [name, setName] = useState<string | null>(null)

  const net = usePlayerChannel(roomId, playerId, roomValid ? name : null)

  if (!roomValid) return <MessageScreen>Invalid room. Scan the QR code again.</MessageScreen>
  if (!supabase) return <MessageScreen>Supabase is not configured</MessageScreen>

  if (!name) {
    return (
      <NameEntry
        roomId={roomId}
        onJoin={(n) => {
          try {
            storeName(n)
          } catch {
            /* storage blocked */
          }
          setName(n)
        }}
      />
    )
  }

  const phase = net.hostPhase
  if (phase === 'COUNTDOWN' || phase === 'PLAYING') {
    return (
      <Controller
        name={name}
        color={net.color}
        me={net.me}
        hostPhase={phase}
        status={net.status}
        sendInput={net.sendInput}
        inputIntervalMs={net.inputIntervalMs}
      />
    )
  }
  if (phase === 'VICTORY' || phase === 'DEFEAT' || phase === 'PODIUM' || phase === 'RESULTS') {
    return (
      <ResultScreen
        playerId={playerId}
        name={name}
        color={net.color}
        result={net.result}
        ranking={net.ranking}
        status={net.status}
      />
    )
  }
  return <WaitingScreen name={name} color={net.welcomed ? net.color : null} roomId={roomId} status={net.status} />
}
