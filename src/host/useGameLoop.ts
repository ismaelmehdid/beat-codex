/**
 * The host's requestAnimationFrame loop: steps the authoritative world, drives fake players in
 * debug mode, drains network events, and bumps the store (~15Hz, or instantly on a phase change).
 */
import { useEffect, useRef } from 'react'
import { driveFakePlayers, step } from '../game/engine'
import { bumpWorld, getWorld, useHostStore } from '../game/store'

const MAX_DT_S = 0.05 // hidden tab / hiccup: never teleport
const UI_BUMP_INTERVAL_MS = 66

export function useGameLoop(drain: () => boolean): void {
  const drainRef = useRef(drain)
  drainRef.current = drain

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastBump = 0

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min(MAX_DT_S, Math.max(0, (now - last) / 1000))
      last = now

      const world = getWorld()
      try {
        step(world, now, dt)
        if (useHostStore.getState().debug) driveFakePlayers(world)
      } catch (err) {
        console.error('[loop] step failed', err)
      }

      let phaseChanged = false
      try {
        phaseChanged = drainRef.current()
      } catch (err) {
        console.error('[loop] drain failed', err)
        world.netEvents = []
      }

      if (phaseChanged || now - lastBump >= UI_BUMP_INTERVAL_MS) {
        lastBump = now
        bumpWorld()
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}
