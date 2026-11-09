// In-memory stand-in used ONLY by the local design preview (no Supabase).
import type { ActivityEntry } from '../lib/activity'
import { addDaysISO, type PersonRole, type Stage } from '../lib/production'
import { istToday } from '../lib/format'
import type { EditVersion, ItemInput, ItemPatch, Person, PersonOption, ProductionItem, ScriptComment, ScriptVersion, Share, SharedEntry, Shoot, ShootInput } from './production'

const ME = '00000000-0000-0000-0000-000000000000'
const T = istToday()
const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()
const delay = <V,>(v: V) => new Promise<V>(r => setTimeout(() => r(structuredClone(v)), 80))
const BRAND: Record<string, string> = { b1: 'Chai Sutra (sample)', b2: 'Neelam Naturals (sample)' }
const OPTIONS: PersonOption[] = [
  { kind: 'team', id: ME, name: '[Founder 1 name]', hint: 'Team' }, { kind: 'team', id: 'f2', name: '[Founder 2 name]', hint: 'Team' },
  { kind: 'team', id: 'fr1', name: 'Farid (freelance editor)', hint: 'Freelancer' }, { kind: 'vendor', id: 'v1', name: 'Lens & Light Studio', hint: 'DOP' },
  { kind: 'creator', id: 'c1', name: 'Aarohi Sinha (sample)', hint: 'Creator · Ranchi' }, { kind: 'creator', id: 'c3', name: 'Sana Qureshi (sample)', hint: 'Creator · Mumbai' },
]
type Row = Omit<ProductionItem, 'brand_name' | 'brand_logo_path' | 'brand_color' | 'days_in_stage' | 'is_stuck' | 'is_overdue' | 'people' | 'people_member_ids' | 'shoot_id' | 'shoot_date' | 'script_version' | 'script_status' | 'edit_versions' | 'over_revision_limit' | 'revision_limit' | 'sort_date' | 'assignee_name'> & { brand_limit: number | null }
const R = (id: string, brand: string, title: string, format: string, stage: Stage, target: number | null, daysInStage: number, extra: Partial<Row> = {}): Row => ({
  id, created_at: addDaysISO(T, -20) + 'T05:00:00Z', updated_at: now(), brand_id: brand, campaign_id: null, creator_id: null, assignee_id: ME, title, format, platform: 'instagram',
  stage, stage_changed_at: new Date(Date.now() - daysInStage * 864e5).toISOString(), approval_status: stage === 'client_review' ? 'pending' : stage === 'approved' ? 'approved' : 'not_submitted',
  priority: 'normal', brief: null, target_date: target == null ? null : addDaysISO(T, target), due_date: null, went_live_at: stage === 'live' ? now() : null,
  draft_url: null, live_url: stage === 'live' ? 'https://instagram.com/p/sample' : null, raw_footage_url: null, final_file_url: null, thumbnail_url: null,
  revision_count: 0, item_revision_limit: null, campaign_name: null, creator_name: null, brand_limit: brand === 'b1' ? 2 : null, ...extra,
})
const rows: Row[] = [
  R('p1', 'b1', 'Chai Sutra — brand film', 'ad_film', 'editing', 9, 5, { brief: 'A 60s film: three generations, one pot of chai.', platform: 'youtube', raw_footage_url: 'https://drive.google.com/drive/folders/sample-raw' }),
  R('p2', 'b1', 'Diwali leftovers reel', 'reel', 'client_review', 3, 1, { campaign_name: 'Diwali Chai Reels (sample)', campaign_id: 'ca1', revision_count: 3 }),
  R('p3', 'b1', 'Masala chai how-to carousel', 'carousel', 'script', 15, 2),
  R('p4', 'b2', 'Night cream routine', 'reel', 'shoot_scheduled', 11, 0, { creator_name: 'Sana Qureshi (sample)', creator_id: 'c3' }),
  R('p5', 'b2', 'Winter skin story set', 'story_set', 'idea', 20, 1),
  R('p6', 'b1', 'Chai pour slow-mo short', 'short', 'approved', -2, 1, { platform: 'youtube' }),
  R('p7', 'b2', 'Founder interview photo shoot', 'photo_shoot', 'pre_production', 6, 4),
  R('p8', 'b1', 'Kettle UGC ad', 'ugc_video', 'live', -5, 3),
]
const people: (Person & { item: string })[] = [
  { id: uid(), item: 'p1', role: 'editor', name: 'Farid (freelance editor)', kind: 'team', ref_id: 'fr1' }, { id: uid(), item: 'p1', role: 'shooter', name: 'Lens & Light Studio', kind: 'vendor', ref_id: 'v1' },
  { id: uid(), item: 'p1', role: 'scriptwriter', name: '[Founder 1 name]', kind: 'team', ref_id: ME }, { id: uid(), item: 'p4', role: 'talent', name: 'Sana Qureshi (sample)', kind: 'creator', ref_id: 'c3' },
]
const scripts: (ScriptVersion & { item: string })[] = [
  { id: 's1', item: 'p1', version: 1, body: '<h3>Open</h3><p>Steam rises from a brass kettle. <strong>Dadi</strong> hums.</p>', status: 'rejected', created_at: addDaysISO(T, -12) + 'T06:00:00Z', created_by: ME },
  { id: 's2', item: 'p1', version: 2, body: '<h3>Open</h3><p>Steam rises from a brass kettle. <strong>Dadi</strong> pours three cups.</p><ul><li>Hook in 2 seconds</li><li>Pack shot at 0:45</li></ul>', status: 'approved', created_at: addDaysISO(T, -9) + 'T06:00:00Z', created_by: ME },
]
const comments: ScriptComment[] = [{ id: uid(), script_id: 's1', from_client: true, author_name: 'Priya Nair', body: 'Feels slow — get to the pour faster.', is_resolved: true, created_at: addDaysISO(T, -11) + 'T09:00:00Z' }]
const edits: (EditVersion & { item: string })[] = [{ id: uid(), item: 'p1', version: 1, url: 'https://frame.example/brand-film-v1', notes: 'Rough cut', created_at: addDaysISO(T, -1) + 'T10:00:00Z' }]
const shoots: Shoot[] = [
  { id: 'sh1', title: 'Night cream shoot', brand_id: 'b2', brand_name: BRAND.b2, brand_color: 1, shoot_date: addDaysISO(T, 4), call_time: '08:00', wrap_time: '14:00', location: 'Bandra studio', status: 'confirmed',
    equipment: ['FX3', 'Aputure 300D ×2', 'Gimbal'], call_sheet_notes: 'Sana arrives 7:45 for make-up.', items: ['Night cream routine'], item_ids: ['p4'] },
  { id: 'sh2', title: 'Founder portraits', brand_id: 'b2', brand_name: BRAND.b2, brand_color: 1, shoot_date: addDaysISO(T, 2), call_time: '10:00', wrap_time: null, location: 'Jaipur office', status: 'planned',
    equipment: ['85mm', 'Reflector'], call_sheet_notes: null, items: ['Founder interview photo shoot'], item_ids: ['p7'] },
]
const shares: (Share & { brand_id: string; token: string })[] = []
const log: ActivityEntry[] = []
const rec = (id: string, action: ActivityEntry['action'], changed: string[], o: Record<string, unknown> | null, n: Record<string, unknown> | null, table = 'deliverables') =>
  log.unshift({ id: uid(), created_at: now(), action, table_name: table, record_id: id, changed_fields: changed, old_values: o, new_values: n, source: 'app', actor_id: ME, actor_name: '[Founder 1 name]' })

function view(r: Row): ProductionItem {
  const limit = r.item_revision_limit ?? r.brand_limit
  const days = Math.floor((Date.now() - Date.parse(r.stage_changed_at)) / 864e5)
  const sh = shoots.filter(s => s.item_ids?.includes(r.id)).sort((a, b) => a.shoot_date.localeCompare(b.shoot_date))[0]
  const sc = scripts.filter(s => s.item === r.id).sort((a, b) => b.version - a.version)[0]
  const pp = people.filter(p => p.item === r.id)
  const { brand_limit: _b, ...rest } = r
  return { ...rest, brand_name: BRAND[r.brand_id], brand_logo_path: null, brand_color: r.brand_id === 'b1' ? 0 : 1, sort_date: r.due_date ?? r.target_date, assignee_name: r.assignee_id === ME ? '[Founder 1 name]' : null,
    revision_limit: limit, over_revision_limit: limit != null && r.revision_count > limit, days_in_stage: days,
    is_stuck: !['live', 'cancelled', 'scheduled'].includes(r.stage) && days > 3, is_overdue: Boolean(r.target_date && r.target_date < T && !['live', 'cancelled'].includes(r.stage)),
    people: pp.map(p => `${p.role}:${p.name}`).sort(), people_member_ids: pp.filter(p => p.kind === 'team').map(p => p.ref_id),
    shoot_id: sh?.id ?? null, shoot_date: sh?.shoot_date ?? null, script_version: sc?.version ?? null, script_status: sc?.status ?? null, edit_versions: edits.filter(e => e.item === r.id).length }
}

export const productionPreview = {
  items: () => delay(rows.filter(r => r.stage !== 'cancelled').map(view)),
  item: (id: string) => delay(rows.find(r => r.id === id) ? view(rows.find(r => r.id === id)!) : null),
  async create(i: ItemInput) {
    const r = R(uid(), i.brand_id, i.title, i.deliverable_type, 'idea', null, 0, { platform: i.platform, campaign_id: i.campaign_id, brief: i.brief, due_date: i.due_date, assignee_id: i.assignee_id, item_revision_limit: i.revision_limit, target_date: i.go_live_date })
    rows.unshift(r); rec(r.id, 'create', [], null, { title: r.title, stage: 'idea' }); return r.id
  },
  async update(id: string, p: ItemPatch) {
    const r = rows.find(x => x.id === id)!
    const b = { ...r }
    const map: Record<string, unknown> = { ...p }
    if ('go_live_date' in p) { map.target_date = p.go_live_date; delete map.go_live_date }
    if ('revision_limit' in p) { map.item_revision_limit = p.revision_limit; delete map.revision_limit }
    if ('deliverable_type' in p) { map.format = p.deliverable_type; delete map.deliverable_type }
    if (p.stage === 'live' && !(p.live_url ?? r.live_url)) throw new Error('Add the live post link before marking it posted.')
    Object.assign(r, map)
    if (p.stage && p.stage !== b.stage) {
      r.stage_changed_at = now()
      if (p.stage === 'revisions') { r.revision_count++; r.approval_status = 'changes_requested' }
      if (p.stage === 'client_review' && r.approval_status !== 'approved') r.approval_status = 'pending'
      rec(id, 'status_change', ['stage'], { stage: b.stage }, { stage: p.stage })
    } else {
      const ch = Object.keys(map).filter(k => JSON.stringify((b as Record<string, unknown>)[k]) !== JSON.stringify(map[k]))
      if (ch.length) rec(id, 'update', ch, Object.fromEntries(ch.map(k => [k, (b as Record<string, unknown>)[k]])), Object.fromEntries(ch.map(k => [k, map[k]])))
    }
  },
  people: (id: string) => delay(people.filter(p => p.item === id)),
  personOptions: () => delay(OPTIONS),
  async addPerson(id: string, role: PersonRole, o: PersonOption) {
    if (people.some(p => p.item === id && p.role === role && p.ref_id === o.id)) throw new Error('Already added in that role')
    const p = { id: uid(), item: id, role, name: o.name, kind: o.kind, ref_id: o.id }; people.push(p); rec(p.id, 'create', [], null, { role, deliverable_id: id }, 'production_people')
  },
  async removePerson(pid: string) { people.splice(people.findIndex(p => p.id === pid), 1) },
  scripts: (id: string) => delay(scripts.filter(s => s.item === id).sort((a, b) => b.version - a.version)),
  async saveScript(id: string, body: string, asNew: boolean, cur?: ScriptVersion) {
    if (cur && !asNew) { scripts.find(s => s.id === cur.id)!.body = body; return }
    const s = { id: uid(), item: id, version: (cur?.version ?? 0) + 1, body, status: 'draft' as const, created_at: now(), created_by: ME }
    scripts.push(s); rec(s.id, 'create', [], null, { version: s.version, deliverable_id: id }, 'scripts')
  },
  async setScriptStatus(sid: string, status: ScriptVersion['status']) { const s = scripts.find(x => x.id === sid)!; const o = s.status; s.status = status; rec(sid, 'status_change', ['status'], { status: o }, { status, version: s.version }, 'scripts') },
  comments: (ids: string[]) => delay(comments.filter(c => ids.includes(c.script_id))),
  async addComment(sid: string, body: string, fromClient: boolean, author: string | null) { comments.push({ id: uid(), script_id: sid, body, from_client: fromClient, author_name: author, is_resolved: false, created_at: now() }) },
  async resolveComment(cid: string, v: boolean) { comments.find(c => c.id === cid)!.is_resolved = v },
  edits: (id: string) => delay(edits.filter(e => e.item === id).sort((a, b) => b.version - a.version)),
  async addEdit(id: string, version: number, url: string, notes: string | null) {
    edits.push({ id: uid(), item: id, version, url, notes, created_at: now() }); rows.find(r => r.id === id)!.draft_url = url
    rec(id, 'create', [], null, { version, url, deliverable_id: id }, 'edit_versions')
  },
  shoots: (from: string, to: string) => delay(shoots.filter(s => s.shoot_date >= from && s.shoot_date <= to)),
  shoot: (id: string) => delay(shoots.find(s => s.id === id) ?? null),
  async saveShoot(item: ProductionItem, input: ShootInput, sid?: string | null) {
    if (sid) { Object.assign(shoots.find(s => s.id === sid)!, input); return }
    shoots.push({ ...input, id: uid(), brand_id: item.brand_id, brand_name: item.brand_name, brand_color: item.brand_color, items: [item.title], item_ids: [item.id] })
  },
  async moveShoot(id: string, d: string) { shoots.find(s => s.id === id)!.shoot_date = d },
  activity: (id: string) => delay(log.filter(e => e.record_id === id || e.new_values?.deliverable_id === id)),
  shares: (brandId: string) => delay(shares.filter(s => s.brand_id === brandId && !s.revoked_at).map(({ token: _t, brand_id: _b, ...s }) => s)),
  async createShare(brandId: string, days: number | null, include: boolean) {
    const token = 'preview' + uid().replace(/-/g, '')
    shares.unshift({ id: uid(), brand_id: brandId, token, created_at: now(), include_shoots: include, expires_at: days ? new Date(Date.now() + days * 864e5).toISOString() : null, revoked_at: null, last_viewed_at: null })
    return token
  },
  async revokeShare(id: string) { shares.find(s => s.id === id)!.revoked_at = now() },
  sharedBrand: (token: string) => { const s = shares.find(x => x.token === token && !x.revoked_at) ?? (token === 'demo' ? { brand_id: 'b1', include_shoots: true, expires_at: null } : null)
    return delay(s ? { brand_name: BRAND[s.brand_id], include_shoots: s.include_shoots, expires_at: s.expires_at } : null) },
  async sharedCalendar(token: string, from: string, to: string): Promise<SharedEntry[]> {
    const s = shares.find(x => x.token === token && !x.revoked_at) ?? (token === 'demo' ? { brand_id: 'b1', include_shoots: true } : null)
    if (!s) throw new Error('This calendar link is not valid or has expired')
    const label = (st: Stage) => ['idea', 'script', 'script_approved', 'pre_production'].includes(st) ? 'Planned' : ['shoot_scheduled', 'shot', 'editing', 'internal_review'].includes(st) ? 'In production'
      : ['client_review', 'revisions'].includes(st) ? 'Awaiting your review' : st === 'approved' ? 'Approved' : st === 'scheduled' ? 'Scheduled' : 'Posted'
    return delay([
      ...rows.filter(r => r.brand_id === s.brand_id && r.target_date && r.target_date >= from && r.target_date <= to && r.stage !== 'cancelled')
        .map(r => ({ kind: 'post' as const, title: r.title, format: r.format, platform: r.platform, status: label(r.stage), on_date: r.target_date!, at_time: null, live_url: r.stage === 'live' ? r.live_url : null, brand_name: BRAND[r.brand_id] })),
      ...(s.include_shoots ? shoots.filter(x => x.brand_id === s.brand_id && x.shoot_date >= from && x.shoot_date <= to)
        .map(x => ({ kind: 'shoot' as const, title: 'Shoot day', format: null, platform: null, status: 'Planned', on_date: x.shoot_date, at_time: x.call_time, live_url: null, brand_name: BRAND[s.brand_id] })) : []),
    ])
  },
}
