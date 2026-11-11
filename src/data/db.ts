// One thin door to the database for features 8–12: Supabase when configured,
// otherwise the in-memory preview (src/data/preview.ts).
import { supabase } from '../lib/supabase'
import { pv } from './preview'

export type Match = Record<string, string | number | boolean | null>
const check = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

export const db = {
  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!supabase) return pv.rpc(fn, args) as T
    const { data, error } = await supabase.rpc(fn, args); check(error)
    return data as T
  },
  async rows<T>(table: string, match: Match = {}, order?: string, asc = true): Promise<T[]> {
    if (!supabase) return pv.rows(table, match, order, asc) as T[]
    let q = supabase.from(table).select('*')
    for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v)
    if (order) q = q.order(order, { ascending: asc })
    const { data, error } = await q; check(error)
    return (data ?? []) as T[]
  },
  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    if (!supabase) return pv.insert(table, row) as T
    const { data, error } = await supabase.from(table).insert(row).select().single(); check(error)
    return data as T
  },
  async update(table: string, id: string, patch: Record<string, unknown>) {
    if (!supabase) return pv.update(table, id, patch)
    const { error } = await supabase.from(table).update(patch).eq('id', id); check(error)
  },
  async del(table: string, match: Match) {
    if (!supabase) return pv.del(table, match)
    const { error } = await supabase.from(table).delete().match(match); check(error)
  },
  /** Call an Edge Function as the signed-in user. */
  async invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    if (!supabase) return pv.invoke(fn, body) as T
    const { data, error } = await supabase.functions.invoke(fn, { body })
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null)
      throw new Error(detail?.error ?? error.message)
    }
    return data as T
  },
}
