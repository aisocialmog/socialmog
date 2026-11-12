import { describe, expect, it } from 'vitest'
import { clearFailures, lockedFor, LOCK_MS, MAX_TRIES, registerFailure } from '../src/lib/attempts'

const mk = () => { const m: Record<string, string> = {}; return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v }, removeItem: (k: string) => { delete m[k] } } }
describe('login attempt limit', () => {
  it('locks after five wrong tries, then lets go', () => {
    const s = mk(), t = 1_000_000
    for (let i = 1; i < MAX_TRIES; i++) { registerFailure('a@b.c', t, s); expect(lockedFor('a@b.c', t, s)).toBe(0) }
    registerFailure('a@b.c', t, s)
    expect(lockedFor('a@b.c', t, s)).toBe(LOCK_MS / 1000)
    expect(lockedFor('a@b.c', t + LOCK_MS - 1000, s)).toBe(1)
    expect(lockedFor('a@b.c', t + LOCK_MS, s)).toBe(0)
    registerFailure('a@b.c', t + LOCK_MS + 1, s); expect(lockedFor('a@b.c', t + LOCK_MS + 1, s)).toBe(0)   // a fresh count
  })
  it('is per account and clears on success', () => {
    const s = mk()
    for (let i = 0; i < MAX_TRIES; i++) registerFailure('x', 0, s)
    expect(lockedFor('y', 0, s)).toBe(0); expect(lockedFor('x', 0, s)).toBeGreaterThan(0)
    clearFailures('x', s); expect(lockedFor('x', 0, s)).toBe(0)
  })
})
