import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { authMessage } from '../../lib/auth'
import { AuthLayout, FormError, FormNote } from './AuthLayout'

export function ForgotPassword() {
  const loc = useLocation() as { state?: { email?: string } }
  const [email, setEmail] = useState(loc.state?.email ?? '')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true); setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    // Same message whether or not the email is on the team (don't reveal who is),
    // except rate limits, which the person needs to know about.
    if (error && /rate|too many/i.test(error.message)) setError(authMessage(error.message))
    else setSent(true)
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We’ll email you a link to choose a new one."
      footer={<Link to="/login" className="underline underline-offset-4 hover:text-ink">Back to sign in</Link>}>
      {sent ? (
        <FormNote>If <span className="font-medium">{email}</span> belongs to a team member, a reset link is on its way. It works once and expires in an hour.</FormNote>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          {error && <FormError>{error}</FormError>}
          <label className="block text-sm text-muted">Email
            <input type="email" autoComplete="email" required className="field mt-1.5" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <button className="btn-primary w-full justify-center disabled:opacity-60" disabled={!supabase || busy || !email}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
