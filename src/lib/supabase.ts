import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Only the PUBLIC anon key belongs here. Row Level Security protects the data.
// Service-role and AI keys live in Supabase Edge Function secrets, never in this app.
// The live site falls back to this project's public address and anon key when the host's
// environment variables are missing. Both are public by design (every visitor's browser gets them);
// the database rules (RLS) protect the data. Local development still needs .env.local.
const FALLBACK = import.meta.env.PROD
  ? { url: 'https://nesuixeknndrcaozqdpe.supabase.co', key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lc3VpeGVrbm5kcmNhb3pxZHBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3NjcwNDQsImV4cCI6MjExMDM0MzA0NH0.vX32vQ_rlRLHN9TDXqO3QwgeDmcqMxwBYnIXvD_NDss' }
  : { url: undefined, key: undefined }
const url = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || FALLBACK.url)?.trim()
const anonKey = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || FALLBACK.key)?.trim()

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
