import type { ReactElement } from 'react'
import { allPlayers } from '../game/engine'
import { getWorld, useHostStore, useWorld } from '../game/store'
import { LOGO_CODEX } from '../lib/colors'
import './host.css'

const HP_BLOCKS = 40
const LIVES_DANGER = 3
const TOP_DEALERS = 5

function BossBar() {
  const hp = useWorld((w) => w.boss.hp)
  const maxHp = useWorld((w) => w.boss.maxHp)
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0
  const filled = hp > 0 ? Math.max(1, Math.ceil(ratio * HP_BLOCKS)) : 0
  const low = ratio <= 0.15 && hp > 0
  const blocks: ReactElement[] = []
  for (let i = 0; i < HP_BLOCKS; i++) {
    blocks.push(<div key={i} className={`hud-hp-block${i < filled ? ' on' : ''}${i < filled && low ? ' low' : ''}`} />)
  }
  return (
    <div className="hud-boss">
      <div className="hud-boss-name">
        <img className="brand-mark" src={LOGO_CODEX} alt="" aria-hidden />
        CODEX
      </div>
      <div className="hud-hp">
        {/* slow "damage lag" ghost bar behind the instant segmented bar */}
        <div className="hud-hp-ghost" style={{ width: `${ratio * 100}%` }} />
        <div className="hud-hp-blocks">{blocks}</div>
      </div>
      <div className="hud-hp-num">
        <b>{Math.max(0, Math.round(hp))}</b> / {Math.round(maxHp)}
      </div>
    </div>
  )
}

function TeamLives() {
  const lives = useWorld((w) => w.teamLives)
  return (
    <div className={`hud-lives${lives <= LIVES_DANGER ? ' danger' : ''}`}>
      <span>Team lives</span>
      <span className="heart">{'❤️'}</span>
      <span className="n">{lives}</span>
    </div>
  )
}

/** Top damage dealers; re-renders on every store bump (~15Hz) which is fine for a 5-row list. */
function TopDealers() {
  useHostStore((s) => s.version)
  const debug = useHostStore((s) => s.debug)
  const top = allPlayers(getWorld())
    .filter((p) => p.damageDealt > 0)
    .sort((a, b) => b.damageDealt - a.damageDealt || a.index - b.index)
    .slice(0, TOP_DEALERS)
  if (top.length === 0) return null
  return (
    <div className={`hud-dealers${debug ? ' debug-offset' : ''}`}>
      <div className="hud-dealers-title">Top damage</div>
      {top.map((p, i) => (
        <div key={p.id} className="hud-dealer">
          <span className="rank">{i + 1}</span>
          <span className="name" style={{ ['--c' as string]: p.color }}>
            {p.name}
          </span>
          <span className="dmg">
            {Math.round(p.damageDealt)}
            <small>dmg</small>
          </span>
        </div>
      ))}
    </div>
  )
}

export default function HUD() {
  return (
    <div className="hud">
      <BossBar />
      <TeamLives />
      <TopDealers />
    </div>
  )
}
