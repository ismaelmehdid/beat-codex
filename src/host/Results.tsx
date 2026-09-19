import { resetToLobby } from '../game/engine'
import { bumpWorld, getWorld, useWorld } from '../game/store'
import type { RankedPlayer } from '../lib/protocol'
import './host.css'

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}']
const TWO_COLUMN_THRESHOLD = 10

function RankRow({ r }: { r: RankedPlayer }) {
  const medal = r.rank <= 3 ? MEDALS[r.rank - 1] : null
  return (
    <li className="rank-row" style={{ ['--c' as string]: r.color, animationDelay: `${Math.min(r.rank, 20) * 40}ms` }}>
      <span className={`r${medal ? ' medal' : ''}`}>{medal ?? r.rank}</span>
      <span className="name">{r.name}</span>
      <span className="stat">
        {r.damageDealt}
        <small>dmg</small>
      </span>
      <span className="stat">
        {r.deaths}
        <small>{r.deaths === 1 ? 'death' : 'deaths'}</small>
      </span>
    </li>
  )
}

export default function Results() {
  // world.ranking is replaced (new array) only when a game finishes / resets, so the reference is a fine selector.
  const ranking = useWorld((w) => w.ranking)
  const result = useWorld((w) => w.result)
  const mvp = ranking[0]

  const onPlayAgain = () => {
    resetToLobby(getWorld(), performance.now())
    bumpWorld()
  }

  const twoCols = ranking.length > TWO_COLUMN_THRESHOLD
  const half = Math.ceil(ranking.length / 2)
  const columns = twoCols ? [ranking.slice(0, half), ranking.slice(half)] : [ranking]

  return (
    <div className="results">
      <div className="results-panel">
        <div className={`results-title ${result === 'VICTORY' ? 'victory' : 'defeat'}`}>
          {result === 'VICTORY' ? 'CODEX DEFEATED' : result === 'DEFEAT' ? 'CODEX WINS' : 'RESULTS'}
        </div>

        {mvp ? (
          <div className="mvp" style={{ ['--c' as string]: mvp.color }}>
            <div className="mvp-label">MVP</div>
            <div className="mvp-name">{mvp.name}</div>
            <div className="mvp-stats">
              <span>{mvp.damageDealt} damage</span>
              <span className="muted">
                {mvp.deaths} {mvp.deaths === 1 ? 'death' : 'deaths'}
              </span>
            </div>
          </div>
        ) : (
          <div className="results-empty">No fighters this round</div>
        )}

        <div className={`rank-columns${twoCols ? ' two' : ''}`}>
          {ranking.length > 0 &&
            columns.map((col, i) => (
              <ol key={i} className="rank-table">
                {col.map((r) => (
                  <RankRow key={r.playerId} r={r} />
                ))}
              </ol>
            ))}
        </div>

        <div className="results-footer">
          <button className="btn btn-magenta" onClick={onPlayAgain}>
            Play again
          </button>
        </div>
      </div>
    </div>
  )
}
