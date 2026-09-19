import { QRCodeSVG } from 'qrcode.react'
import { connectedPlayerCount, connectedPlayers, startCountdown } from '../game/engine'
import { bumpWorld, getWorld, useHostStore, useWorld } from '../game/store'
import { LOGO_CLAUDE, LOGO_CODEX } from '../lib/colors'
import { joinUrlFor } from '../lib/roomId'
import type { NetStatus } from '../net/useHostChannel'
import './host.css'

interface LobbyProps {
  roomId: string
  netStatus: NetStatus
}

/** Re-renders on every store bump (~15Hz, idle in the lobby) and reads the live player list. */
function PlayerChips() {
  useHostStore((s) => s.version)
  const players = connectedPlayers(getWorld())
  return (
    <div className="chip-grid">
      {players.map((p) => (
        <div key={p.id} className={`chip${p.isFake ? ' fake' : ''}`} style={{ ['--c' as string]: p.color }} title={p.id}>
          {p.name}
        </div>
      ))}
    </div>
  )
}

export default function Lobby({ roomId, netStatus }: LobbyProps) {
  const count = useWorld(connectedPlayerCount)
  const debug = useHostStore((s) => s.debug)
  const joinUrl = joinUrlFor(roomId)
  const canStart = count > 0 || debug

  const onStart = () => {
    if (!canStart) return
    startCountdown(getWorld(), performance.now())
    bumpWorld()
  }

  let hint: { text: string; cls: string } | null = null
  if (netStatus === 'disabled') hint = { text: 'Supabase env missing: debug mode only', cls: 'warn' }
  else if (netStatus === 'error') hint = { text: 'Network error: reconnecting...', cls: 'error' }
  else if (netStatus === 'connecting') hint = { text: 'Connecting to room...', cls: '' }
  else if (count === 0) hint = { text: 'Waiting for hackers to scan the code', cls: '' }

  return (
    <div className="lobby">
      <div className="lobby-grid" />
      <div className="lobby-scanline" />

      <header className="lobby-header">
        <h1 className="lobby-title">
          <img className="brand-mark" src={LOGO_CLAUDE} alt="" aria-hidden />
          BEAT <span className="codex">CODEX</span>
          <img className="brand-mark brand-mark--codex" src={LOGO_CODEX} alt="" aria-hidden />
        </h1>
        <p className="lobby-subtitle">Anthropic hackers vs CODEX</p>
      </header>

      <main className="lobby-main">
        <section className="lobby-join">
          <div className="qr-card">
            <QRCodeSVG value={joinUrl} size={512} level="M" marginSize={2} bgColor="#ffffff" fgColor="#050510" />
          </div>
          <div className="lobby-scan">Scan to join</div>
          <div className="lobby-url">{joinUrl}</div>
          <div className="lobby-room">
            <small>Room</small>
            {roomId}
          </div>
        </section>

        <section className="lobby-players">
          <div className={`lobby-ready${count === 0 ? ' zero' : ''}`}>
            {count} {count === 1 ? 'player' : 'players'} ready
          </div>
          <PlayerChips />
        </section>
      </main>

      <footer className="lobby-footer">
        <button className="btn btn-start" disabled={!canStart} onClick={onStart}>
          Start
        </button>
        <div className={`lobby-hint ${hint?.cls ?? ''}`}>{hint?.text ?? ' '}</div>
      </footer>
    </div>
  )
}
