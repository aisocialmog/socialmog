// Production & calendar data access (Supabase, or the local preview store).
import { supabase } from '../lib/supabase'
import type { ActivityEntry } from '../lib/activity'
import type { PersonRole, Stage } from '../lib/production'
import { productionPreview as pv } from './productionPreview'

export interface ProductionItem {
  id: string; created_at: string; updated_at: string; brand_id: string; campaign_id: string | null; creator_id: string | null; assignee_id: string | null
  title: string; format: string; platform: string | null; stage: Stage; stage_changed_at: string; approval_status: string; priority: string; brief: string | null
  target_date: string | null; due_date: string | null; sort_date: string | null; went_live_at: string | null
  draft_url: string | null; live_url: string | null; raw_footage_url: string | null; final_file_url: string | null; thumbnail_url: string | null
  revision_count: number; revision_limit: number | null; item_revision_limit: number | null; over_revision_limit: boolean
  brand_name: string; brand_logo_path: string | null; brand_color: number | null; campaign_name: string | null; creator_name: string | null; assignee_name: string | null
  days_in_stage: number; is_stuck: boolean; is_overdue: boolean; people: string[]; people_member_ids: string[]
  shoot_id: string | null; shoot_date: string | null; script_version: number | null; script_status: string | null; edit_versions: number
}
export type ItemPatch = Partial<Pick<ProductionItem, 'title' | 'format' | 'platform' | 'stage' | 'brief' | 'due_date' | 'assignee_id' |
  'raw_footage_url' | 'final_file_url' | 'thumbnail_url' | 'live_url'>> & { go_live_date?: string | null; revision_limit?: number | null; deliverable_type?: string }
export interface ItemInput { title: string; brand_id: string; campaign_id: string | null; deliverable_type: string; platform: string | null; go_live_date: string | null; due_date: string | null; assignee_id: string | null; brief: string | null; revision_limit: number | null }
export interface Person { id: string; role: PersonRole; name: string; kind: 'team' | 'vendor' | 'creator'; ref_id: string }
export interface PersonOption { kind: 'team' | 'vendor' | 'creator'; id: string; name: string; hint: string }
export interface ScriptVersion { id: string; version: number; body: string; status: 'draft' | 'in_review' | 'approved' | 'rejected'; created_at: string; created_by: string | null }
export interface ScriptComment { id: string; script_id: string; from_client: boolean; author_name: string | null; body: string; is_resolved: boolean; created_at: string }
export interface EditVersion { id: string; version: number; url: string; notes: string | null; created_at: string }
export interface Shoot { id: string; title: string; brand_id: string | null; brand_name: string | null; brand_color: number | null; shoot_date: string; call_time: string | null; wrap_time: string | null
  location: string | null; status: string; equipment: string[]; call_sheet_notes: string | null; items: string[] | null; item_ids: string[] | null }
export type ShootInput = Pick<Shoot, 'title' | 'shoot_date' | 'call_time' | 'wrap_time' | 'location' | 'equipment' | 'call_sheet_notes' | 'status'>
export interface Share { id: string; created_at: string; include_shoots: boolean; expires_at: string | null; revoked_at: string | null; last_viewed_at: string | null }
export interface SharedEntry { kind: 'post' | 'shoot'; title: string; format: string | null; platform: string | null; status: string; on_date: string; at_time: string | null; live_url: string | null; brand_name: string }
export interface Expense { id: string; description: string; amount: number; expense_date: string; status: string }

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

export const productionApi = {
  async items(): Promise<ProductionItem[]> {
    if (!supabase) return pv.items()
    return must(await supabase.from('production_items').select('*').neq('stage', 'cancelled').order('sort_date', { ascending: true, nullsFirst: false })) as ProductionItem[]
  },
  async item(id: string): Promise<ProductionItem | null> {
    if (!supabase) return pv.item(id)
    return must(await supabase.from('production_items').select('*').eq('id', id).maybeSingle()) as ProductionItem | null
  },
  async create(input: ItemInput): Promise<string> {
    if (!supabase) return pv.create(input)
    return (must(await supabase.from('deliverables').insert({ ...input, stage: 'idea' }).select('id').single()) as { id: string }).id
  },
  async update(id: string, patch: ItemPatch) {
    if (!supabase) return pv.update(id, patch)
    must(await supabase.from('deliverables').update(patch).eq('id', id))
  },

  // people
  async people(id: string): Promise<Person[]> {
    if (!supabase) return pv.people(id)
    const rows = must(await supabase.from('production_people').select('id, role, team_member_id, vendor_id, creator_id').eq('deliverable_id', id)) as
      { id: string; role: PersonRole; team_member_id: string | null; vendor_id: string | null; creator_id: string | null }[]
    const opts = await productionApi.personOptions()
    return rows.map(r => {
      const kind = r.team_member_id ? 'team' : r.vendor_id ? 'vendor' : 'creator'
      const ref = (r.team_member_id ?? r.vendor_id ?? r.creator_id)!
      return { id: r.id, role: r.role, kind, ref_id: ref, name: opts.find(o => o.id === ref)?.name ?? 'Someone' }
    })
  },
  async personOptions(): Promise<PersonOption[]> {
    if (!supabase) return pv.personOptions()
    const [team, vendors, creators] = await Promise.all([
      supabase.from('team_directory').select('id, name, role'),
      supabase.from('vendors').select('id, name, skill').eq('is_archived', false),
      supabase.from('creators').select('id, name, city').eq('is_archived', false),
    ])
    return [
      ...((team.data ?? []) as { id: string; name: string; role: string }[]).map(t => ({ kind: 'team' as const, id: t.id, name: t.name, hint: t.role === 'freelancer' ? 'Freelancer' : 'Team' })),
      ...((vendors.data ?? []) as { id: string; name: string; skill: string | null }[]).map(v => ({ kind: 'vendor' as const, id: v.id, name: v.name, hint: v.skill ?? 'Vendor' })),
      ...((creators.data ?? []) as { id: string; name: string; city: string | null }[]).map(c => ({ kind: 'creator' as const, id: c.id, name: c.name, hint: `Creator${c.city ? ` · ${c.city}` : ''}` })),
    ]
  },
  async addPerson(id: string, role: PersonRole, opt: PersonOption) {
    if (!supabase) return pv.addPerson(id, role, opt)
    const col = opt.kind === 'team' ? 'team_member_id' : opt.kind === 'vendor' ? 'vendor_id' : 'creator_id'
    must(await supabase.from('production_people').insert({ deliverable_id: id, role, [col]: opt.id }))
  },
  async removePerson(personId: string) {
    if (!supabase) return pv.removePerson(personId)
    must(await supabase.from('production_people').delete().eq('id', personId))
  },

  // scripts
  async scripts(id: string): Promise<ScriptVersion[]> {
    if (!supabase) return pv.scripts(id)
    return must(await supabase.from('scripts').select('id, version, body, status, created_at, created_by').eq('deliverable_id', id).eq('is_archived', false).order('version', { ascending: false })) as ScriptVersion[]
  },
  async saveScript(id: string, body: string, asNewVersion: boolean, current?: ScriptVersion) {
    if (!supabase) return pv.saveScript(id, body, asNewVersion, current)
    if (current && !asNewVersion) must(await supabase.from('scripts').update({ body }).eq('id', current.id))
    else must(await supabase.from('scripts').insert({ deliverable_id: id, version: (current?.version ?? 0) + 1, body, status: 'draft' }))
  },
  async setScriptStatus(scriptId: string, status: ScriptVersion['status']) {
    if (!supabase) return pv.setScriptStatus(scriptId, status)
    must(await supabase.from('scripts').update({ status }).eq('id', scriptId))
  },
  async comments(scriptIds: string[]): Promise<ScriptComment[]> {
    if (!scriptIds.length) return []
    if (!supabase) return pv.comments(scriptIds)
    return must(await supabase.from('script_comments').select('id, script_id, from_client, author_name, body, is_resolved, created_at').in('script_id', scriptIds).eq('is_archived', false).order('created_at')) as ScriptComment[]
  },
  async addComment(scriptId: string, body: string, fromClient: boolean, authorName: string | null) {
    if (!supabase) return pv.addComment(scriptId, body, fromClient, authorName)
    must(await supabase.from('script_comments').insert({ script_id: scriptId, body, from_client: fromClient, author_name: authorName }))
  },
  async resolveComment(cid: string, resolved: boolean) {
    if (!supabase) return pv.resolveComment(cid, resolved)
    must(await supabase.from('script_comments').update({ is_resolved: resolved }).eq('id', cid))
  },

  // edits
  async edits(id: string): Promise<EditVersion[]> {
    if (!supabase) return pv.edits(id)
    return must(await supabase.from('edit_versions').select('id, version, url, notes, created_at').eq('deliverable_id', id).eq('is_archived', false).order('version', { ascending: false })) as EditVersion[]
  },
  async addEdit(id: string, version: number, url: string, notes: string | null) {
    if (!supabase) return pv.addEdit(id, version, url, notes)
    must(await supabase.from('edit_versions').insert({ deliverable_id: id, version, url, notes }))
  },

  // shoots
  async shoots(from: string, to: string): Promise<Shoot[]> {
    if (!supabase) return pv.shoots(from, to)
    return must(await supabase.from('shoot_calendar').select('*').gte('shoot_date', from).lte('shoot_date', to).neq('status', 'cancelled')) as Shoot[]
  },
  async shoot(id: string): Promise<Shoot | null> {
    if (!supabase) return pv.shoot(id)
    return must(await supabase.from('shoot_calendar').select('*').eq('id', id).maybeSingle()) as Shoot | null
  },
  async saveShoot(item: ProductionItem, input: ShootInput, shootId?: string | null) {
    if (!supabase) return pv.saveShoot(item, input, shootId)
    if (shootId) { must(await supabase.from('shoots').update(input).eq('id', shootId)); return }
    const sid = (must(await supabase.from('shoots').insert({ ...input, brand_id: item.brand_id, campaign_id: item.campaign_id }).select('id').single()) as { id: string }).id
    must(await supabase.from('shoot_deliverables').insert({ shoot_id: sid, deliverable_id: item.id }))
  },
  async moveShoot(id: string, shoot_date: string) {
    if (!supabase) return pv.moveShoot(id, shoot_date)
    must(await supabase.from('shoots').update({ shoot_date }).eq('id', id))
  },

  async expenses(id: string): Promise<Expense[]> {
    if (!supabase) return []
    return must(await supabase.from('expenses').select('id, description, amount, expense_date, status').eq('deliverable_id', id).eq('is_archived', false).order('expense_date')) as Expense[]
  },
  async activity(id: string): Promise<ActivityEntry[]> {
    if (!supabase) return pv.activity(id)
    return must(await supabase.rpc('production_activity', { p_item: id })) as ActivityEntry[]
  },

  // client calendar links
  async shares(brandId: string): Promise<Share[]> {
    if (!supabase) return pv.shares(brandId)
    return must(await supabase.from('calendar_shares').select('id, created_at, include_shoots, expires_at, revoked_at, last_viewed_at').eq('brand_id', brandId).is('revoked_at', null).order('created_at', { ascending: false })) as Share[]
  },
  async createShare(brandId: string, days: number | null, includeShoots: boolean): Promise<string> {
    if (!supabase) return pv.createShare(brandId, days, includeShoots)
    return must(await supabase.rpc('create_calendar_share', { p_brand: brandId, p_days: days, p_include_shoots: includeShoots })) as string
  },
  async revokeShare(id: string) {
    if (!supabase) return pv.revokeShare(id)
    must(await supabase.from('calendar_shares').update({ revoked_at: new Date().toISOString() }).eq('id', id))
  },
  async sharedBrand(token: string): Promise<{ brand_name: string; include_shoots: boolean; expires_at: string | null } | null> {
    if (!supabase) return pv.sharedBrand(token)
    const rows = must(await supabase.rpc('shared_calendar_brand', { p_token: token })) as { brand_name: string; include_shoots: boolean; expires_at: string | null }[]
    return rows[0] ?? null
  },
  async sharedCalendar(token: string, from: string, to: string): Promise<SharedEntry[]> {
    if (!supabase) return pv.sharedCalendar(token, from, to)
    return must(await supabase.rpc('shared_calendar', { p_token: token, p_from: from, p_to: to })) as SharedEntry[]
  },
}
