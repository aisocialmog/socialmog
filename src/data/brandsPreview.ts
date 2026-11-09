// In-memory stand-in for the database, used ONLY by the local design preview
// (npm run dev without Supabase). Holds the same two sample brands as
// supabase/samples/sample_brands.sql and mimics brand_overview + activity.
import type { ActivityEntry } from '../lib/activity'
import { fyStart, istToday } from '../lib/format'
import type { BrandFileKind } from '../lib/brands'
import type { BrandFile, BrandInput, BrandOverview, Contact, ContactInput, Owner, Retainer, RetainerInput } from './brands'

const ME = '00000000-0000-0000-0000-000000000000'
const OWNERS: Owner[] = [
  { id: ME, name: '[Founder 1 name]', photo_path: null, role: 'founder' },
  { id: 'f2', name: '[Founder 2 name]', photo_path: null, role: 'founder' },
]
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const now = () => new Date().toISOString()
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
const today = istToday()

type BrandRow = BrandInput & { id: string; created_at: string; updated_at: string; is_archived: boolean; logo_path: string | null; pan: string | null }
const brands: BrandRow[] = [
  { id: 'b1', created_at: addDays(today, -60) + 'T06:00:00Z', updated_at: now(), is_archived: false, logo_path: null, pan: null,
    name: 'Chai Sutra (sample)', billing_name: 'Chai Sutra Beverages Pvt. Ltd.', industry: 'Beverages', website: 'https://chaisutra.example',
    instagram_handle: 'chaisutra.example', youtube_handle: 'ChaiSutraTV', engagement_type: 'mixed', status: 'active', source: 'Referral',
    owner_id: ME, city: 'Mumbai', state: 'Maharashtra', state_code: '27', gstin: '27AAACC1234D1ZC',
    billing_address: '4th floor, Kamala Mills, Lower Parel, Mumbai 400013', payment_terms_days: 30,
    notes: 'Monthly reels + festive campaigns. Approvals go through the brand manager; finance needs POs before invoicing.' },
  { id: 'b2', created_at: addDays(today, -6) + 'T09:00:00Z', updated_at: now(), is_archived: false, logo_path: null, pan: null,
    name: 'Neelam Naturals (sample)', billing_name: null, industry: 'Beauty & skincare', website: 'https://neelamnaturals.example',
    instagram_handle: 'neelam.naturals.example', youtube_handle: null, engagement_type: 'campaign_management', status: 'pitching', source: 'Instagram',
    owner_id: 'f2', city: 'Jaipur', state: 'Rajasthan', state_code: '08', gstin: null, billing_address: null, payment_terms_days: null,
    notes: 'Inbound DM after our skincare reel. Wants 5 micro creators for a winter launch. Send proposal by Friday.' },
]
const contacts: Contact[] = [
  { id: 'c1', brand_id: 'b1', name: 'Priya Nair', designation: 'Brand manager', phone: '+91 98200 11111', whatsapp: '+91 98200 11111', email: 'priya@chaisutra.example', is_primary: true, is_billing: false, notes: null, is_archived: false },
  { id: 'c2', brand_id: 'b1', name: 'Rohan Shah', designation: 'Finance', phone: '+91 98200 22222', whatsapp: null, email: 'accounts@chaisutra.example', is_primary: false, is_billing: true, notes: null, is_archived: false },
  { id: 'c3', brand_id: 'b2', name: 'Ananya Rathore', designation: 'Founder', phone: '+91 99280 33333', whatsapp: '+91 99280 33333', email: 'ananya@neelamnaturals.example', is_primary: true, is_billing: true, notes: null, is_archived: false },
]
const retainers: Retainer[] = [
  { id: 'r1', brand_id: 'b1', title: 'Always-on social', status: 'active', monthly_fee: 85000, start_date: fyStart(today), billing_day: 5,
    renewal_date: addDays(today, 10), scope: '8 reels + 12 stories a month on Instagram, 2 YouTube Shorts, monthly content calendar and community replies.' },
]
const files: (BrandFile & { brand_id: string })[] = []
const log: ActivityEntry[] = [
  { id: uid(), created_at: addDays(today, -60) + 'T06:00:00Z', action: 'create', table_name: 'brands', record_id: 'b1', changed_fields: [], old_values: null, new_values: { name: 'Chai Sutra (sample)', brand_id: undefined }, source: 'system', actor_id: null, actor_name: 'System' },
  { id: uid(), created_at: addDays(today, -60) + 'T06:01:00Z', action: 'create', table_name: 'brand_contacts', record_id: 'c1', changed_fields: [], old_values: null, new_values: { name: 'Priya Nair', brand_id: 'b1' }, source: 'system', actor_id: null, actor_name: 'System' },
  { id: uid(), created_at: addDays(today, -60) + 'T06:02:00Z', action: 'create', table_name: 'retainers', record_id: 'r1', changed_fields: [], old_values: null, new_values: { monthly_fee: 85000, brand_id: 'b1' }, source: 'system', actor_id: null, actor_name: 'System' },
  { id: uid(), created_at: addDays(today, -6) + 'T09:00:00Z', action: 'create', table_name: 'brands', record_id: 'b2', changed_fields: [], old_values: null, new_values: { name: 'Neelam Naturals (sample)' }, source: 'system', actor_id: null, actor_name: 'System' },
  { id: uid(), created_at: addDays(today, -2) + 'T11:20:00Z', action: 'status_change', table_name: 'brands', record_id: 'b2', changed_fields: ['status'], old_values: { status: 'lead' }, new_values: { status: 'pitching' }, source: 'app', actor_id: 'f2', actor_name: '[Founder 2 name]' },
]

function record(table: string, id: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, brandId: string) {
  let action: ActivityEntry['action'] = before ? 'update' : 'create'
  let changed: string[] = [], o: Record<string, unknown> | null = null, n: Record<string, unknown> | null = after
  if (before && after) {
    changed = Object.keys(after).filter(k => k !== 'updated_at' && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    if (!changed.length) return
    o = Object.fromEntries(changed.map(k => [k, before[k]])); n = Object.fromEntries(changed.map(k => [k, after[k]]))
    if (changed.includes('is_archived')) action = after.is_archived ? 'archive' : 'restore'
    else if (changed.includes('status') && table !== 'retainers') action = 'status_change'
  }
  if (action === 'create') n = { ...after, brand_id: brandId }
  log.unshift({ id: uid(), created_at: now(), action, table_name: table, record_id: id, changed_fields: changed, old_values: o, new_values: n, source: 'app', actor_id: ME, actor_name: '[Founder 1 name]' })
}

function overview(b: BrandRow): BrandOverview {
  const owner = OWNERS.find(o => o.id === b.owner_id)
  const pc = contacts.filter(c => c.brand_id === b.id && !c.is_archived).sort((x, y) => Number(y.is_primary) - Number(x.is_primary))[0]
  const r = retainers.find(x => x.brand_id === b.id && ['draft', 'active', 'paused'].includes(x.status))
  const days = r?.renewal_date ? Math.round((Date.parse(r.renewal_date) - Date.parse(today)) / 864e5) : null
  return {
    ...b, owner_name: owner?.name ?? null, owner_photo_path: null,
    lifetime_revenue: 0, received: 0, outstanding: 0, overdue: 0, active_campaigns: 0, total_campaigns: 0,
    primary_contact_id: pc?.id ?? null, primary_contact_name: pc?.name ?? null, primary_contact_email: pc?.email ?? null, primary_contact_phone: pc?.phone ?? null,
    retainer_id: r?.id ?? null, retainer_status: r?.status ?? null, monthly_fee: r?.monthly_fee ?? null, retainer_start_date: r?.start_date ?? null,
    billing_day: r?.billing_day ?? null, renewal_date: r?.renewal_date ?? null, days_to_renewal: days,
    renewal_warning: Boolean(r && r.status === 'active' && days !== null && days <= 15),
  }
}
const delay = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(structuredClone(v)), 120))

export const preview = {
  list: (archived: boolean) => delay(brands.filter(b => b.is_archived === archived).map(overview).sort((a, b) => a.name.localeCompare(b.name))),
  get: (id: string) => delay(brands.find(b => b.id === id) ? overview(brands.find(b => b.id === id)!) : null),
  owners: () => delay(OWNERS),
  async save(input: BrandInput, id?: string) {
    if (id) {
      const b = brands.find(x => x.id === id)!; const before = { ...b }
      Object.assign(b, input, { updated_at: now() }); record('brands', id, before, { ...b }, id); return id
    }
    const nb: BrandRow = { ...input, id: uid(), created_at: now(), updated_at: now(), is_archived: false, logo_path: null, pan: null }
    brands.push(nb); record('brands', nb.id, null, { name: nb.name }, nb.id); return nb.id
  },
  async patch(id: string, p: Partial<BrandRow>) {
    const b = brands.find(x => x.id === id)!; const before = { ...b }
    Object.assign(b, p, { updated_at: now() }); record('brands', id, before, { ...b }, id); await delay(null)
  },
  retainer: (brandId: string) => delay(retainers.find(r => r.brand_id === brandId && ['draft', 'active', 'paused'].includes(r.status)) ?? null),
  async saveRetainer(brandId: string, input: RetainerInput | null) {
    const cur = retainers.find(r => r.brand_id === brandId && ['draft', 'active', 'paused'].includes(r.status))
    if (!input) { if (cur) { const b = { ...cur }; cur.status = 'ended'; record('retainers', cur.id, b, { ...cur }, brandId) } return }
    if (cur) { const b = { ...cur }; Object.assign(cur, input); record('retainers', cur.id, b, { ...cur }, brandId) }
    else { const r = { ...input, id: uid(), brand_id: brandId, title: 'Monthly retainer', status: 'active' }; retainers.push(r); record('retainers', r.id, null, { monthly_fee: r.monthly_fee }, brandId) }
  },
  contacts: (brandId: string) => delay(contacts.filter(c => c.brand_id === brandId).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name))),
  async saveContact(brandId: string, input: ContactInput, id?: string) {
    const { is_primary, ...rest } = input
    let c = contacts.find(x => x.id === id)
    if (c) { const b = { ...c }; Object.assign(c, rest); record('brand_contacts', c.id, b, { ...c }, brandId) }
    else { c = { ...rest, id: uid(), brand_id: brandId, is_primary: false, is_archived: false }; contacts.push(c); record('brand_contacts', c.id, null, { name: c.name }, brandId) }
    if (is_primary) await preview.makePrimary(c.id)
  },
  async makePrimary(contactId: string) {
    const c = contacts.find(x => x.id === contactId)!
    for (const o of contacts.filter(x => x.brand_id === c.brand_id && x.is_primary && x.id !== contactId)) { o.is_primary = false; record('brand_contacts', o.id, { is_primary: true }, { is_primary: false }, c.brand_id) }
    if (!c.is_primary) { c.is_primary = true; record('brand_contacts', c.id, { is_primary: false }, { is_primary: true }, c.brand_id) }
  },
  async archiveContact(contactId: string) {
    const c = contacts.find(x => x.id === contactId)!; const b = { ...c }
    c.is_archived = true; c.is_primary = false; record('brand_contacts', c.id, b, { ...c }, c.brand_id)
  },
  files: (brandId: string) => delay(files.filter(f => f.brand_id === brandId)),
  async uploadFile(brandId: string, file: File, kind: BrandFileKind) {
    const f = { id: uid(), brand_id: brandId, file_name: file.name, kind, mime_type: file.type, size_bytes: file.size,
      storage_path: `preview:${URL.createObjectURL(file)}`, created_at: now(), created_by: ME, is_archived: false }
    files.unshift(f); record('files', f.id, null, { file_name: f.file_name }, brandId); await delay(null)
  },
  async archiveFile(id: string) {
    const f = files.find(x => x.id === id)!; const b = { ...f }; f.is_archived = true; record('files', id, b, { ...f }, f.brand_id)
  },
  activity: (brandId: string) => {
    const kids = new Set([...contacts.filter(c => c.brand_id === brandId).map(c => c.id), ...retainers.filter(r => r.brand_id === brandId).map(r => r.id), ...files.filter(f => f.brand_id === brandId).map(f => f.id)])
    return delay(log.filter(e => (e.table_name === 'brands' && e.record_id === brandId) || kids.has(e.record_id)))
  },
}
