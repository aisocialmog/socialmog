// Session + the signed-in team member. RLS lets everyone read their own
// team_members row, so this works for every role.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './supabase'
import type { Role } from './access'

export interface Member {
  id: string; name: string; email: string; phone: string | null; title: string | null
  photo_path: string | null; role: Role; status: 'active' | 'inactive'; joined_date: string
}

type State =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'no_access'; email: string; reason: 'not_invited' | 'inactive' }
  | { kind: 'ready'; session: Session | null; member: Member; preview: boolean }

interface Auth {
  state: State
  member: Member | null
  role: Role | null
  isPreview: boolean
  refreshMember: () => Promise<void>
  signOut: () => Promise<void>
  startPreview: (role: Role) => void
}
const Ctx = createContext<Auth | null>(null)

// ── Design preview (local development without Supabase only) ──
export const PREVIEW_ALLOWED = import.meta.env.DEV && !isSupabaseConfigured
const PREVIEW_KEY = 'smog.preview-role'
const previewMember = (role: Role): Member => ({
  id: '00000000-0000-0000-0000-000000000000', name: '[Founder 1 name]', email: 'preview@example.com',
  phone: null, title: null, photo_path: null, role, status: 'active', joined_date: '2025-04-01',
  ...(role === 'manager' ? { name: 'Preview Manager' } : role === 'team_member' ? { name: 'Preview Team Member' }
    : role === 'freelancer' ? { name: 'Preview Freelancer' } : {}),
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(async (session: Session | null) => {
    if (!session || !supabase) { setState({ kind: 'signed_out' }); return }
    const { data } = await supabase.from('team_members')
      .select('id, name, email, phone, title, photo_path, role, status, joined_date')
      .eq('user_id', session.user.id).maybeSingle()
    if (!data) setState({ kind: 'no_access', email: session.user.email ?? '', reason: 'not_invited' })
    else if (data.status !== 'active') setState({ kind: 'no_access', email: data.email, reason: 'inactive' })
    else setState({ kind: 'ready', session, member: data as Member, preview: false })
  }, [])

  useEffect(() => {
    if (!supabase) {
      let r: string | null = null
      try { r = PREVIEW_ALLOWED ? sessionStorage.getItem(PREVIEW_KEY) : null } catch { /* storage blocked */ }
      setState(r ? { kind: 'ready', session: null, member: previewMember(r as Role), preview: true } : { kind: 'signed_out' })
      return
    }
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // defer: never await Supabase calls inside this callback
        setTimeout(() => load(session), 0)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const value: Auth = {
    state,
    member: state.kind === 'ready' ? state.member : null,
    role: state.kind === 'ready' ? state.member.role : null,
    isPreview: state.kind === 'ready' && state.preview,
    refreshMember: async () => {
      if (supabase) { const { data } = await supabase.auth.getSession(); await load(data.session) }
    },
    signOut: async () => {
      try { sessionStorage.removeItem(PREVIEW_KEY) } catch { /* ignore */ }
      if (supabase) await supabase.auth.signOut()
      setState({ kind: 'signed_out' })
    },
    startPreview: role => {
      if (!PREVIEW_ALLOWED) return
      try { sessionStorage.setItem(PREVIEW_KEY, role) } catch { /* ignore */ }
      setState({ kind: 'ready', session: null, member: previewMember(role), preview: true })
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}

/** Friendlier wording for Supabase auth errors. */
export function authMessage(raw: string | null | undefined): string {
  const m = (raw ?? '').toLowerCase()
  if (!m) return 'Something went wrong. Please try again.'
  if (m.includes('invalid login credentials')) return 'That email and password don’t match.'
  if (m.includes('email not confirmed')) return 'Open the invite email first to activate your login.'
  if (m.includes('signups not allowed') || m.includes('signup is disabled') || m.includes('user not found'))
    return 'This account hasn’t been invited to Social Mog OS. Ask a founder to invite your email.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.'
  if (m.includes('password should be') || m.includes('weak')) return 'Choose a stronger password: at least 8 characters, mixing letters and numbers.'
  if (m.includes('same password') || m.includes('should be different')) return 'Use a password different from your old one.'
  if (m.includes('expired') || m.includes('invalid') && m.includes('link')) return 'This link has expired. Ask for a new one.'
  return raw!
}
