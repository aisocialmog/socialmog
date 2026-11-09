import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Only the PUBLIC anon key belongs here. Row Level Security protects the data.
// Service-role and AI keys live in Supabase Edge Function secrets, never in this app.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
