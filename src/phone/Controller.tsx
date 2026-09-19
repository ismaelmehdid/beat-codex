/**
 * Gamepad screen: LEFT / RIGHT / FIRE. Pointer events only (never click), full-state INPUT sends
 * with coalescing + heartbeat, and aggressive "release everything" safety nets.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { PLAYER_HP } from '../game/constants'
import type { Phase } from '../game/types'
import { INPUT_HEARTBEAT_MS, INPUT_SEND_MIN_INTERVAL_MS } from '../lib/protocol'
import type { ChannelStatus, InputState, MeState } from '../net/usePlayerChannel'

type Control = 'l' | 'r' | 'f'

interface Held {
  l: boolean
  r: boolean
  f: boolean
}

const NONE_HELD: Held = { l: false, r: false, f: false }
const RELEASE_DUPLICATE_DELAY_MS = 150
const LOW_HP = 30

function clearTimer(ref: { current: number | null }, interval = false): void {
  if (ref.current !== null) {
    if (interval) window.clearInterval(ref.current)
    else window.clearTimeout(ref.current)
    ref.current = null
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
  } catch {
    /* unsupported / blocked */
  }
}

// ------------------------------------------------------------------------------------------------
// Input sender: {l, r, f, s} -> coalesced INPUT sends + heartbeat while held + release duplicate
// ------------------------------------------------------------------------------------------------

function useInputSender(sendInput: (s: InputState) => void) {
  const sendRef = useRef(sendInput)
  sendRef.current = sendInput

  const stateRef = useRef<InputState>({ l: 0, r: 0, f: 0, s: 0 })
  const lastSendAtRef = useRef(0)
  const trailingRef = useRef<number | null>(null)
  const heartbeatRef = useRef<number | null>(null)
  const dupRef = useRef<number | null>(null)
  const pointersRef = useRef<Map<number, Control>>(new Map())
  const [held, setHeld] = useState<Held>(NONE_HELD)

  const sendNow = useCallback(() => {
    lastSendAtRef.current = Date.now()
    sendRef.current({ ...stateRef.current })
  }, [])

  const scheduleSend = useCallback(() => {
    const elapsed = Date.now() - lastSendAtRef.current
    if (elapsed >= INPUT_SEND_MIN_INTERVAL_MS) {
      clearTimer(trailingRef)
      sendNow()
      return
    }
    if (trailingRef.current === null) {
      trailingRef.current = window.setTimeout(() => {
        trailingRef.current = null
        sendNow()
      }, INPUT_SEND_MIN_INTERVAL_MS - elapsed)
    }
  }, [sendNow])

  /** Recompute held flags from the active pointers and push a send if anything changed. */
  const recompute = useCallback(
    (bumpFireSeq: boolean) => {
      let l: 0 | 1 = 0
      let r: 0 | 1 = 0
      let f: 0 | 1 = 0
      for (const c of pointersRef.current.values()) {
        if (c === 'l') l = 1
        else if (c === 'r') r = 1
        else f = 1
      }
      const prev = stateRef.current
      const s = bumpFireSeq ? prev.s + 1 : prev.s
      if (prev.l === l && prev.r === r && prev.f === f && prev.s === s) return
      stateRef.current = { l, r, f, s }
      setHeld({ l: l === 1, r: r === 1, f: f === 1 })

      const anyHeld = l === 1 || r === 1 || f === 1
      if (anyHeld) {
        clearTimer(dupRef)
        scheduleSend()
        if (heartbeatRef.current === null) {
          heartbeatRef.current = window.setInterval(sendNow, INPUT_HEARTBEAT_MS)
        }
      } else {
        // Everything released: send immediately, once more shortly after, stop the heartbeat.
        clearTimer(trailingRef)
        clearTimer(heartbeatRef, true)
        sendNow()
        clearTimer(dupRef)
        dupRef.current = window.setTimeout(() => {
          dupRef.current = null
          sendNow()
        }, RELEASE_DUPLICATE_DELAY_MS)
      }
    },
    [scheduleSend, sendNow],
  )

  const press = useCallback(
    (control: Control, pointerId: number) => {
      pointersRef.current.set(pointerId, control)
      recompute(control === 'f')
    },
    [recompute],
  )

  const releasePointer = useCallback(
    (pointerId: number) => {
      if (!pointersRef.current.delete(pointerId)) return
      recompute(false)
    },
    [recompute],
  )

  const releaseAll = useCallback(() => {
    if (pointersRef.current.size === 0) return
    pointersRef.current.clear()
    recompute(false)
  }, [recompute])

  // Unmount: stop timers and make sure the host sees a release.
  useEffect(() => {
    return () => {
      clearTimer(trailingRef)
      clearTimer(heartbeatRef, true)
      clearTimer(dupRef)
      const st = stateRef.current
      if (st.l || st.r || st.f) {
        stateRef.current = { ...st, l: 0, r: 0, f: 0 }
        sendRef.current({ ...stateRef.current })
      }
      pointersRef.current.clear()
    }
  }, [])

  return { held, press, releasePointer, releaseAll }
}

// ------------------------------------------------------------------------------------------------
// Respawn countdown (ceil seconds, min 0)
// ------------------------------------------------------------------------------------------------

function secondsLeft(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
}

function useCountdownSeconds(deadline: number | null): number | null {
  const [secs, setSecs] = useState<number | null>(() => (deadline === null ? null : secondsLeft(deadline)))
  useEffect(() => {
    if (deadline === null) {
      setSecs(null)
      return
    }
    const tick = () => setSecs(secondsLeft(deadline))
    tick()
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [deadline])
  return secs
}

// ------------------------------------------------------------------------------------------------
// Component
// ------------------------------------------------------------------------------------------------

export interface ControllerProps {
  name: string
  color: string | null
  me: MeState
  hostPhase: Phase | null
  status: ChannelStatus
  sendInput: (s: InputState) => void
}

export default function Controller({ name, color, me, hostPhase, status, sendInput }: ControllerProps) {
  const { held, press, releasePointer, releaseAll } = useInputSender(sendInput)
  const alive = me.alive
  const respawnSecs = useCountdownSeconds(alive ? null : me.respawnAt)

  // Safety nets: anything that could swallow a pointerup releases every control.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') releaseAll()
    }
    const onGlobalPointer = (e: PointerEvent) => releasePointer(e.pointerId)
    window.addEventListener('blur', releaseAll)
    window.addEventListener('pagehide', releaseAll)
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pointerup', onGlobalPointer)
    window.addEventListener('pointercancel', onGlobalPointer)
    return () => {
      window.removeEventListener('blur', releaseAll)
      window.removeEventListener('pagehide', releaseAll)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pointerup', onGlobalPointer)
      window.removeEventListener('pointercancel', onGlobalPointer)
    }
  }, [releaseAll, releasePointer])

  // Death / damage haptics + release controls on death.
  const prevRef = useRef<{ hp: number; alive: boolean }>({ hp: me.hp, alive: me.alive })
  useEffect(() => {
    const prev = prevRef.current
    if (prev.alive && !me.alive) {
      releaseAll()
      vibrate([60, 40, 120])
    } else if (me.alive && me.hp < prev.hp) {
      vibrate(30)
    }
    prevRef.current = { hp: me.hp, alive: me.alive }
  }, [me.hp, me.alive, releaseAll])

  const handlersFor = (control: Control) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!alive) return
      e.preventDefault()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      press(control, e.pointerId)
      vibrate(8)
    },
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => releasePointer(e.pointerId),
    onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => releasePointer(e.pointerId),
    onPointerLeave: (e: ReactPointerEvent<HTMLButtonElement>) => releasePointer(e.pointerId),
    onLostPointerCapture: (e: ReactPointerEvent<HTMLButtonElement>) => releasePointer(e.pointerId),
  })

  const hp = Math.max(0, Math.min(PLAYER_HP, Math.round(me.hp)))
  const hpPct = (hp / PLAYER_HP) * 100
  const nameStyle = { ['--name-color' as string]: color ?? '#ffffff' } as CSSProperties

  return (
    <div className="ph ph--ctl" onContextMenu={(e) => e.preventDefault()}>
      <header className="ctl-top">
        <div className="ctl-row">
          <span className="ctl-name" style={nameStyle}>
            {name}
          </span>
          <span className="ctl-hp">❤️ {hp}</span>
          <span className={`ph-dot ph-dot--${status}`} title={status} />
        </div>
        <div className="ctl-bar">
          <div className={`ctl-bar-fill${hp <= LOW_HP ? ' is-low' : ''}`} style={{ width: `${hpPct}%` }} />
        </div>
      </header>

      <div className="ctl-pad" data-disabled={!alive}>
        <button type="button" className="ctl-btn ctl-btn--move" data-on={held.l} disabled={!alive} {...handlersFor('l')}>
          <span className="ctl-arrow">←</span>
          <span className="ctl-label">LEFT</span>
        </button>
        <button type="button" className="ctl-btn ctl-btn--move" data-on={held.r} disabled={!alive} {...handlersFor('r')}>
          <span className="ctl-arrow">→</span>
          <span className="ctl-label">RIGHT</span>
        </button>
      </div>

      <div className="ctl-fire-area" data-disabled={!alive}>
        <button type="button" className="ctl-btn ctl-btn--fire" data-on={held.f} disabled={!alive} {...handlersFor('f')}>
          <span className="ctl-fire-emoji">🔥</span>
          <span className="ctl-fire-label">FIRE</span>
        </button>
      </div>

      {hostPhase === 'COUNTDOWN' && alive && (
        <div className="ph-overlay ph-overlay--ready">
          <div className="ph-ready">GET READY</div>
        </div>
      )}

      {!alive && (
        <div className="ph-overlay ph-overlay--dead" onContextMenu={(e) => e.preventDefault()}>
          <p className="ph-dead-title">YOU DIED</p>
          <p className="ph-dead-sub">Respawning in</p>
          <p className="ph-dead-num">{respawnSecs === null ? '…' : respawnSecs}</p>
        </div>
      )}
    </div>
  )
}
