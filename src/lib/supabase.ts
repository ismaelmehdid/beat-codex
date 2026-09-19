import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** True when both env vars are present. When false, networking is disabled (debug mode still works). */
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, {
      realtime: {
        // NOTE: eventsPerSecond is a server-side hint; realtime-js does not throttle locally.
        params: { eventsPerSecond: 40 },
        // A venue Wi-Fi drop often leaves the socket OPEN with no close frame. The default 25s
        // heartbeat means up to ~50s of "connected" with dead controls; 5s bounds it to ~10s.
        heartbeatIntervalMs: 5000,
      },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null

export const channelNameFor = (roomId: string) => `raid:${roomId}`
