import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** True when both env vars are present. When false, networking is disabled (debug mode still works). */
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, {
      realtime: { params: { eventsPerSecond: 40 } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null

export const channelNameFor = (roomId: string) => `raid:${roomId}`
