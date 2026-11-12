import { useState, type FormEvent } from 'react'
import { clearFailures, lockedFor, lockMessage, registerFailure } from '../../lib/attempts'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { authMessage, PREVIEW_ALLOWED, useAuth } from '../../lib/auth'
import { ROLE_LABEL, type Role } from '../../lib/access'
import { AuthLayout, FormError, GoogleMark } from './AuthLayout'
import { EnsoSpinner } from '../../components/art/Ink'

export function Login() {
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string; error?: string } }
  const { startPreview } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'password' | 'google' | null>(null)
  const [error, setError] = useState<string | null>(loc.state?.error ?? null)
  const after = loc.state?.from && loc.state.from !== '/login' ? loc.state.from : '/'

  async function signIn(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const key = 'login:' + email.trim().toLowerCase(), wait = lockedFor(key)
    if (wait) { setError(lockMessage(wait)); return }
    setBusy('password'); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(null)
    if (error) { registerFailure(key); const w = lockedFor(key); setError(w ? lockMessage(w) : authMessage(error.message)) }
    else { clearFailures(key); nav(after, { replace: true }) }
  }

  async function google() {
    if (!supabase) return
    setBusy('google'); setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: 'select_account' } },
    })
    if (error) { setBusy(null); setError(authMessage(error.message)) }
  }

  return (
    <AuthLayout title="Social Mog OS" subtitle="Sign in to continue."
      footer={<>Team members only. No account? Ask a founder to invite you.</>}>
      {!isSupabaseConfigured && (
        <div className="mb-5 rounded-shoji border border-dashed border-line/60 p-3 text-sm text-muted">
          <p className="text-ink">The database isn’t connected yet.</p>
          <p className="mt-1">Add <code className="text-ink">VITE_SUPABASE_URL</code> and <code className="text-ink">VITE_SUPABASE_ANON_KEY</code> to <code className="text-ink">.env.local</code>.</p>
          {PREVIEW_ALLOWED && <>
            <p className="mt-3 text-ink">Design preview (local only) — look around as:</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['founder', 'manager', 'team_member', 'freelancer'] as Role[]).map(r => (
                <button key={r} className="btn-ghost h-9 justify-center text-xs" onClick={() => { startPreview(r); nav('/') }}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
          </>}
        </div>
      )}

      <button type="button" onClick={google} disabled={!supabase || busy !== null}
        className="btn-ghost w-full justify-center gap-3 disabled:opacity-50">
        {busy === 'google' ? <EnsoSpinner size={18} label="Opening Google" /> : <GoogleMark />} Continue with Google
      </button>

      <div className="flex items-center gap-3 my-5 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line/30" />or<span className="h-px flex-1 bg-line/30" />
      </div>

      <form className="space-y-4" onSubmit={signIn} noValidate>
        {error && <FormError>{error}</FormError>}
        <label className="block text-sm text-muted">Email
          <input type="email" autoComplete="email" inputMode="email" required className="field mt-1.5"
                 value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <div>
          <div className="flex justify-between text-sm">
            <label htmlFor="pw" className="text-muted">Password</label>
            <Link to="/forgot-password" state={{ email }} className="text-muted hover:text-ink underline underline-offset-4">Forgot password?</Link>
          </div>
          <input id="pw" type="password" autoComplete="current-password" required className="field mt-1.5"
                 value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <button className="btn-primary w-full justify-center disabled:opacity-60" disabled={!supabase || busy !== null || !email || !password}>
          {busy === 'password' ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  )
}
