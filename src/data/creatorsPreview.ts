// In-memory stand-in used ONLY by the local design preview (no Supabase).
// Same five sample creators as supabase/samples/sample_creators.sql.
import type { ActivityEntry } from '../lib/activity'
import { tierFor, type CreatorFilters, type DeliverableType, type ImportRow } from '../lib/creators'
import { istToday } from '../lib/format'
import type { CreatorInput, CreatorOverview, Duplicate, Niche, PaymentDetails, PlatformInput, PlatformRow, RateRow, SavedView, Shortlist, ShortlistEntry, Snapshot } from './creators'

const ME = '00000000-0000-0000-0000-000000000000'
const today = istToday()
const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const delay = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(structuredClone(v)), 100))

type Row = CreatorInput & { id: string; created_at: string; updated_at: string; is_archived: boolean; photo_path: string | null; owner_id: string | null; import_batch_id: string | null }
const base = { manager_name: null, manager_agency: null, manager_phone: null, manager_email: null, owner_id: null, photo_path: null, import_batch_id: null, is_archived: false, created_at: addDays(today, -40) + 'T06:00:00Z', updated_at: now() }
const creators: Row[] = [
  { ...base, id: 'c1', name: 'Aarohi Sinha (sample)', gender: 'female', city: 'Ranchi', state: 'Jharkhand', languages: ['Hindi', 'English'], phone: '+91 98350 10001', whatsapp: '+91 98350 10001', email: 'aarohi@creator.example', status: 'active', rating: 5, would_work_again: true, is_blacklisted: false, blacklist_reason: null, notes: 'Street-food reels, very quick turnaround. Shoots in Hindi; great with festive food.' },
  { ...base, id: 'c2', name: 'Kabir Menon (sample)', gender: 'male', city: 'Bengaluru', state: 'Karnataka', languages: ['English', 'Malayalam'], phone: '+91 99000 10002', whatsapp: null, email: 'kabir@creator.example', manager_name: 'Ira Das', manager_agency: 'Pixel Talent (sample agency)', manager_phone: '+91 99000 20002', manager_email: 'ira@pixeltalent.example', status: 'active', rating: 4, would_work_again: true, is_blacklisted: false, blacklist_reason: null, notes: 'Long-form tech reviews. Book 3 weeks ahead; agency handles contracts.' },
  { ...base, id: 'c3', name: 'Sana Qureshi (sample)', gender: 'female', city: 'Mumbai', state: 'Maharashtra', languages: ['Hindi', 'English'], phone: '+91 98200 10003', whatsapp: '+91 98200 10003', email: 'sana@creator.example', status: 'active', rating: 4, would_work_again: true, is_blacklisted: false, blacklist_reason: null, notes: 'Fashion + skincare. Strong saves on carousels.' },
  { ...base, id: 'c4', name: 'Rohit Verma "Desi Dad" (sample)', gender: 'male', city: 'Delhi', state: 'Delhi', languages: ['Hindi'], phone: '+91 98100 10004', whatsapp: null, email: 'rohit@creator.example', manager_name: 'Neha Arora', manager_phone: '+91 98100 20004', status: 'active', rating: 3, would_work_again: false, is_blacklisted: false, blacklist_reason: null, notes: 'Huge reach, but delivered 6 days late on the last two campaigns.' },
  { ...base, id: 'c5', name: 'Meenal Jha (sample)', gender: 'female', city: 'Ranchi', state: 'Jharkhand', languages: ['Hindi'], phone: '+91 98350 10005', whatsapp: '+91 98350 10005', email: null, status: 'inactive', rating: 1, would_work_again: false, is_blacklisted: true, blacklist_reason: 'Posted brand content before approval (Mar 2026).', notes: null },
]
const P = (id: string, creator_id: string, platform: string, handle: string, followers: number | null, avg_views: number | null, engagement_rate: number | null): PlatformRow & { is_archived: boolean } =>
  ({ id, creator_id, platform, handle, url: null, followers, avg_views, engagement_rate, metrics_updated_on: today, is_primary: false, is_archived: false })
const platforms = [
  P('p11', 'c1', 'instagram', 'aarohi.eats.sample', 48200, 31000, 6.2), P('p12', 'c1', 'youtube', 'AarohiEatsSample', 8900, 4200, 3.1),
  P('p21', 'c2', 'youtube', 'KabirTechSample', 640000, 210000, 4.4), P('p22', 'c2', 'instagram', 'kabir.tech.sample', 210000, 95000, 3.8), P('p23', 'c2', 'x', 'kabirtech_sample', 38000, null, null),
  P('p31', 'c3', 'instagram', 'sana.styles.sample', 156000, 64000, 5.1),
  P('p41', 'c4', 'instagram', 'desidad.sample', 1240000, 820000, 7.9), P('p42', 'c4', 'moj', 'desidad_sample', 210000, 90000, null),
  P('p51', 'c5', 'instagram', 'meenal.khana.sample', 7400, 3900, 8.4), P('p52', 'c5', 'josh', 'meenal_jha_sample', 5100, 2600, null),
]
// a little growth history so the sparkline has something to draw
const snapshots: Snapshot[] = platforms.flatMap(p => [120, 90, 60, 30, 0].map((d, i) => ({
  creator_platform_id: p.id, captured_on: addDays(today, -d), followers: p.followers == null ? null : Math.round(p.followers * (0.78 + i * 0.055)), avg_views: p.avg_views,
})))
const niches: (Niche & { is_archived: boolean })[] = ['Food', 'Tech', 'Fashion', 'Comedy', 'Finance', 'Parenting', 'Beauty', 'Fitness', 'Travel', 'Lifestyle', 'Education', 'Gaming', 'Auto', 'Health', 'Regional']
  .map((name, i) => ({ id: `n${i}`, name, is_archived: false }))
const nid = (name: string) => niches.find(n => n.name === name)!.id
const creatorTags: { creator_id: string; tag_id: string }[] = [
  ['c1', 'Food'], ['c1', 'Regional'], ['c2', 'Tech'], ['c2', 'Education'], ['c3', 'Fashion'], ['c3', 'Beauty'], ['c4', 'Parenting'], ['c4', 'Comedy'], ['c5', 'Food'], ['c5', 'Lifestyle'],
].map(([c, t]) => ({ creator_id: c, tag_id: nid(t) }))
const R = (creator_id: string, deliverable_type: DeliverableType, rate: number, valid_from = addDays(today, -40), valid_to: string | null = null): RateRow & { creator_id: string } =>
  ({ id: uid(), creator_id, deliverable_type, rate, valid_from, valid_to, notes: null, is_archived: false })
const rates = [
  R('c1', 'reel', 7500, addDays(today, -200), addDays(today, -41)), R('c1', 'reel', 9000), R('c1', 'story', 2500), R('c1', 'post', 4000),
  R('c2', 'youtube_video', 120000), R('c2', 'short', 35000), R('c2', 'reel', 45000),
  R('c3', 'reel', 28000), R('c3', 'story', 8000), R('c3', 'post', 15000), R('c3', 'ugc_video', 18000),
  R('c4', 'reel', 150000), R('c4', 'live', 60000), R('c5', 'reel', 3000),
]
const payments: Record<string, PaymentDetails> = {
  c1: { legal_name: 'Aarohi Sinha', pan: 'ABCPS1234K', upi_id: 'aarohi.sample@okaxis', bank_name: 'HDFC Bank', bank_account_name: 'Aarohi Sinha', bank_account_number: '50100012345678', ifsc: 'HDFC0001234', gstin: null, tds_section: '194J', tds_rate: 10 },
}
const shortlists: (Omit<Shortlist, 'count'> & { is_archived: boolean })[] = []
const entries: (ShortlistEntry & { shortlist_id: string; is_archived: boolean })[] = []
const views: SavedView[] = [{ id: 'v1', name: 'Ranchi food micro creators', query: { q: '', niches: ['Food'], city: 'Ranchi', language: '', tiers: ['micro'], platform: '', followersMin: '', followersMax: '', rateType: 'reel', rateMin: '', rateMax: '', minRating: 0, showBlacklisted: false }, is_shared: true, created_by: ME }]
const log: ActivityEntry[] = creators.map(c => ({ id: uid(), created_at: c.created_at, action: 'create' as const, table_name: 'creators', record_id: c.id, changed_fields: [], old_values: null, new_values: { name: c.name }, source: 'system', actor_id: null, actor_name: 'System' }))

function record(table: string, id: string, creatorId: string, before: Record<string, unknown> | null, after: Record<string, unknown>) {
  if (!before) { log.unshift({ id: uid(), created_at: now(), action: 'create', table_name: table, record_id: id, changed_fields: [], old_values: null, new_values: { ...after, creator_id: creatorId }, source: 'app', actor_id: ME, actor_name: '[Founder 1 name]' }); return }
  const changed = Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k !== 'updated_at')
  if (!changed.length) return
  const action = changed.includes('is_archived') ? (after.is_archived ? 'archive' : 'restore') : changed.includes('status') ? 'status_change' : 'update'
  log.unshift({ id: uid(), created_at: now(), action, table_name: table, record_id: id, changed_fields: changed,
    old_values: Object.fromEntries(changed.map(k => [k, before[k]])), new_values: Object.fromEntries(changed.map(k => [k, after[k]])), source: 'app', actor_id: ME, actor_name: '[Founder 1 name]' })
}

function overview(c: Row): CreatorOverview {
  const ps = platforms.filter(p => p.creator_id === c.id && !p.is_archived).sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1))
  const top = ps[0]
  const cur = rates.filter(r => r.creator_id === c.id && !r.valid_to && !r.is_archived)
  const rate = (t: DeliverableType) => cur.find(r => r.deliverable_type === t)?.rate ?? null
  const tags = creatorTags.filter(t => t.creator_id === c.id).map(t => niches.find(n => n.id === t.tag_id)!).filter(n => !n.is_archived).sort((a, b) => a.name.localeCompare(b.name))
  return {
    ...c, phone_key: c.phone?.replace(/\D/g, '').slice(-10) ?? null,
    max_followers: top?.followers ?? null, tier: tierFor(top?.followers ?? null), top_platform: top?.platform ?? null, top_handle: top?.handle ?? null,
    top_avg_views: top?.avg_views ?? null, top_engagement_rate: top?.engagement_rate ?? null,
    platforms: ps.length ? [...new Set(ps.map(p => p.platform))] : null, handles: ps.map(p => `${p.platform}:${p.handle.toLowerCase()}`),
    metrics_updated_on: ps.map(p => p.metrics_updated_on).sort().at(-1) ?? null,
    niches: tags.map(t => t.name), niche_ids: tags.map(t => t.id),
    rate_reel: rate('reel'), rate_story: rate('story'), rate_post: rate('post'), rate_youtube_video: rate('youtube_video'),
    rate_short: rate('short'), rate_ugc_video: rate('ugc_video'), rate_live: rate('live'),
    rates_updated_on: cur.map(r => r.valid_from).sort().at(-1) ?? null,
    min_rate: cur.length ? Math.min(...cur.map(r => r.rate)) : null, max_rate: cur.length ? Math.max(...cur.map(r => r.rate)) : null,
    campaigns_count: 0, last_campaign_on: null, total_paid: 0,
  }
}

export const creatorsPreview = {
  list: (archived: boolean) => delay(creators.filter(c => c.is_archived === archived).map(overview).sort((a, b) => a.name.localeCompare(b.name))),
  get: (id: string) => delay(creators.find(c => c.id === id) ? overview(creators.find(c => c.id === id)!) : null),
  byIds: (ids: string[]) => delay(creators.filter(c => ids.includes(c.id)).map(overview)),
  async save(input: CreatorInput, id?: string) {
    if (id) { const c = creators.find(x => x.id === id)!; const b = { ...c }; Object.assign(c, input, { updated_at: now() }); record('creators', id, id, b, { ...c }); return id }
    const c: Row = { ...base, ...input, id: uid(), created_at: now(), updated_at: now() }; creators.push(c); record('creators', c.id, c.id, null, { name: c.name }); return c.id
  },
  async patch(id: string, p: Partial<Row>) { const c = creators.find(x => x.id === id)!; const b = { ...c }; Object.assign(c, p, { updated_at: now() }); record('creators', id, id, b, { ...c }) },
  niches: () => delay(niches.filter(n => !n.is_archived).map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))),
  async addNiche(name: string) { const n = { id: uid(), name: name.trim(), is_archived: false }; niches.push(n); return { id: n.id, name: n.name } },
  async renameNiche(id: string, name: string) { niches.find(n => n.id === id)!.name = name.trim() },
  async archiveNiche(id: string) { niches.find(n => n.id === id)!.is_archived = true },
  async setNiches(creatorId: string, next: string[]) {
    const cur = creatorTags.filter(t => t.creator_id === creatorId).map(t => t.tag_id)
    for (const t of next.filter(x => !cur.includes(x))) { creatorTags.push({ creator_id: creatorId, tag_id: t }); record('creator_tags', uid(), creatorId, null, { tag_id: t }) }
    for (const t of cur.filter(x => !next.includes(x))) {
      creatorTags.splice(creatorTags.findIndex(x => x.creator_id === creatorId && x.tag_id === t), 1)
      log.unshift({ id: uid(), created_at: now(), action: 'delete', table_name: 'creator_tags', record_id: uid(), changed_fields: [], old_values: { creator_id: creatorId, tag_id: t }, new_values: null, source: 'app', actor_id: ME, actor_name: '[Founder 1 name]' })
    }
  },
  platforms: (creatorId: string) => delay(platforms.filter(p => p.creator_id === creatorId && !p.is_archived).sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1))),
  async savePlatform(creatorId: string, input: PlatformInput, id?: string) {
    const clash = platforms.find(p => !p.is_archived && p.id !== id && p.platform === input.platform && p.handle.toLowerCase() === input.handle.toLowerCase())
    if (clash) throw new Error(`@${input.handle} on ${input.platform} already belongs to another creator`)
    if (id) {
      const p = platforms.find(x => x.id === id)!; const b = { ...p }
      const metricsChanged = p.followers !== input.followers || p.avg_views !== input.avg_views || p.engagement_rate !== input.engagement_rate
      Object.assign(p, input, metricsChanged && !input.metrics_updated_on ? { metrics_updated_on: today } : {})
      record('creator_platforms', id, creatorId, b, { ...p })
    } else {
      const p = { ...input, id: uid(), creator_id: creatorId, is_primary: false, is_archived: false, metrics_updated_on: input.metrics_updated_on ?? today, url: input.url ?? null }
      platforms.push(p); record('creator_platforms', p.id, creatorId, null, { platform: p.platform, handle: p.handle })
    }
  },
  async archivePlatform(id: string) { const p = platforms.find(x => x.id === id)!; const b = { ...p }; p.is_archived = true; record('creator_platforms', id, p.creator_id, b, { ...p }) },
  snapshots: (ids: string[]) => delay(snapshots.filter(s => ids.includes(s.creator_platform_id))),
  rates: (creatorId: string) => delay(rates.filter(r => r.creator_id === creatorId && !r.is_archived).sort((a, b) => b.valid_from.localeCompare(a.valid_from))),
  async setRate(creatorId: string, type: DeliverableType, rate: number | null) {
    const cur = rates.find(r => r.creator_id === creatorId && r.deliverable_type === type && !r.valid_to && !r.is_archived)
    if (cur?.rate === rate) return
    if (cur) {
      if (cur.valid_from === today) { const b = { ...cur }; if (rate == null) cur.is_archived = true; else cur.rate = rate; record('creator_rate_cards', cur.id, creatorId, b, { ...cur }); return }
      const b = { ...cur }; cur.valid_to = addDays(today, -1); record('creator_rate_cards', cur.id, creatorId, b, { ...cur })
    }
    if (rate != null) { const r = R(creatorId, type, rate, today); rates.push(r); record('creator_rate_cards', r.id, creatorId, null, { deliverable_type: type, rate }) }
  },
  payment: (creatorId: string) => delay(payments[creatorId] ?? null),
  async savePayment(creatorId: string, input: PaymentDetails) {
    const b = payments[creatorId] ? { ...payments[creatorId] } : null; payments[creatorId] = input
    const mask = (o: Record<string, unknown> | null) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' && k !== 'tds_section' ? '••••' + v.slice(-4) : v]))
    record('creator_payment_details', `pay-${creatorId}`, creatorId, mask(b as never), mask(input as never)!)
  },
  activity: (creatorId: string) => {
    const kids = new Set([...platforms.filter(p => p.creator_id === creatorId).map(p => p.id), ...rates.filter(r => r.creator_id === creatorId).map(r => r.id), `pay-${creatorId}`, ...entries.filter(e => e.creator_id === creatorId).map(e => e.id)])
    return delay(log.filter(e => (e.table_name === 'creators' && e.record_id === creatorId) || kids.has(e.record_id) || e.new_values?.creator_id === creatorId || e.old_values?.creator_id === creatorId))
  },
  duplicates(phones: string[], handles: string[]): Promise<Duplicate[]> {
    const out: Duplicate[] = []
    const keys = phones.map(p => p.replace(/\D/g, '').slice(-10)).filter(Boolean)
    for (const c of creators.filter(x => !x.is_archived)) {
      const k = c.phone?.replace(/\D/g, '').slice(-10)
      if (k && keys.includes(k)) out.push({ creator_id: c.id, creator_name: c.name, matched_on: 'phone', value: k })
    }
    for (const p of platforms.filter(x => !x.is_archived)) {
      const v = `${p.platform}:${p.handle.toLowerCase()}`
      if (handles.map(h => h.toLowerCase()).includes(v)) out.push({ creator_id: p.creator_id, creator_name: creators.find(c => c.id === p.creator_id)!.name, matched_on: 'handle', value: v })
    }
    return delay(out)
  },
  async importRows(rows: ImportRow[]) {
    const batch = uid()
    for (const r of rows) {
      const id = await creatorsPreview.save({ name: r.name, gender: r.gender, city: r.city, state: r.state, languages: r.languages, phone: r.phone, whatsapp: r.whatsapp, email: r.email,
        manager_name: r.manager_name, manager_agency: null, manager_phone: r.manager_phone, manager_email: r.manager_email, status: 'prospect', rating: r.rating,
        would_work_again: null, is_blacklisted: false, blacklist_reason: null, notes: r.notes })
      creators.find(c => c.id === id)!.import_batch_id = batch
      for (const p of r.platforms) await creatorsPreview.savePlatform(id, { ...p, url: null })
      const tagIds: string[] = []
      for (const n of r.niches) { const hit = niches.find(x => !x.is_archived && x.name.toLowerCase() === n.toLowerCase()) ?? await creatorsPreview.addNiche(n[0].toUpperCase() + n.slice(1)); tagIds.push(hit.id) }
      await creatorsPreview.setNiches(id, tagIds)
      for (const [t, v] of Object.entries(r.rates)) rates.push(R(id, t as DeliverableType, v as number, today))
    }
    return { batch_id: batch, created: rows.length }
  },
  shortlists: () => delay(shortlists.filter(s => !s.is_archived).map(({ is_archived: _a, ...s }) => ({ ...s, count: entries.filter(e => e.shortlist_id === s.id && !e.is_archived).length }))),
  async createShortlist(name: string, notes: string | null) { const s = { id: uid(), name: name.trim(), notes, brand_id: null, campaign_id: null, created_at: now(), is_archived: false }; shortlists.unshift(s); return s.id },
  async addToShortlist(shortlistId: string, ids: string[]) {
    for (const creator_id of ids) {
      const e = entries.find(x => x.shortlist_id === shortlistId && x.creator_id === creator_id)
      if (e) { e.is_archived = false; continue }
      const n = { id: uid(), shortlist_id: shortlistId, creator_id, status: 'shortlisted', note: null, position: entries.length, created_at: now(), is_archived: false }
      entries.push(n); record('shortlist_creators', n.id, creator_id, null, { shortlist_id: shortlistId, name: shortlists.find(s => s.id === shortlistId)?.name })
    }
  },
  entries: (id: string) => delay(entries.filter(e => e.shortlist_id === id && !e.is_archived)),
  async updateEntry(id: string, patch: Record<string, unknown>) { const e = entries.find(x => x.id === id)!; const b = { ...e }; Object.assign(e, patch); record('shortlist_creators', id, e.creator_id, b, { ...e }) },
  async archiveShortlist(id: string) { shortlists.find(s => s.id === id)!.is_archived = true },
  views: () => delay(views),
  async saveView(name: string, query: CreatorFilters, shared: boolean) { const v = { id: uid(), name: name.trim(), query, is_shared: shared, created_by: ME }; views.push(v); return v.id },
  async deleteView(id: string) { views.splice(views.findIndex(v => v.id === id), 1) },
}
