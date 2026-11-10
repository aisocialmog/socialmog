// In-memory stand-in used ONLY by the local design preview (no Supabase).
// Mirrors supabase/samples/sample_campaign.sql plus two small extra campaigns,
// and computes the same numbers as campaign_summary / deliverable_performance.
import type { ActivityEntry } from '../lib/activity'
import { costPerView, engagementRate, engagements, isConfirmed, isOverdue, type CreatorStatus } from '../lib/campaigns'
import { istToday } from '../lib/format'
import { creatorsApi } from './creators'
import type { BriefInput, CampaignCreator, CampaignFile, CampaignInput, CampaignRecord, CampaignSummary, DeliverablePatch, DeliverableRow, Finances, MetricsInput, PromoCode } from './campaigns'

const ME = '00000000-0000-0000-0000-000000000000'
const today = istToday()
const add = (n: number) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const delay = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(structuredClone(v)), 90))
const BRANDS: Record<string, string> = { b1: 'Chai Sutra (sample)', b2: 'Neelam Naturals (sample)' }
const OWNERS: Record<string, string> = { [ME]: '[Founder 1 name]', f2: '[Founder 2 name]' }

type Camp = CampaignRecord & { is_archived: boolean; created_at: string; updated_at: string; completed_at: string | null }
const campaigns: Camp[] = [
  { id: 'ca1', brand_id: 'b1', name: 'Diwali Chai Reels (sample)', code: 'CHAI-DIWALI-SAMPLE', kind: 'influencer', objective: 'sales', platforms: ['instagram'],
    start_date: add(-20), end_date: add(10), status: 'live', owner_id: ME, is_archived: false, created_at: add(-30) + 'T05:00:00Z', updated_at: now(), completed_at: null,
    brief: 'Festive reels showing Chai Sutra masala chai as the centre of Diwali gatherings. Each creator hosts a small chai moment with family or friends.',
    key_messages: 'Made with real spices, no premix\nPerfect for festive guests\n15% off with your code',
    dos: 'Show the pack in the first 3 seconds\nPour shot in slow motion\nMention the code out loud and in the caption',
    donts: 'No comparisons with other brands\nNo sugar-free claims\nAvoid alcohol in frame', hashtags: ['#ChaiSutraDiwali', '#ChaiMoments', '#ad'], links: ['https://chaisutra.example/diwali'] },
  { id: 'ca2', brand_id: 'b2', name: 'Winter skin launch (sample)', code: 'NEELAM-WINTER', kind: 'influencer', objective: 'awareness', platforms: ['instagram', 'youtube'],
    start_date: add(14), end_date: add(45), status: 'planning', owner_id: 'f2', is_archived: false, created_at: add(-2) + 'T05:00:00Z', updated_at: now(), completed_at: null,
    brief: 'Five micro creators, winter routine with the new night cream.', key_messages: null, dos: null, donts: null, hashtags: [], links: [] },
  { id: 'ca3', brand_id: 'b1', name: 'November always-on content (sample)', code: null, kind: 'full_marketing_month', objective: 'awareness', platforms: ['instagram', 'youtube'],
    start_date: add(-8), end_date: add(21), status: 'production', owner_id: ME, is_archived: false, created_at: add(-9) + 'T05:00:00Z', updated_at: now(), completed_at: null,
    brief: '8 reels + 12 stories for the retainer month.', key_messages: null, dos: null, donts: null, hashtags: [], links: [] },
]
const finances: Record<string, Finances> = {
  ca1: { contract_value: 300000, creator_budget: 120000, production_budget: 30000, po_number: 'PO-SAMPLE-4471' },
  ca2: { contract_value: 180000, creator_budget: 70000, production_budget: null, po_number: null },
  ca3: { contract_value: 85000, creator_budget: 0, production_budget: 25000, po_number: null },
}
const expenses: Record<string, number> = { ca1: 8000 }
type CC = { id: string; campaign_id: string; creator_id: string; status: CreatorStatus; notes: string | null; agreed_fee: number | null; client_price: number | null }
const ccs: CC[] = [
  { id: 'cc1', campaign_id: 'ca1', creator_id: 'c1', status: 'posted', notes: null, agreed_fee: 30000, client_price: 60000 },
  { id: 'cc2', campaign_id: 'ca1', creator_id: 'c3', status: 'approved', notes: null, agreed_fee: 56000, client_price: 110000 },
  { id: 'cc3', campaign_id: 'ca1', creator_id: 'c4', status: 'dropped', notes: 'Dates clashed with another brand.', agreed_fee: 150000, client_price: null },
  { id: 'cc4', campaign_id: 'ca1', creator_id: 'c2', status: 'shortlisted', notes: null, agreed_fee: null, client_price: null },
]
type Del = { id: string; campaign_id: string; campaign_creator_id: string; creator_id: string; title: string; deliverable_type: string; platform: string | null; stage: string;
  approval_status: DeliverableRow['approval_status']; draft_url: string | null; live_url: string | null; go_live_date: string | null; went_live_at: string | null; created_at: string }
const D = (id: string, cc: string, c: string, title: string, type: string, stage: string, approval: Del['approval_status'], draft: string | null, live: string | null, go: number): Del =>
  ({ id, campaign_id: 'ca1', campaign_creator_id: cc, creator_id: c, title, deliverable_type: type, platform: 'instagram', stage, approval_status: approval, draft_url: draft, live_url: live,
     go_live_date: add(go), went_live_at: stage === 'live' ? add(go) + 'T12:00:00Z' : null, created_at: add(-15) + 'T05:00:00Z' })
const dels: Del[] = [
  D('d1', 'cc1', 'c1', 'Aarohi — Diwali chai reel', 'reel', 'live', 'approved', 'https://drive.example/aarohi-reel-1', 'https://instagram.com/p/sample-aarohi-1', -8),
  D('d2', 'cc1', 'c1', 'Aarohi — guests arrive reel', 'reel', 'live', 'approved', 'https://drive.example/aarohi-reel-2', 'https://instagram.com/p/sample-aarohi-2', -3),
  D('d3', 'cc1', 'c1', 'Aarohi — code story', 'story', 'live', 'approved', null, 'https://instagram.com/stories/sample-aarohi', -3),
  D('d4', 'cc2', 'c3', 'Sana — festive look reel', 'reel', 'approved', 'approved', 'https://drive.example/sana-reel', null, -2),
  D('d5', 'cc2', 'c3', 'Sana — carousel post', 'post', 'client_review', 'pending', 'https://drive.example/sana-carousel', null, 5),
]
const metrics: Record<string, MetricsInput> = {
  d1: { captured_on: add(-1), views: 184000, reach: 152000, likes: 9800, comments: 412, shares: 1350, saves: 2240, link_clicks: 960, conversions: 210 },
  d2: { captured_on: add(-1), views: 96500, reach: 81000, likes: 5100, comments: 230, shares: 640, saves: 1180, link_clicks: 420, conversions: 95 },
  d3: { captured_on: add(-1), views: 21000, reach: 21000, likes: 0, comments: 0, shares: 120, saves: 0, link_clicks: 610, conversions: 140 },
}
const promos: (PromoCode & { campaign_id: string; is_archived: boolean })[] = [
  { id: 'pc1', campaign_id: 'ca1', code: 'AAROHI15', offer: '15% off', campaign_creator_id: 'cc1', is_archived: false },
  { id: 'pc2', campaign_id: 'ca1', code: 'SANA15', offer: '15% off', campaign_creator_id: 'cc2', is_archived: false },
]
const files: (CampaignFile & { campaign_id: string })[] = []
const log: ActivityEntry[] = campaigns.map(c => ({ id: uid(), created_at: c.created_at, action: 'create' as const, table_name: 'campaigns', record_id: c.id, changed_fields: [], old_values: null, new_values: { name: c.name }, source: 'system', actor_id: null, actor_name: 'System' }))

function record(table: string, id: string, campaignId: string, before: Record<string, unknown> | null, after: Record<string, unknown>) {
  if (!before) { log.unshift({ id: uid(), created_at: now(), action: 'create', table_name: table, record_id: id, changed_fields: [], old_values: null, new_values: { ...after, campaign_id: campaignId }, source: 'app', actor_id: ME, actor_name: '[Founder 1 name]' }); return }
  const changed = Object.keys(after).filter(k => k !== 'updated_at' && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
  if (!changed.length) return
  const action = changed.includes('is_archived') ? (after.is_archived ? 'archive' : 'restore') : changed.includes('status') || changed.includes('stage') ? 'status_change' : 'update'
  log.unshift({ id: uid(), created_at: now(), action, table_name: table, record_id: id, changed_fields: changed,
    old_values: Object.fromEntries(changed.map(k => [k, before[k]])), new_values: { ...Object.fromEntries(changed.map(k => [k, after[k]])), campaign_id: campaignId }, source: 'app', actor_id: ME, actor_name: '[Founder 1 name]' })
}

function perf(d: Del): DeliverableRow {
  const m = metrics[d.id]
  const cc = ccs.find(x => x.id === d.campaign_creator_id)
  const siblings = dels.filter(x => x.campaign_creator_id === d.campaign_creator_id && x.stage !== 'cancelled').length
  const cost = cc?.agreed_fee != null && siblings ? cc.agreed_fee / siblings : null
  const names: Record<string, string> = { c1: 'Aarohi Sinha (sample)', c2: 'Kabir Menon (sample)', c3: 'Sana Qureshi (sample)', c4: 'Rohit Verma "Desi Dad" (sample)', c5: 'Meenal Jha (sample)' }
  return {
    deliverable_id: d.id, campaign_id: d.campaign_id, campaign_creator_id: d.campaign_creator_id, creator_id: d.creator_id, title: d.title, deliverable_type: d.deliverable_type,
    platform: d.platform, stage: d.stage, approval_status: d.approval_status, draft_url: d.draft_url, live_url: d.live_url, go_live_date: d.go_live_date, due_date: null,
    went_live_at: d.went_live_at, creator_name: names[d.creator_id] ?? d.creator_id, creator_photo_path: null,
    is_posted: d.stage === 'live', is_overdue: isOverdue(d.go_live_date, d.stage, today),
    days_overdue: d.go_live_date && d.go_live_date < today ? Math.round((Date.parse(today) - Date.parse(d.go_live_date)) / 864e5) : 0,
    metrics_on: m?.captured_on ?? null, views: m?.views ?? null, reach: m?.reach ?? null, likes: m?.likes ?? null, comments: m?.comments ?? null,
    shares: m?.shares ?? null, saves: m?.saves ?? null, link_clicks: m?.link_clicks ?? null, conversions: m?.conversions ?? null,
    engagements: m ? engagements(m) : 0, engagement_rate: m ? engagementRate(m) : null, cost, cost_per_view: costPerView(cost, m?.views),
  }
}

function summary(c: Camp): CampaignSummary {
  const fin = finances[c.id]
  const mine = ccs.filter(x => x.campaign_id === c.id)
  const ps = dels.filter(d => d.campaign_id === c.id).map(perf)
  const live = ps.filter(p => p.stage !== 'cancelled')
  const sum = (k: keyof DeliverableRow) => ps.some(p => p[k] != null) ? ps.reduce((s, p) => s + Number(p[k] ?? 0), 0) : null
  const actual = mine.filter(x => isConfirmed(x.status)).reduce((s, x) => s + (x.agreed_fee ?? 0), 0)
  const views = sum('views'), eng = ps.reduce((s, p) => s + p.engagements, 0)
  return {
    campaign_id: c.id, brand_id: c.brand_id, brand_name: BRANDS[c.brand_id] ?? c.brand_id, brand_logo_path: null, name: c.name, code: c.code, kind: c.kind,
    objective: c.objective, status: c.status, platforms: c.platforms, start_date: c.start_date, end_date: c.end_date, owner_id: c.owner_id,
    owner_name: c.owner_id ? OWNERS[c.owner_id] ?? null : null, is_archived: c.is_archived, updated_at: c.updated_at, created_at: c.created_at, completed_at: c.completed_at, is_historical: false,
    client_budget: fin?.contract_value ?? null, planned_creator_spend: fin?.creator_budget ?? null, planned_production_spend: fin?.production_budget ?? null,
    expected_margin: fin?.contract_value != null ? fin.contract_value - (fin.creator_budget ?? 0) - (fin.production_budget ?? 0) : null,
    creators: mine.filter(x => x.status !== 'dropped').length, confirmed_creators: mine.filter(x => isConfirmed(x.status)).length, actual_creator_spend: actual,
    client_billing: 0, received: 0, creator_payouts: 0, production_expenses: expenses[c.id] ?? 0, profit: 0 - 0 - (expenses[c.id] ?? 0),
    deliverables: live.length, posted: ps.filter(p => p.is_posted).length, overdue: ps.filter(p => p.is_overdue).length, approved: ps.filter(p => p.approval_status === 'approved').length,
    views, reach: sum('reach'), engagements: views != null ? eng : null, likes: sum('likes'), comments: sum('comments'), shares: sum('shares'), saves: sum('saves'),
    link_clicks: sum('link_clicks'), conversions: sum('conversions'),
    engagement_rate: views ? Math.round(eng / views * 10000) / 100 : null, cost_per_view: costPerView(actual, views), client_cost_per_view: costPerView(fin?.contract_value, views),
  }
}

export const campaignsPreview = {
  list: (archived: boolean) => delay(campaigns.filter(c => c.is_archived === archived).map(summary)),
  summary: (id: string) => delay(campaigns.find(c => c.id === id) ? summary(campaigns.find(c => c.id === id)!) : null),
  record: (id: string) => {
    const c = campaigns.find(x => x.id === id)
    if (!c) return delay(null)
    const { is_archived: _a, created_at: _b, updated_at: _c, completed_at: _d, ...campaign } = c
    return delay({ campaign, finances: finances[id] ?? null })
  },
  async save(input: CampaignInput, fin: Finances | null, id?: string) {
    if (id) { const c = campaigns.find(x => x.id === id)!; const b = { ...c }; Object.assign(c, input, { updated_at: now() }); record('campaigns', id, id, b, { ...c }) }
    else {
      const c: Camp = { ...input, id: uid(), brief: null, key_messages: null, dos: null, donts: null, hashtags: [], links: [], is_archived: false, created_at: now(), updated_at: now(), completed_at: null }
      campaigns.unshift(c); id = c.id; record('campaigns', id, id, null, { name: c.name })
    }
    if (fin) { const b = finances[id] ? { ...finances[id] } : null; finances[id] = fin; record('campaign_finances', `fin-${id}`, id, b as never, fin as never) }
    return id
  },
  async patch(id: string, p: Partial<Camp> | BriefInput) {
    const c = campaigns.find(x => x.id === id)!; const b = { ...c }
    Object.assign(c, p, { updated_at: now() })
    if ('status' in p) c.completed_at = c.status === 'completed' ? now() : null
    record('campaigns', id, id, b, { ...c })
  },
  promoCodes: (id: string) => delay(promos.filter(p => p.campaign_id === id && !p.is_archived)),
  async addPromo(campaignId: string, code: string, offer: string | null, ccId: string | null) {
    if (promos.some(p => p.campaign_id === campaignId && p.code === code.toUpperCase() && !p.is_archived)) throw new Error('That code is already on this campaign')
    const p = { id: uid(), campaign_id: campaignId, code: code.trim().toUpperCase(), offer, campaign_creator_id: ccId, is_archived: false }; promos.push(p)
    record('campaign_promo_codes', p.id, campaignId, null, { code: p.code })
  },
  async archivePromo(id: string) { promos.find(p => p.id === id)!.is_archived = true },
  async creators(campaignId: string): Promise<CampaignCreator[]> {
    const mine = ccs.filter(x => x.campaign_id === campaignId)
    const people = await creatorsApi.byIds(mine.map(x => x.creator_id))
    return structuredClone(mine.map(x => ({ id: x.id, creator_id: x.creator_id, status: x.status, notes: x.notes, agreed_fee: x.agreed_fee, client_price: x.client_price, creator: people.find(p => p.id === x.creator_id) ?? null })))
  },
  async addCreators(campaignId: string, ids: string[]) {
    for (const creator_id of ids) {
      if (ccs.some(x => x.campaign_id === campaignId && x.creator_id === creator_id)) continue
      const x: CC = { id: uid(), campaign_id: campaignId, creator_id, status: 'shortlisted', notes: null, agreed_fee: null, client_price: null }
      ccs.push(x); record('campaign_creators', x.id, campaignId, null, { creator_id })
    }
  },
  async addShortlist(_shortlistId: string, _campaignId: string) { return 0 },
  async setCreator(id: string, patch: Partial<CC>) {
    const x = ccs.find(c => c.id === id)!; const b = { ...x }; Object.assign(x, patch)
    record('agreed_fee' in patch ? 'campaign_creator_fees' : 'campaign_creators', id, x.campaign_id, b, { ...x })
  },
  async setQuantity(ccId: string, type: string, qty: number) {
    const cc = ccs.find(x => x.id === ccId)!
    const have = dels.filter(d => d.campaign_creator_id === ccId && d.deliverable_type === type && d.stage !== 'cancelled')
    for (let i = have.length; i < qty; i++) {
      const name = (await creatorsApi.byIds([cc.creator_id]))[0]?.name ?? 'Creator'
      const d = D(uid(), ccId, cc.creator_id, `${name.replace(' (sample)', '')} — ${type.replace('_', ' ')} ${i + 1}`, type, 'idea', 'not_submitted', null, null, 0)
      d.campaign_id = cc.campaign_id; d.go_live_date = null; d.created_at = now(); dels.push(d); record('deliverables', d.id, cc.campaign_id, null, { title: d.title })
    }
    have.filter(d => d.stage !== 'live').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Math.max(have.length - qty, 0))
      .forEach(d => { const b = { ...d }; d.stage = 'cancelled'; record('deliverables', d.id, cc.campaign_id, b, { ...d }) })
  },
  deliverables: (campaignId: string) => delay(dels.filter(d => d.campaign_id === campaignId).map(perf)
    .sort((a, b) => (a.go_live_date ?? '9').localeCompare(b.go_live_date ?? '9'))),
  async updateDeliverable(id: string, patch: DeliverablePatch) {
    const d = dels.find(x => x.id === id)!; const b = { ...d }
    const next = { ...d, ...patch } as Del
    if (next.stage === 'live' && !next.live_url?.trim()) throw new Error('Add the live post link before marking it posted.')
    if (patch.approval_status === 'approved' && !['approved', 'scheduled', 'live', 'cancelled'].includes(next.stage)) next.stage = 'approved'
    if (patch.approval_status === 'pending' && ['idea', 'script', 'script_approved', 'pre_production', 'shoot_scheduled', 'shot', 'editing', 'internal_review'].includes(next.stage)) next.stage = 'client_review'
    if (patch.approval_status === 'changes_requested' && next.stage !== 'live') next.stage = 'revisions'
    next.went_live_at = next.stage === 'live' ? (d.went_live_at ?? now()) : null
    Object.assign(d, next); record('deliverables', id, d.campaign_id, b, { ...d })
  },
  async saveMetrics(id: string, m: MetricsInput) { const b = metrics[id] ? { ...metrics[id] } : null; metrics[id] = m; record('deliverable_metrics', `m-${id}`, dels.find(d => d.id === id)!.campaign_id, b as never, { ...m, deliverable_id: id } as never) },
  files: (id: string) => delay(files.filter(f => f.campaign_id === id && !f.is_archived)),
  async uploadFile(campaignId: string, file: File, kind: string) {
    const f = { id: uid(), campaign_id: campaignId, file_name: file.name, kind, mime_type: file.type, size_bytes: file.size, storage_path: `preview:${URL.createObjectURL(file)}`, created_at: now(), is_archived: false }
    files.unshift(f); record('files', f.id, campaignId, null, { file_name: f.file_name })
  },
  async archiveFile(id: string) { const f = files.find(x => x.id === id)!; const b = { ...f }; f.is_archived = true; record('files', id, f.campaign_id, b, { ...f }) },
  activity: (id: string) => delay(log.filter(e => (e.table_name === 'campaigns' && e.record_id === id) || e.new_values?.campaign_id === id || e.old_values?.campaign_id === id)),
}
