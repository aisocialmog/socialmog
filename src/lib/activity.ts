// Turns activity_log rows into short sentences for the Activity tab.
import { formatDate, formatINR } from './format'
import { ENGAGEMENT_LABEL, STATUS_LABEL as BRAND_STATUS, type BrandStatus, type EngagementType } from './brands'
import { CREATOR_STATUS_LABEL, formatCount, PLATFORM_LABEL, RATE_LABEL, type DeliverableType } from './creators'

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
  creators: 'the creator', creator_platforms: 'platform', creator_rate_cards: 'rate', creator_tags: 'niche',
  creator_payment_details: 'payment details', shortlist_creators: 'shortlist entry',
}
/** Records described as "the X" (no name needed). */
const SELF = new Set(['brands', 'retainers', 'creators', 'creator_payment_details'])
const FIELD: Record<string, string> = {
  name: 'name', billing_name: 'billing name', industry: 'industry', website: 'website', instagram_handle: 'Instagram',
  youtube_handle: 'YouTube', engagement_type: 'engagement type', status: 'status', source: 'lead source', owner_id: 'owner',
  city: 'city', state: 'state', state_code: 'GST state', gstin: 'GSTIN', pan: 'PAN', billing_address: 'billing address',
  payment_terms_days: 'payment terms', notes: 'notes', logo_path: 'logo',
  designation: 'designation', phone: 'phone', whatsapp: 'WhatsApp', email: 'email', is_primary: 'primary contact', is_billing: 'billing contact',
  monthly_fee: 'monthly fee', start_date: 'start date', billing_day: 'billing day', renewal_date: 'renewal date', scope: 'scope of work',
  title: 'title', kind: 'file type', file_name: 'file name',
  gender: 'gender', languages: 'languages', manager_name: 'manager', manager_agency: 'agency', manager_phone: 'manager phone',
  manager_email: 'manager email', rating: 'rating', would_work_again: '“would work again”', is_blacklisted: 'blacklist',
  blacklist_reason: 'blacklist reason', photo_path: 'photo', handle: 'handle', platform: 'platform', url: 'profile URL',
  followers: 'followers', avg_views: 'average views', engagement_rate: 'engagement rate', metrics_updated_on: 'stats date',
  rate: 'rate', valid_to: 'end date', note: 'note',
  legal_name: 'legal name', upi_id: 'UPI ID', bank_name: 'bank', bank_account_name: 'account holder', bank_account_number: 'account number',
  ifsc: 'IFSC', tds_section: 'TDS section', tds_rate: 'TDS rate',
}
const COUNTS = new Set(['followers', 'avg_views'])
const MONEY = new Set(['monthly_fee', 'rate'])
const DATES = new Set(['start_date', 'renewal_date', 'end_date'])

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'blank'
  if (MONEY.has(field)) return formatINR(Number(v))
  if (DATES.has(field)) return formatDate(String(v))
  if (COUNTS.has(field)) return formatCount(Number(v))
  if (field === 'engagement_rate') return `${v}%`
  if (field === 'rating') return `${v}★`
  if (field === 'languages' && Array.isArray(v)) return v.join(', ') || 'none'
  if (field === 'status' && typeof v === 'string' && v in BRAND_STATUS) return BRAND_STATUS[v as BrandStatus]
  if (field === 'status' && typeof v === 'string' && v in CREATOR_STATUS_LABEL) return CREATOR_STATUS_LABEL[v]
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
const QUIET = new Set(['updated_at', 'archived_at', 'created_at', 'created_by', 'id', 'state_code', 'import_batch_id', 'phone_key'])

export function describeActivity(e: ActivityEntry, names: Record<string, string> = {}, ownerNames: Record<string, string> = {}): { text: string; kind: ActivityKind } {
  const noun = NOUN[e.table_name] ?? e.table_name.replace(/_/g, ' ')
  const t = titleOf(e, names)
  const thing = SELF.has(e.table_name) ? noun : `${noun}${t ? ` “${t}”` : ''}`
  const special = describeCreatorBits(e, names)
  if (special) return special

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
        if (f === 'is_blacklisted') return e.new_values?.is_blacklisted ? { text: 'blacklisted the creator', kind: 'archive' } : { text: 'removed the creator from the blacklist', kind: 'update' }
        return { text: `changed ${label(f)}${SELF.has(e.table_name) && e.table_name !== 'retainers' ? '' : ` of ${thing}`} from ${from} to ${to}`, kind: MONEY.has(f) ? 'money' : 'update' }
      }
      const list = fields.map(label)
      const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] ?? 'details'
      return { text: `updated ${joined}${e.table_name === 'brands' || e.table_name === 'creators' ? '' : ` on ${thing}`}`, kind: 'update' }
    }
  }
}

/** Creator child records read better with their own phrasing. */
function describeCreatorBits(e: ActivityEntry, names: Record<string, string>): { text: string; kind: ActivityKind } | null {
  const nv = e.new_values ?? {}, ov = e.old_values ?? {}
  switch (e.table_name) {
    case 'creator_payment_details': {
      if (e.action === 'create') return { text: 'added payment details', kind: 'money' }
      const fields = e.changed_fields.filter(f => !QUIET.has(f)).map(label)
      return { text: `updated payment details${fields.length ? ` (${fields.join(', ')})` : ''}`, kind: 'money' }
    }
    case 'creator_tags': {
      const tag = names[String(nv.tag_id ?? ov.tag_id)] ?? 'a niche'
      return e.action === 'delete' ? { text: `removed niche ${tag}`, kind: 'update' } : { text: `added niche ${tag}`, kind: 'update' }
    }
    case 'creator_rate_cards': {
      const type = RATE_LABEL[(nv.deliverable_type ?? ov.deliverable_type) as DeliverableType] ?? names[e.record_id] ?? 'a'
      if (e.action === 'create') return { text: `set the ${type} rate to ${formatINR(Number(nv.rate))}`, kind: 'money' }
      if (e.action === 'archive') return { text: `cleared the ${type} rate`, kind: 'money' }
      if (e.changed_fields.includes('rate')) return { text: `changed the ${type} rate from ${formatINR(Number(ov.rate))} to ${formatINR(Number(nv.rate))}`, kind: 'money' }
      if (e.changed_fields.includes('valid_to')) return { text: '', kind: 'update' }   // old price closed — the new price entry says it all
      return null
    }
    case 'creator_platforms': {
      const who = nv.platform ? `${PLATFORM_LABEL[String(nv.platform)] ?? nv.platform} @${nv.handle}` : names[e.record_id] ?? 'a platform'
      if (e.action === 'create') return { text: `added ${who}`, kind: 'create' }
      if (e.action === 'archive') return { text: `removed ${who}`, kind: 'archive' }
      const stats = e.changed_fields.filter(f => COUNTS.has(f) || f === 'engagement_rate')
      if (stats.length) return { text: `updated ${who} stats: ${stats.map(f => `${label(f)} ${show(f, ov[f])} → ${show(f, nv[f])}`).join(', ')}`, kind: 'update' }
      return null
    }
    case 'shortlist_creators': {
      const list = names[String(nv.shortlist_id ?? ov.shortlist_id)] ?? (nv.name as string | undefined)
      if (e.action === 'create') return { text: `added to shortlist${list ? ` “${list}”` : ''}`, kind: 'create' }
      if (e.action === 'archive') return { text: 'removed from a shortlist', kind: 'archive' }
      if (e.changed_fields.includes('status')) return { text: `marked as ${String(nv.status).replace(/_/g, ' ')} on a shortlist`, kind: 'status' }
      return null
    }
  }
  return null
}
