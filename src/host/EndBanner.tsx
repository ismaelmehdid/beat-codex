import { useEffect, useState } from 'react'
import { useWorld } from '../game/store'
import './host.css'

const SECOND_LINE_DELAY_MS = 1500

/** VICTORY: 'CODEX DEFEATED' -> 'YOU BEAT CODEX!'. DEFEAT: 'CODEX WINS' -> 'TRY AGAIN'. */
export default function EndBanner() {
  const phase = useWorld((w) => w.phase)
  const victory = phase === 'VICTORY'
  const [showSecond, setShowSecond] = useState(false)

  useEffect(() => {
    setShowSecond(false)
    const t = setTimeout(() => setShowSecond(true), SECOND_LINE_DELAY_MS)
    return () => clearTimeout(t)
  }, [phase])

  return (
    <div className={`end-banner ${victory ? 'victory' : 'defeat'}`}>
      <div className="end-line1">{victory ? 'CODEX DEFEATED' : 'CODEX WINS'}</div>
      {showSecond && <div className="end-line2">{victory ? 'YOU BEAT CODEX!' : 'TRY AGAIN'}</div>}
    </div>
  )
}
