// "Re-enter your password" before sensitive actions. The database enforces it
// too (creator bank details, locked months, API keys, export): this only asks
// nicely, and refreshes the login so the database sees the fresh password.
import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Modal } from '../components/ui/Modal'
import { FormError } from '../pages/auth/AuthLayout'
import { clearFailures, lockedFor, lockMessage, registerFailure } from './attempts'
import { useAuth } from './auth'
import { supabase } from './supabase'

const FRESH_MS = 9 * 60_000   // the database accepts 10 minutes; leave a margin
type Ensure = (why?: string) => Promise<boolean>
const Ctx = createContext<Ensure>(async () => true)
export const useReauth = () => useContext(Ctx)

/** When the access token says the password was last used, in ms since 1970 (0 = never). */
export function passwordAt(token: string | undefined): number {
  try {
    const claims = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    const times = (Array.isArray(claims.amr) ? claims.amr : []).filter((a: { method?: string }) => a.method === 'password').map((a: { timestamp?: number }) => Number(a.timestamp) * 1000)
    return times.length ? Math.max(...times) : 0
  } catch { return 0 }
}

export function ReauthProvider({ children }: { children: ReactNode }) {
  const { member, isPreview } = useAuth()
  const [ask, setAsk] = useState<{ why: string } | null>(null)
  const waiting = useRef<((ok: boolean) => void) | null>(null)
  const previewAt = useRef(0)

  const ensure = useCallback<Ensure>(async why => {
    if (isPreview || !supabase) { if (Date.now() - previewAt.current < FRESH_MS) return true }
    else {
      const { data } = await supabase.auth.getSession()
      if (Date.now() - passwordAt(data.session?.access_token) < FRESH_MS) return true
    }
    return new Promise<boolean>(resolve => { waiting.current = resolve; setAsk({ why: why ?? 'This is sensitive.' }) })
  }, [isPreview])

  const done = (ok: boolean) => { if (ok) previewAt.current = Date.now(); waiting.current?.(ok); waiting.current = null; setAsk(null) }
  return (
    <Ctx.Provider value={ensure}>
      {children}
      {ask && member && <PasswordPrompt why={ask.why} email={member.email} preview={isPreview || !supabase} onDone={done} />}
    </Ctx.Provider>
  )
}

function PasswordPrompt({ why, email, preview, onDone }: { why: string; email: string; preview: boolean; onDone: (ok: boolean) => void }) {
  const [pw, setPw] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const key = 'reauth:' + email.toLowerCase()
  async function submit(e: FormEvent) {
    e.preventDefault()
    const wait = lockedFor(key); if (wait) { setError(lockMessage(wait)); return }
    setBusy(true); setError(null)
    const bad = preview ? pw === 'wrong' : (await supabase!.auth.signInWithPassword({ email, password: pw })).error
    setBusy(false)
    if (!bad) { clearFailures(key); onDone(true); return }
    registerFailure(key); const w = lockedFor(key)
    setError(w ? lockMessage(w) : typeof bad === 'object' && !/invalid login/i.test(bad.message) ? bad.message : 'That password isn’t right. If you only sign in with Google, set a password first with “Forgot password”.')
  }
  return (
    <Modal title="Confirm it’s you" onClose={() => onDone(false)}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-muted">{why} Enter your password to continue.</p>
        <label className="block text-sm text-ink">Password<input type="password" autoComplete="current-password" required className="field mt-1.5" value={pw} onChange={e => setPw(e.target.value)} /></label>
        {error && <FormError>{error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => onDone(false)}>Cancel</button><button className="btn-primary" disabled={busy || !pw}>{busy ? 'Checking…' : 'Confirm'}</button></div>
      </form>
    </Modal>
  )
}
