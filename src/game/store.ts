import { create } from 'zustand'
import { createInitialState, damageBoss, forceDefeat, forceVictory, killPlayer } from './engine'
import type { GameState } from './types'

/**
 * The world is ONE mutable object owned by the host loop. React UI subscribes to `version`
 * (bumped ~15Hz by the loop) and reads through `world`. 3D components read `world` directly
 * inside useFrame for per-frame values, and use the store only to reconcile entity lists.
 *
 * Selectors must return primitives or use `useShallow` (zustand/react/shallow) for arrays/objects.
 */
interface HostStore {
  world: GameState
  version: number
  debug: boolean
  bump: () => void
  setDebug: (debug: boolean) => void
}

export const useHostStore = create<HostStore>((set) => ({
  world: createInitialState(''),
  version: 0,
  debug: false,
  bump: () => set((s) => ({ version: s.version + 1 })),
  setDebug: (debug) => set({ debug }),
}))

export const getWorld = (): GameState => useHostStore.getState().world

// Test/debug introspection hook (read-only usage intended): window.__beatcodex.world()
if (typeof window !== 'undefined') {
  ;(window as unknown as { __beatcodex?: unknown }).__beatcodex = {
    world: getWorld,
    kill: (id: string) => killPlayer(getWorld(), id),
    damageBoss: (n: number) => damageBoss(getWorld(), n, null),
    forceVictory: () => forceVictory(getWorld(), performance.now()),
    forceDefeat: () => forceDefeat(getWorld(), performance.now()),
    setBossPaused: (on: boolean) => {
      getWorld().bossPaused = on
    },
  }
}
export const bumpWorld = (): void => useHostStore.getState().bump()

/** Subscribe to a derived primitive from the world (re-evaluated on every bump). */
export function useWorld<T>(selector: (w: GameState) => T): T {
  return useHostStore((s) => selector(s.world))
}
