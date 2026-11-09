// Campaign vocabulary + calculations shared by list, detail and report.
import type { Tone } from '../components/ui/kit'
import { RATE_LABEL, type DeliverableType } from './creators'

export type CampaignStatus = 'planning' | 'creator_outreach' | 'production' | 'content_review' | 'live' | 'reporting' | 'completed' | 'cancelled'
export const CAMPAIGN_STATUSES: CampaignStatus[] = ['planning', 'creator_outreach', 'production', 'content_review', 'live', 'reporting', 'completed', 'cancelled']
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  planning: 'Planning', creator_outreach: 'Creator outreach', production: 'Shoot / production', content_review: 'Content review',
  live: 'Live', reporting: 'Reporting', completed: 'Completed', cancelled: 'Cancelled',
}
export const CAMPAIGN_STATUS_KANJI: Record<CampaignStatus, string> = {
  planning: '計', creator_outreach: '声', production: '撮', content_review: '査', live: '公', reporting: '報', completed: '完', cancelled: '止',
}
export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, Tone> = {
  planning: 'quiet', creator_outreach: 'quiet', production: 'warm', content_review: 'warm', live: 'accent', reporting: 'accent', completed: 'ink', cancelled: 'quiet',
}
export const ACTIVE_STATUSES: CampaignStatus[] = ['creator_outreach', 'production', 'content_review', 'live', 'reporting']

export type CampaignKind = 'influencer' | 'production' | 'full_marketing_month' | 'ugc'
export const CAMPAIGN_KINDS: CampaignKind[] = ['influencer', 'production', 'full_marketing_month', 'ugc']
export const KIND_LABEL: Record<CampaignKind, string> = {
  influencer: 'Influencer campaign', production: 'Production only', full_marketing_month: 'Full marketing month', ugc: 'UGC',
}
export type Objective = 'awareness' | 'sales' | 'app_installs' | 'footfall'
export const OBJECTIVES: Objective[] = ['awareness', 'sales', 'app_installs', 'footfall']
export const OBJECTIVE_LABEL: Record<Objective, string> = { awareness: 'Awareness', sales: 'Sales', app_installs: 'App installs', footfall: 'Footfall' }

export type CreatorStatus = 'shortlisted' | 'contacted' | 'negotiating' | 'confirmed' | 'content_submitted' | 'approved' | 'posted' | 'paid' | 'dropped'
export const CREATOR_STATUSES: CreatorStatus[] = ['shortlisted', 'contacted', 'negotiating', 'confirmed', 'content_submitted', 'approved', 'posted', 'paid', 'dropped']
export const CREATOR_STATUS_LABEL: Record<CreatorStatus, string> = {
  shortlisted: 'Shortlisted', contacted: 'Contacted', negotiating: 'Negotiating', confirmed: 'Confirmed', content_submitted: 'Content submitted',
  approved: 'Approved', posted: 'Posted', paid: 'Paid', dropped: 'Dropped',
}
/** Same as public.creator_status_confirmed(): counts toward actual creator spend. */
export const isConfirmed = (s: string) => ['confirmed', 'content_submitted', 'approved', 'posted', 'paid'].includes(s)

export type Approval = 'not_submitted' | 'pending' | 'approved' | 'changes_requested' | 'rejected'
export const APPROVALS: Approval[] = ['not_submitted', 'pending', 'approved', 'changes_requested', 'rejected']
export const APPROVAL_LABEL: Record<Approval, string> = {
  not_submitted: 'Not sent', pending: 'With brand', approved: 'Approved', changes_requested: 'Changes asked', rejected: 'Rejected',
}

const PLURAL: Partial<Record<DeliverableType, string>> = { story: 'Stories', short: 'Shorts', youtube_video: 'YouTube videos', ugc_video: 'UGC videos', live: 'Lives' }
/** {reel: 2, story: 3} → "2 Reels + 3 Stories" */
export function deliverableSummary(counts: Partial<Record<string, number>>): string {
  const parts = Object.entries(counts).filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => Object.keys(RATE_LABEL).indexOf(a[0]) - Object.keys(RATE_LABEL).indexOf(b[0]))
    .map(([t, n]) => `${n} ${n === 1 ? (RATE_LABEL[t as DeliverableType] ?? t) : (PLURAL[t as DeliverableType] ?? `${RATE_LABEL[t as DeliverableType] ?? t}s`)}`)
  return parts.length ? parts.join(' + ') : 'No deliverables yet'
}

export interface Metrics { views?: number | null; reach?: number | null; likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null }
export const engagements = (m: Metrics) => (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0)
/** Same as the database: engagements ÷ views (reach if no views) × 100, 2 decimals. */
export function engagementRate(m: Metrics): number | null {
  const base = m.views || m.reach || 0
  return base > 0 ? Math.round(engagements(m) / base * 10000) / 100 : null
}
export function costPerView(cost: number | null | undefined, views: number | null | undefined): number | null {
  return cost != null && views ? Math.round(cost / views * 10000) / 10000 : null
}
/** ₹0.29 / ₹1.40 — CPV is usually below a rupee, so always show paise. */
export const formatCPV = (v: number | null | undefined) => v == null ? '—' : `₹${Number(v).toFixed(2)}`

export function isOverdue(goLive: string | null, stage: string, today: string) {
  return Boolean(goLive && goLive < today && stage !== 'live' && stage !== 'cancelled')
}
