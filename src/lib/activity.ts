// Turns activity_log rows into short sentences for the Activity tab.
import { formatDate, formatINR } from './format'
import { ENGAGEMENT_LABEL, STATUS_LABEL as BRAND_STATUS, type BrandStatus, type EngagementType } from './brands'
import { CREATOR_STATUS_LABEL, formatCount, PLATFORM_LABEL, RATE_LABEL, type DeliverableType } from './creators'
import { STAGE_LABEL, ROLE_LABEL, type Stage, type PersonRole } from './production'
import { APPROVAL_LABEL, CAMPAIGN_STATUS_LABEL, CREATOR_STATUS_LABEL as CC_STATUS_LABEL, KIND_LABEL, OBJECTIVE_LABEL, type Approval, type CampaignKind, type CampaignStatus, type CreatorStatus, type Objective } from './campaigns'

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
  campaign_finances: 'the budget', campaign_promo_codes: 'promo code', deliverables: 'deliverable', deliverable_metrics: 'performance',
}
/** Records described as "the X" (no name needed). */
const SELF = new Set(['brands', 'retainers', 'creators', 'creator_payment_details', 'campaign_finances'])
const FIELD: Record<string, string> = {
  name: 'name', billing_name: 'billing name', industry: 'industry', website: 'website', instagram_handle: 'Instagram',
  youtube_handle: 'YouTube', engagement_type: 'engagement type', status: 'status', source: 'lead source', owner_id: 'owner',
  city: 'city', state: 'state', state_code: 'GST state', gstin: 'GSTIN', pan: 'PAN', billing_address: 'billing address',
  payment_terms_days: 'payment terms', notes: 'notes', logo_path: 'logo',
  designation: 'designation', phone: 'phone', whatsapp: 'WhatsApp', email: 'email', is_primary: 'primary contact', is_billing: 'billing contact',
  monthly_fee: 'monthly fee', start_date: 'start date', billing_day: 'billing day', renewal_date: 'renewal date', scope: 'scope of work',
  title: 'title', kind: 'type', file_name: 'file name',
  gender: 'gender', languages: 'languages', manager_name: 'manager', manager_agency: 'agency', manager_phone: 'manager phone',
  manager_email: 'manager email', rating: 'rating', would_work_again: '“would work again”', is_blacklisted: 'blacklist',
  blacklist_reason: 'blacklist reason', photo_path: 'photo', handle: 'handle', platform: 'platform', url: 'profile URL',
  followers: 'followers', avg_views: 'average views', engagement_rate: 'engagement rate', metrics_updated_on: 'stats date',
  rate: 'rate', valid_to: 'end date', note: 'note',
  objective: 'objective', platforms: 'platforms', end_date: 'end date', code: 'code',
  brief: 'brief', key_messages: 'key messages', dos: 'do’s', donts: 'don’ts', hashtags: 'hashtags', links: 'links',
  contract_value: 'client budget', creator_budget: 'planned creator spend', production_budget: 'planned production spend', po_number: 'PO number',
  draft_url: 'draft link', live_url: 'live link', go_live_date: 'go-live date', approval_status: 'brand approval', stage: 'stage', agreed_fee: 'fee',
  legal_name: 'legal name', upi_id: 'UPI ID', bank_name: 'bank', bank_account_name: 'account holder', bank_account_number: 'account number',
  ifsc: 'IFSC', tds_section: 'TDS section', tds_rate: 'TDS rate',
}
const COUNTS = new Set(['followers', 'avg_views'])
const MONEY = new Set(['monthly_fee', 'rate', 'contract_value', 'creator_budget', 'production_budget', 'agreed_fee'])
const DATES = new Set(['start_date', 'renewal_date', 'end_date', 'go_live_date'])

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
  if (field === 'status' && typeof v === 'string' && v in CAMPAIGN_STATUS_LABEL) return CAMPAIGN_STATUS_LABEL[v as CampaignStatus]
  if (field === 'status' && typeof v === 'string' && v in CC_STATUS_LABEL) return CC_STATUS_LABEL[v as CreatorStatus]
  if (field === 'approval_status') return APPROVAL_LABEL[v as Approval] ?? String(v)
  if (field === 'kind' && typeof v === 'string' && v in KIND_LABEL) return KIND_LABEL[v as CampaignKind]
  if (field === 'objective') return OBJECTIVE_LABEL[v as Objective] ?? String(v)
  if (field === 'stage') return STAGE_LABEL[v as Stage] ?? String(v).replace(/_/g, ' ')
  if (Array.isArray(v)) return v.join(', ') || 'none'
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
  const special = describeCreatorBits(e, names) ?? describeCampaignBits(e, names)
  if (special) return special

  switch (e.action) {
    case 'create':
      if (e.table_name === 'brands') return { text: 'added the brand', kind: 'create' }
      if (e.table_name === 'campaigns') return { text: 'created the campaign', kind: 'create' }
      if (e.table_name === 'retainers') return { text: `set up the retainer at ${formatINR(Number(e.new_values?.monthly_fee))}/month`, kind: 'money' }
      if (e.table_name === 'files') return { text: `uploaded ${thing}`, kind: 'create' }
      return { text: `added ${thing}`, kind: 'create' }
    case 'archive': return { text: e.table_name === 'files' ? `removed ${thing}` : `archived ${thing}`, kind: 'archive' }
    case 'restore': return { text: `restored ${thing}`, kind: 'create' }
    case 'delete': return { text: `deleted ${thing}`, kind: 'archive' }
    case 'status_change': {
      const f = e.changed_fields.includes('status') ? 'status' : 'stage'
      const verb = e.table_name === 'brands' ? 'moved the brand' : e.table_name === 'campaigns' ? 'moved the campaign' : `moved ${thing}`
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
        const of = SELF.has(e.table_name) || e.table_name === 'campaigns' ? '' : ` of ${thing}`
        if (e.table_name === 'campaign_finances') return { text: `changed the ${label(f)} from ${from} to ${to}`, kind: 'money' }
        return { text: `changed ${label(f)}${e.table_name === 'retainers' ? ` of ${noun}` : of} from ${from} to ${to}`, kind: MONEY.has(f) ? 'money' : 'update' }
      }
      const list = fields.map(label)
      const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] ?? 'details'
      return { text: `updated ${joined}${['brands', 'creators', 'campaigns'].includes(e.table_name) ? '' : ` on ${thing}`}`, kind: 'update' }
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

/** Campaign child records: name the creator / post involved. names[] maps ids → names. */
function describeCampaignBits(e: ActivityEntry, names: Record<string, string>): { text: string; kind: ActivityKind } | null {
  const nv = e.new_values ?? {}, ov = e.old_values ?? {}
  switch (e.table_name) {
    case 'campaign_creators': {
      const who = names[e.record_id] ?? names[String(nv.creator_id ?? ov.creator_id)] ?? 'a creator'
      if (e.action === 'create') return { text: `added ${who} to the campaign`, kind: 'create' }
      if (e.changed_fields.includes('status')) return { text: `moved ${who} from ${CC_STATUS_LABEL[ov.status as CreatorStatus] ?? ov.status} to ${CC_STATUS_LABEL[nv.status as CreatorStatus] ?? nv.status}`, kind: 'status' }
      return null
    }
    case 'campaign_creator_fees': {
      const who = names[String(nv.campaign_creator_id ?? ov.campaign_creator_id)] ?? names[e.record_id] ?? 'a creator'
      if (e.action === 'create' || ov.agreed_fee == null) return { text: `set ${who}’s fee to ${formatINR(Number(nv.agreed_fee))}`, kind: 'money' }
      if (e.changed_fields.includes('agreed_fee')) return { text: `changed ${who}’s fee from ${formatINR(Number(ov.agreed_fee))} to ${formatINR(Number(nv.agreed_fee))}`, kind: 'money' }
      return null
    }
    case 'deliverables': {
      const what = (nv.title ?? names[e.record_id] ?? 'a deliverable') as string
      if (e.action === 'create') return { text: `planned “${what}”`, kind: 'create' }
      if (e.changed_fields.includes('stage') && nv.stage === 'live') return { text: `marked “${what}” as posted`, kind: 'status' }
      if (e.changed_fields.includes('stage') && nv.stage === 'cancelled') return { text: `cancelled “${what}”`, kind: 'archive' }
      if (e.changed_fields.includes('stage')) return { text: `moved “${what}” from ${STAGE_LABEL[ov.stage as Stage] ?? ov.stage} to ${STAGE_LABEL[nv.stage as Stage] ?? nv.stage}`, kind: 'status' }
      if (e.changed_fields.includes('approval_status')) return { text: `set brand approval on “${what}” to ${APPROVAL_LABEL[nv.approval_status as Approval] ?? nv.approval_status}`, kind: nv.approval_status === 'approved' ? 'status' : 'update' }
      const fields = e.changed_fields.filter(f => !['stage', 'updated_at', 'went_live_at', 'approved_at'].includes(f)).map(label)
      return fields.length ? { text: `updated ${fields.join(', ')} on “${what}”`, kind: 'update' } : { text: '', kind: 'update' }
    }
    case 'deliverable_metrics': {
      const what = names[String(nv.deliverable_id ?? ov.deliverable_id)] ?? 'a post'
      return { text: `entered performance for “${what}”${nv.views != null ? ` (${formatCount(Number(nv.views))} views)` : ''}`, kind: 'update' }
    }
    case 'production_people': return e.action === 'delete' ? { text: `removed a ${ROLE_LABEL[ov.role as PersonRole]?.toLowerCase() ?? 'person'}`, kind: 'archive' }
      : { text: `added a ${ROLE_LABEL[nv.role as PersonRole]?.toLowerCase() ?? 'person'}`, kind: 'create' }
    case 'scripts': return e.action === 'create' ? { text: `wrote script version ${nv.version}`, kind: 'create' }
      : e.changed_fields.includes('status') ? { text: `marked script v${nv.version ?? ''} as ${String(nv.status).replace('_', ' ')}`.replace('v ', ''), kind: 'status' } : { text: 'edited the script', kind: 'update' }
    case 'edit_versions': return { text: `added edit v${nv.version}`, kind: 'create' }
    case 'script_comments': return { text: nv.from_client ? `logged client feedback${nv.author_name ? ` from ${nv.author_name}` : ''}` : 'commented on the script', kind: 'update' }
    case 'campaign_promo_codes':
      return e.action === 'create' ? { text: `added promo code ${nv.code}`, kind: 'create' } : e.action === 'archive' ? { text: 'removed a promo code', kind: 'archive' } : null
    case 'campaign_finances':
      if (e.action === 'create') return { text: `set the budget: client ${formatINR(Number(nv.contract_value ?? 0))}`, kind: 'money' }
      return null
  }
  return null
}
