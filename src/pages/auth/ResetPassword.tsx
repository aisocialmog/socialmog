// Used by both the "forgot password" email and the invite email: the link
// signs the person in, then they choose a password here.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { authMessage } from '../../lib/auth'
import { passwordProblems } from '../../lib/password'
import { AuthLayout, FormError } from './AuthLayout'
import { EnsoSpinner } from '../../components/art/Ink'

export function ResetPassword() {
  const nav = useNavigate()
  const invite = new URLSearchParams(window.location.search).has('invite')
  const [ready, setReady] = useState<'checking' | 'ok' | 'expired'>('checking')
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) { setReady('expired'); return }
    const hashError = new URLSearchParams(window.location.hash.slice(1)).get('error_description')
    if (hashError) { setError(authMessage(hashError)); setReady('expired'); return }
    let done = false
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && ['PASSWORD_RECOVERY', 'SIGNED_IN', 'INITIAL_SESSION'].includes(event)) { done = true; setReady('ok') }
    })
    supabase.auth.getSession().then(({ data }) => { if (data.session) { done = true; setReady('ok') } })
    const t = setTimeout(() => { if (!done) setReady('expired') }, 4000)
    return () => { clearTimeout(t); sub.subscription.unsubscribe() }
  }, [])

  const problems = passwordProblems(pw)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (problems.length) { setError(`Use ${problems.join(' and ')}.`); return }
    if (pw !== pw2) { setError('The two passwords don’t match.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setError(authMessage(error.message))
    else nav('/', { replace: true })
  }

  return (
    <AuthLayout title={invite ? 'Welcome to Social Mog OS' : 'Choose a new password'}
      subtitle={invite ? 'Set a password for your account. You can also use Google with this email.' : undefined}
      footer={<Link to="/login" className="underline underline-offset-4 hover:text-ink">Back to sign in</Link>}>
      {ready === 'checking' && <div className="py-6 grid place-items-center"><EnsoSpinner label="Checking your link" /></div>}
      {ready === 'expired' && (
        <div className="space-y-4">
          <FormError>{error ?? 'This link has expired or was already used.'}</FormError>
          <Link to="/forgot-password" className="btn-primary w-full justify-center">Send a new link</Link>
        </div>
      )}
      {ready === 'ok' && (
        <form className="space-y-4" onSubmit={submit}>
          {error && <FormError>{error}</FormError>}
          <label className="block text-sm text-muted">New password
            <input type="password" autoComplete="new-password" required className="field mt-1.5" value={pw} onChange={e => setPw(e.target.value)} aria-describedby="pw-rules" />
          </label>
          <p id="pw-rules" className="text-xs text-muted">At least 8 characters, with letters and numbers.</p>
          <label className="block text-sm text-muted">Type it again
            <input type="password" autoComplete="new-password" required className="field mt-1.5" value={pw2} onChange={e => setPw2(e.target.value)} />
          </label>
          <button className="btn-primary w-full justify-center disabled:opacity-60" disabled={busy || !pw || !pw2}>
            {busy ? 'Saving…' : invite ? 'Set password & enter' : 'Save new password'}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
