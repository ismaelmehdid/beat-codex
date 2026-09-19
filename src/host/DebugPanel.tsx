import { useEffect, useRef, useState } from 'react'
import {
  addPlayer,
  applyInput,
  damageBoss,
  forceDefeat,
  forceVictory,
  killPlayer,
  resetToLobby,
  skipToResults,
  startCountdown,
} from '../game/engine'
import { bumpWorld, getWorld, useWorld } from '../game/store'
import './host.css'

export const DEBUG_LOCAL_ID = 'debug-local'
const KEY_REAPPLY_MS = 100
const BOT_NAMES = ['NEO', 'TRINITY', 'ADA', 'TURING', 'HOPPER', 'LOVELACE', 'DIJKSTRA', 'KNUTH', 'RITCHIE', 'LAMPORT', 'HAMILTON', 'BERNERS']

interface Keys {
  left: boolean
  right: boolean
  fire: boolean
  fireSeq: number
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

function addFake(n = 1) {
  const world = getWorld()
  for (let i = 0; i < n; i++) {
    const count = world.playerOrder.filter((id) => id.startsWith('fake-')).length
    let k = count
    while (world.players[`fake-${k}`]) k++
    addPlayer(world, `fake-${k}`, `BOT_${BOT_NAMES[k % BOT_NAMES.length]}`, { isFake: true })
  }
  bumpWorld()
}

export default function DebugPanel() {
  const phase = useWorld((w) => w.phase)
  const [open, setOpen] = useState(true)
  const [held, setHeld] = useState({ left: false, right: false, fire: false })
  const keys = useRef<Keys>({ left: false, right: false, fire: false, fireSeq: 0 })

  // Local keyboard-controlled fighter.
  useEffect(() => {
    addPlayer(getWorld(), DEBUG_LOCAL_ID, 'YOU (DEBUG)')
    bumpWorld()
  }, [])

  useEffect(() => {
    const apply = () => {
      const k = keys.current
      applyInput(getWorld(), DEBUG_LOCAL_ID, { left: k.left, right: k.right, fire: k.fire, fireSeq: k.fireSeq })
    }
    const syncHeld = () => {
      const k = keys.current
      setHeld((h) => (h.left === k.left && h.right === k.right && h.fire === k.fire ? h : { left: k.left, right: k.right, fire: k.fire }))
    }
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (isTypingTarget(e)) return
      const k = keys.current
      let handled = true
      switch (e.code) {
        case 'KeyA':
        case 'ArrowLeft':
          k.left = down
          break
        case 'KeyD':
        case 'ArrowRight':
          k.right = down
          break
        case 'Space':
          if (down && !e.repeat) k.fireSeq += 1
          k.fire = down
          break
        default:
          handled = false
      }
      if (!handled) return
      e.preventDefault()
      apply()
      syncHeld()
    }
    const onDown = (e: KeyboardEvent) => onKey(e, true)
    const onUp = (e: KeyboardEvent) => onKey(e, false)
    const onBlur = () => {
      const k = keys.current
      k.left = k.right = k.fire = false
      apply()
      syncHeld()
    }
    // Re-apply while anything is held so the engine's stuck-input timeout never releases the key.
    const interval = setInterval(() => {
      const k = keys.current
      if (k.left || k.right || k.fire) apply()
    }, KEY_REAPPLY_MS)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      clearInterval(interval)
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const act = (fn: (now: number) => void) => () => {
    fn(performance.now())
    bumpWorld()
  }
  const world = getWorld

  const canStart = phase === 'LOBBY' || phase === 'RESULTS'
  const playing = phase === 'PLAYING'
  const canSkip = phase === 'VICTORY' || phase === 'DEFEAT' || phase === 'PODIUM'

  return (
    <div className="debug-panel">
      <button className="debug-head" onClick={() => setOpen((o) => !o)}>
        <span>Debug {'·'} {phase}</span>
        <span>{open ? '▼' : '▲'}</span>
      </button>
      {open && (
        <div className="debug-body">
          <div className="debug-row">
            <button className="btn btn-tiny" onClick={() => addFake(1)}>
              Add fake player
            </button>
            <button className="btn btn-tiny" onClick={() => addFake(5)}>
              Add 5 fakes
            </button>
            <button className="btn btn-tiny good" disabled={!canStart} onClick={act((now) => startCountdown(world(), now))}>
              Start
            </button>
            <button className="btn btn-tiny" onClick={act((now) => resetToLobby(world(), now))}>
              Reset to lobby
            </button>
          </div>
          <div className="debug-row">
            <button className="btn btn-tiny" disabled={!playing} onClick={act(() => damageBoss(world(), 100, DEBUG_LOCAL_ID))}>
              Damage CODEX 100
            </button>
            <button className="btn btn-tiny danger" disabled={!playing} onClick={act(() => killPlayer(world(), DEBUG_LOCAL_ID))}>
              Kill me
            </button>
            <button className="btn btn-tiny good" disabled={!playing} onClick={act((now) => forceVictory(world(), now))}>
              Force victory
            </button>
            <button className="btn btn-tiny danger" disabled={!playing} onClick={act((now) => forceDefeat(world(), now))}>
              Force defeat
            </button>
            <button className="btn btn-tiny" disabled={!canSkip} onClick={act((now) => skipToResults(world(), now))}>
              Skip to results
            </button>
          </div>
          <div className="debug-info">
            Keys: <kbd className={held.left ? 'held' : ''}>A</kbd>/<kbd className={held.left ? 'held' : ''}>{'←'}</kbd> left{' '}
            <kbd className={held.right ? 'held' : ''}>D</kbd>/<kbd className={held.right ? 'held' : ''}>{'→'}</kbd> right{' '}
            <kbd className={held.fire ? 'held' : ''}>Space</kbd> fire
          </div>
        </div>
      )}
    </div>
  )
}
