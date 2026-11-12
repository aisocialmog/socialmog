// Founders sign in with an authenticator app as well as their password.
// Set it up once (scan, enter the code); after that, every login asks for the 6-digit code.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AuthLayout, FormError } from './AuthLayout'
import { EnsoSpinner } from '../../components/art/Ink'
import { supabase } from '../../lib/supabase'
import { clearFailures, lockedFor, lockMessage, registerFailure } from '../../lib/attempts'

export type MfaStatus = 'loading' | 'ok' | 'enroll' | 'challenge'

/** Does this person still need to pass the authenticator check? Only founders do. */
export function useMfa(role: string | null | undefined, enabled: boolean) {
  const [status, setStatus] = useState<MfaStatus>('loading')
  const check = useCallback(async () => {
    if (!enabled || !supabase || role !== 'founder') { setStatus('ok'); return }
    const { data: org } = await supabase.from('org_settings').select('require_founder_mfa').maybeSingle()
    if (org && org.require_founder_mfa === false) { setStatus('ok'); return }
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    setStatus(data?.currentLevel === 'aal2' ? 'ok' : data?.nextLevel === 'aal2' ? 'challenge' : 'enroll')
  }, [role, enabled])
  useEffect(() => { check() }, [check])
  return { status, recheck: check }
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6)

export function MfaGate({ status, email, onDone, onSignOut }: { status: 'enroll' | 'challenge'; email: string; onDone: () => void; onSignOut: () => void }) {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [factor, setFactor] = useState<{ id: string; qr?: string; secret?: string } | null>(null)
  const key = 'mfa:' + email.toLowerCase()

  useEffect(() => {
    if (!supabase) return
    let live = true
    ;(async () => {
      const { data: list } = await supabase!.auth.mfa.listFactors()
      const verified = list?.totp?.find(f => f.status === 'verified')
      if (status === 'challenge' && verified) { if (live) setFactor({ id: verified.id }); return }
      for (const f of list?.all ?? []) if (f.status === 'unverified') await supabase!.auth.mfa.unenroll({ factorId: f.id })   // an abandoned set-up
      const { data, error: e } = await supabase!.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' })
      if (!live) return
      if (e || !data) setError(e?.message ?? 'Could not start the set-up. Is TOTP enabled in Supabase → Authentication → MFA?')
      else setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    })()
    return () => { live = false }
  }, [status])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !factor) return
    const wait = lockedFor(key); if (wait) { setError(lockMessage(wait)); return }
    setBusy(true); setError(null)
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
    setBusy(false)
    if (err) { registerFailure(key); const w = lockedFor(key); setError(w ? lockMessage(w) : 'That code isn’t right. Codes change every 30 seconds — try the next one.'); setCode(''); return }
    clearFailures(key); onDone()
  }

  return (
    <AuthLayout title={status === 'enroll' ? 'Set up two-factor' : 'Enter your code'}
      subtitle={status === 'enroll' ? 'Founders sign in with an authenticator app as well as a password.' : 'Open your authenticator app and enter the 6-digit code for Social Mog OS.'}>
      {!factor && !error ? <div className="py-6 grid place-items-center"><EnsoSpinner size={32} label="Preparing" /></div> : (
        <form className="space-y-5" onSubmit={submit}>
          {status === 'enroll' && factor?.qr && <>
            <ol className="text-sm text-muted list-decimal pl-5 space-y-1"><li>Install an authenticator app (Google Authenticator, Authy, 1Password…).</li><li>Scan this code, or type the key below.</li><li>Enter the 6-digit code it shows.</li></ol>
            <div className="flex justify-center"><img src={factor.qr} alt="QR code for your authenticator app" className="w-44 h-44 bg-white p-2 rounded" /></div>
            <p className="text-center text-xs text-muted break-all">Key: <code className="num text-ink">{factor.secret}</code></p></>}
          <label className="block text-sm text-ink">6-digit code
            <input className="field mt-1.5 text-center text-xl tracking-[0.4em] num" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={e => setCode(digits(e.target.value))} aria-describedby={error ? 'mfa-err' : undefined} /></label>
          {error && <div id="mfa-err"><FormError>{error}</FormError></div>}
          <button className="btn-primary w-full justify-center" disabled={busy || code.length !== 6 || !factor}>{busy ? 'Checking…' : status === 'enroll' ? 'Turn on two-factor' : 'Continue'}</button>
          <button type="button" className="w-full text-sm text-muted hover:text-ink underline underline-offset-4" onClick={onSignOut}>Sign out</button>
        </form>
      )}
    </AuthLayout>
  )
}
