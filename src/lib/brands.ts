// Brand vocabulary + small rules shared by the list, form, detail and pipeline.
import type { Tone } from '../components/ui/kit'
import { formatDate } from './format'

export type BrandStatus = 'lead' | 'pitching' | 'active' | 'paused' | 'ended'
export type EngagementType = 'production' | 'campaign_management' | 'full_marketing' | 'mixed'

export const BRAND_STATUSES: BrandStatus[] = ['lead', 'pitching', 'active', 'paused', 'ended']
export const STATUS_LABEL: Record<BrandStatus, string> = {
  lead: 'Lead', pitching: 'Pitching', active: 'Active', paused: 'Paused', ended: 'Ended',
}
export const STATUS_TONE: Record<BrandStatus, Tone> = {
  lead: 'quiet', pitching: 'warm', active: 'accent', paused: 'quiet', ended: 'quiet',
}

export const ENGAGEMENTS: EngagementType[] = ['production', 'campaign_management', 'full_marketing', 'mixed']
export const ENGAGEMENT_LABEL: Record<EngagementType, string> = {
  production: 'Production only', campaign_management: 'Campaign management',
  full_marketing: 'Full marketing (retainer)', mixed: 'Mixed',
}
export const ENGAGEMENT_SHORT: Record<EngagementType, string> = {
  production: 'Production', campaign_management: 'Campaigns', full_marketing: 'Retainer', mixed: 'Mixed',
}
/** Engagements that come with a monthly retainer. */
export const hasRetainer = (e: EngagementType) => e === 'full_marketing' || e === 'mixed'

export const LEAD_SOURCES = ['Referral', 'Instagram', 'LinkedIn', 'Cold outreach', 'Inbound email', 'Website', 'Event', 'Existing client', 'Other']
export const INDUSTRIES = ['Beauty & skincare', 'Fashion', 'Food', 'Beverages', 'Health & fitness', 'Fintech', 'Edtech', 'Travel', 'Home & appliances', 'Tech & gadgets', 'Kids', 'Jewellery', 'Real estate', 'Automotive', 'Other']

export const FILE_KINDS = [
  { value: 'contract', label: 'Contract' }, { value: 'brand_guidelines', label: 'Brand guidelines' },
  { value: 'logo', label: 'Logo / brand asset' }, { value: 'brief', label: 'Brief' },
  { value: 'media_kit', label: 'Deck / media kit' }, { value: 'other', label: 'Other' },
] as const
export type BrandFileKind = (typeof FILE_KINDS)[number]['value']

// GST state codes (place of supply). Code comes from the first two GSTIN digits.
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
/** null when fine (or empty), otherwise what's wrong. Includes the checksum digit. */
export function gstinProblem(raw: string): string | null {
  const g = raw.trim().toUpperCase()
  if (!g) return null
  if (g.length !== 15) return 'A GSTIN has 15 characters.'
  if (!GSTIN_RE.test(g)) return 'That doesn’t look like a GSTIN (e.g. 27AAACC1234D1Z5).'
  if (!GST_STATES[g.slice(0, 2)]) return 'The first two digits aren’t a valid state code.'
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1)
    sum += Math.floor(p / 36) + (p % 36)
  }
  if (GSTIN_CHARS[(36 - (sum % 36)) % 36] !== g[14]) return 'The last character doesn’t match — check for a typo.'
  return null
}
export const stateFromGstin = (g: string) => {
  const code = g.trim().slice(0, 2)
  return GST_STATES[code] ? { code, name: GST_STATES[code] } : null
}

/** "chaisutra.com" → "https://chaisutra.com"; blank stays blank. */
export function normalizeWebsite(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}
/** "@chai.sutra", "instagram.com/chai.sutra/" → "chai.sutra" */
export function normalizeHandle(raw: string): string | null {
  let v = raw.trim()
  if (!v) return null
  v = v.replace(/^https?:\/\/(www\.)?(instagram\.com|youtube\.com)\//i, '').replace(/^@/, '').replace(/\/+$/, '')
  return v.split(/[/?#]/)[0] || null
}
export const instagramUrl = (h: string) => `https://instagram.com/${h}`
export const youtubeUrl = (h: string) => h.startsWith('@') || h.startsWith('UC') ? `https://youtube.com/${h.startsWith('UC') ? 'channel/' + h : h}` : `https://youtube.com/@${h}`

/** The renewal warning text, or null when there's nothing to warn about (more than 15 days away). */
export function renewalNotice(renewalDate: string | null | undefined, daysToRenewal: number | null | undefined) {
  if (!renewalDate || daysToRenewal == null || daysToRenewal > 15) return null
  if (daysToRenewal < 0) return { urgent: true, text: `Retainer renewal was due ${formatDate(renewalDate)} (${-daysToRenewal} day${daysToRenewal === -1 ? '' : 's'} ago)` }
  if (daysToRenewal === 0) return { urgent: true, text: 'Retainer renews today' }
  return { urgent: true, text: `Retainer renews in ${daysToRenewal} day${daysToRenewal === 1 ? '' : 's'} · ${formatDate(renewalDate)}` }
}

export function safeFileName(name: string) {
  const dot = name.lastIndexOf('.')
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(0, 60)
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : ''
  return (base || 'file') + (ext ? `.${ext}` : '')
}

export function formatBytes(n: number | null | undefined) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}
