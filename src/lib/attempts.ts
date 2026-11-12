// Slows down password guessing in the browser: five wrong tries lock that form
// for five minutes. (Supabase rate-limits sign-ins on the server too — see config.toml.)
export const MAX_TRIES = 5, LOCK_MS = 5 * 60_000
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const mem: Record<string, string> = {}
const fallback: Store = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v }, removeItem: k => { delete mem[k] } }
const store = (): Store => { try { return localStorage } catch { return fallback } }
const read = (key: string, s: Store): { n: number; until: number } => { try { return JSON.parse(s.getItem('smog.tries.' + key) ?? '') } catch { return { n: 0, until: 0 } } }

/** Seconds left on the lock for this key (0 = not locked). */
export function lockedFor(key: string, now = Date.now(), s: Store = store()): number {
  const r = read(key, s); return r.until > now ? Math.ceil((r.until - now) / 1000) : 0
}
export function registerFailure(key: string, now = Date.now(), s: Store = store()) {
  const r = read(key, s), n = (r.until && r.until <= now ? 0 : r.n) + 1
  s.setItem('smog.tries.' + key, JSON.stringify(n >= MAX_TRIES ? { n: 0, until: now + LOCK_MS } : { n, until: 0 }))
}
export const clearFailures = (key: string, s: Store = store()) => s.removeItem('smog.tries.' + key)
export const lockMessage = (secs: number) => `Too many wrong attempts. Try again in ${Math.ceil(secs / 60)} minute${secs > 60 ? 's' : ''}.`
