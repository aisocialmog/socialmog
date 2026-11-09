// Turns activity_log rows into short sentences for the Activity tab.
import { formatDate, formatINR } from './format'
import { ENGAGEMENT_LABEL, STATUS_LABEL as BRAND_STATUS, type BrandStatus, type EngagementType } from './brands'

export interface ActivityEntry {
  id: string; created_at: string; action: 'create' | 'update' | 'status_change' | 'archive' | 'restore' | 'delete'
  table_name: string; record_id: string; changed_fields: string[]
  old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null
  source: string; actor_id: string | null; actor_name: string
}
export type ActivityKind = 'create' | 'status' | 'money' | 'archive' | 'update'

const NOUN: Record<string, string> = {
  brands: 'the brand', brand_contacts: 'contact', retainers: 'the retainer', retainer_scope_items: 'retainer scope',
  files: 'file', campaigns: 'campaign', brand_tags: 'tag',
}
const FIELD: Record<string, string> = {
  name: 'name', billing_name: 'billing name', industry: 'industry', website: 'website', instagram_handle: 'Instagram',
  youtube_handle: 'YouTube', engagement_type: 'engagement type', status: 'status', source: 'lead source', owner_id: 'owner',
  city: 'city', state: 'state', state_code: 'GST state', gstin: 'GSTIN', pan: 'PAN', billing_address: 'billing address',
  payment_terms_days: 'payment terms', notes: 'notes', logo_path: 'logo',
  designation: 'designation', phone: 'phone', whatsapp: 'WhatsApp', email: 'email', is_primary: 'primary contact', is_billing: 'billing contact',
  monthly_fee: 'monthly fee', start_date: 'start date', billing_day: 'billing day', renewal_date: 'renewal date', scope: 'scope of work',
  title: 'title', kind: 'file type', file_name: 'file name',
}
const MONEY = new Set(['monthly_fee'])
const DATES = new Set(['start_date', 'renewal_date', 'end_date'])

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'blank'
  if (MONEY.has(field)) return formatINR(Number(v))
  if (DATES.has(field)) return formatDate(String(v))
  if (field === 'status' && typeof v === 'string' && v in BRAND_STATUS) return BRAND_STATUS[v as BrandStatus]
  if (field === 'engagement_type') return ENGAGEMENT_LABEL[v as EngagementType] ?? String(v)
  if (field === 'payment_terms_days') return `${v} days`
  if (field === 'billing_day') return `day ${v}`
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  const s = String(v)
  return s.length > 40 ? s.slice(0, 38) + '…' : s
}
const label = (f: string) => FIELD[f] ?? f.replace(/_/g, ' ')
const titleOf = (e: ActivityEntry, names: Record<string, string>) =>
  (e.new_values?.name ?? e.old_values?.name ?? e.new_values?.file_name ?? e.old_values?.file_name ?? e.new_values?.title ?? names[e.record_id] ?? '') as string

/** Fields that never need to be shown (bookkeeping). */
const QUIET = new Set(['updated_at', 'archived_at', 'created_at', 'created_by', 'id', 'state_code', 'import_batch_id'])

export function describeActivity(e: ActivityEntry, names: Record<string, string> = {}, ownerNames: Record<string, string> = {}): { text: string; kind: ActivityKind } {
  const noun = NOUN[e.table_name] ?? e.table_name.replace(/_/g, ' ')
  const t = titleOf(e, names)
  const thing = e.table_name === 'brands' || e.table_name === 'retainers' ? noun : `${noun}${t ? ` “${t}”` : ''}`

  switch (e.action) {
    case 'create':
      if (e.table_name === 'brands') return { text: 'added the brand', kind: 'create' }
      if (e.table_name === 'retainers') return { text: `set up the retainer at ${formatINR(Number(e.new_values?.monthly_fee))}/month`, kind: 'money' }
      if (e.table_name === 'files') return { text: `uploaded ${thing}`, kind: 'create' }
      return { text: `added ${thing}`, kind: 'create' }
    case 'archive': return { text: e.table_name === 'files' ? `removed ${thing}` : `archived ${thing}`, kind: 'archive' }
    case 'restore': return { text: `restored ${thing}`, kind: 'create' }
    case 'delete': return { text: `deleted ${thing}`, kind: 'archive' }
    case 'status_change': {
      const f = e.changed_fields.includes('status') ? 'status' : 'stage'
      const verb = e.table_name === 'brands' ? 'moved the brand' : `moved ${thing}`
      return { text: `${verb} from ${show(f, e.old_values?.[f])} to ${show(f, e.new_values?.[f])}`, kind: 'status' }
    }
    default: {
      const fields = e.changed_fields.filter(f => !QUIET.has(f))
      if (e.table_name === 'brand_contacts' && fields.length === 1 && fields[0] === 'is_primary')
        return e.new_values?.is_primary
          ? { text: `made ${t || 'a contact'} the primary contact`, kind: 'update' }
          : { text: `${t || 'a contact'} is no longer the primary contact`, kind: 'update' }
      if (fields.length === 1) {
        const f = fields[0]
        const from = f === 'owner_id' ? (ownerNames[String(e.old_values?.[f])] ?? 'someone') : show(f, e.old_values?.[f])
        const to = f === 'owner_id' ? (ownerNames[String(e.new_values?.[f])] ?? 'someone') : show(f, e.new_values?.[f])
        if (f === 'notes' || f === 'scope' || f === 'billing_address' || f === 'logo_path')
          return { text: `updated the ${label(f)}${e.table_name === 'brands' || e.table_name === 'retainers' ? '' : ` of ${thing}`}`, kind: 'update' }
        return { text: `changed ${label(f)}${e.table_name === 'brands' ? '' : ` of ${thing}`} from ${from} to ${to}`, kind: MONEY.has(f) ? 'money' : 'update' }
      }
      const list = fields.map(label)
      const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] ?? 'details'
      return { text: `updated ${joined}${e.table_name === 'brands' ? '' : ` on ${thing}`}`, kind: 'update' }
    }
  }
}
