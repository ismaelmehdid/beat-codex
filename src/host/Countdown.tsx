import { COUNTDOWN_MS } from '../game/constants'
import { useWorld } from '../game/store'
import './host.css'

const LABELS = ['3', '2', '1', 'BEAT CODEX!'] as const
const STEP_MS = COUNTDOWN_MS / LABELS.length

/** 3, 2, 1, BEAT CODEX! over the 3D scene. Keyed by label so the pop animation replays. */
export default function Countdown() {
  const label = useWorld((w) => {
    const elapsed = Math.max(0, w.now - w.phaseStartedAt)
    const idx = Math.min(LABELS.length - 1, Math.floor(elapsed / STEP_MS))
    return LABELS[idx]
  })
  const isGo = label === 'BEAT CODEX!'
  return (
    <div className="overlay overlay-center">
      <div key={label} className={`countdown-label${isGo ? ' go' : ''}`}>
        {label}
      </div>
    </div>
  )
}
