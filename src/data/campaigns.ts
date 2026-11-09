// Campaigns data access: Supabase when configured, otherwise the in-memory
// preview copy of the sample campaigns (local design preview only).
import { supabase } from '../lib/supabase'
import type { ActivityEntry } from '../lib/activity'
import type { Approval, CampaignKind, CampaignStatus, CreatorStatus, Objective } from '../lib/campaigns'
import { safeFileName } from '../lib/brands'
import { creatorsApi, type CreatorOverview } from './creators'
import { campaignsPreview as pv } from './campaignsPreview'

export interface CampaignSummary {
  campaign_id: string; brand_id: string; brand_name: string; brand_logo_path: string | null
  name: string; code: string | null; kind: CampaignKind; objective: Objective | null; status: CampaignStatus; platforms: string[]
  start_date: string | null; end_date: string | null; owner_id: string | null; owner_name: string | null
  is_archived: boolean; updated_at: string; created_at: string; completed_at: string | null
  client_budget: number | null; planned_creator_spend: number | null; planned_production_spend: number | null; expected_margin: number | null
  creators: number; confirmed_creators: number; actual_creator_spend: number | null
  client_billing: number; received: number; creator_payouts: number; production_expenses: number; profit: number | null
  deliverables: number; posted: number; overdue: number; approved: number
  views: number | null; reach: number | null; engagements: number | null; likes: number | null; comments: number | null
  shares: number | null; saves: number | null; link_clicks: number | null; conversions: number | null
  engagement_rate: number | null; cost_per_view: number | null; client_cost_per_view: number | null
}
export interface CampaignRecord {
  id: string; brand_id: string; name: string; code: string | null; kind: CampaignKind; objective: Objective | null
  platforms: string[]; start_date: string | null; end_date: string | null; status: CampaignStatus; owner_id: string | null
  brief: string | null; key_messages: string | null; dos: string | null; donts: string | null; hashtags: string[]; links: string[]
}
export type CampaignInput = Omit<CampaignRecord, 'id' | 'brief' | 'key_messages' | 'dos' | 'donts' | 'hashtags' | 'links'>
export type BriefInput = Pick<CampaignRecord, 'brief' | 'key_messages' | 'dos' | 'donts' | 'hashtags' | 'links'>
export interface Finances { contract_value: number | null; creator_budget: number | null; production_budget: number | null; po_number: string | null }
export interface PromoCode { id: string; code: string; offer: string | null; campaign_creator_id: string | null }
export interface CampaignCreator {
  id: string; creator_id: string; status: CreatorStatus; notes: string | null
  agreed_fee: number | null; client_price: number | null; creator: CreatorOverview | null
}
export interface DeliverableRow {
  deliverable_id: string; campaign_id: string; campaign_creator_id: string | null; creator_id: string | null; title: string
  deliverable_type: string; platform: string | null; stage: string; approval_status: Approval; draft_url: string | null; live_url: string | null
  go_live_date: string | null; due_date: string | null; went_live_at: string | null; creator_name: string | null; creator_photo_path: string | null
  is_posted: boolean; is_overdue: boolean; days_overdue: number
  metrics_on: string | null; views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null
  saves: number | null; link_clicks: number | null; conversions: number | null; engagements: number; engagement_rate: number | null
  cost: number | null; cost_per_view: number | null
}
export type DeliverablePatch = Partial<Pick<DeliverableRow, 'draft_url' | 'approval_status' | 'live_url' | 'go_live_date' | 'stage' | 'title'>>
export interface MetricsInput { captured_on: string; views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; link_clicks: number | null; conversions: number | null }
export interface CampaignFile { id: string; file_name: string; kind: string; mime_type: string | null; size_bytes: number | null; storage_path: string; created_at: string; is_archived: boolean }

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}
const BUCKET = 'records'

export const campaignsApi = {
  async list(archived = false): Promise<CampaignSummary[]> {
    if (!supabase) return pv.list(archived)
    return must(await supabase.from('campaign_summary').select('*').eq('is_archived', archived).order('start_date', { ascending: false, nullsFirst: false })) as CampaignSummary[]
  },
  async summary(id: string): Promise<CampaignSummary | null> {
    if (!supabase) return pv.summary(id)
    return must(await supabase.from('campaign_summary').select('*').eq('campaign_id', id).maybeSingle()) as CampaignSummary | null
  },
  async record(id: string): Promise<{ campaign: CampaignRecord; finances: Finances | null } | null> {
    if (!supabase) return pv.record(id)
    const campaign = must(await supabase.from('campaigns').select('id, brand_id, name, code, kind, objective, platforms, start_date, end_date, status, owner_id, brief, key_messages, dos, donts, hashtags, links').eq('id', id).maybeSingle()) as CampaignRecord | null
    if (!campaign) return null
    const finances = must(await supabase.from('campaign_finances').select('contract_value, creator_budget, production_budget, po_number').eq('campaign_id', id).maybeSingle()) as Finances | null
    return { campaign, finances }
  },
  async save(input: CampaignInput, finances: Finances | null, id?: string): Promise<string> {
    if (!supabase) return pv.save(input, finances, id)
    let cid = id
    if (id) must(await supabase.from('campaigns').update(input).eq('id', id))
    else cid = (must(await supabase.from('campaigns').insert(input).select('id').single()) as { id: string }).id
    if (finances) must(await supabase.from('campaign_finances').upsert({ ...finances, campaign_id: cid }, { onConflict: 'campaign_id' }))
    return cid!
  },
  async setStatus(id: string, status: CampaignStatus) {
    if (!supabase) return pv.patch(id, { status })
    must(await supabase.from('campaigns').update({ status }).eq('id', id))
  },
  async setArchived(id: string, archived: boolean) {
    if (!supabase) return pv.patch(id, { is_archived: archived } as never)
    must(await supabase.from('campaigns').update({ is_archived: archived }).eq('id', id))
  },
  async saveBrief(id: string, brief: BriefInput) {
    if (!supabase) return pv.patch(id, brief)
    must(await supabase.from('campaigns').update(brief).eq('id', id))
  },

  // ── promo codes ──
  async promoCodes(id: string): Promise<PromoCode[]> {
    if (!supabase) return pv.promoCodes(id)
    return must(await supabase.from('campaign_promo_codes').select('id, code, offer, campaign_creator_id').eq('campaign_id', id).eq('is_archived', false).order('code')) as PromoCode[]
  },
  async addPromo(campaignId: string, code: string, offer: string | null, campaignCreatorId: string | null) {
    if (!supabase) return pv.addPromo(campaignId, code, offer, campaignCreatorId)
    must(await supabase.from('campaign_promo_codes').insert({ campaign_id: campaignId, code: code.trim().toUpperCase(), offer, campaign_creator_id: campaignCreatorId }))
  },
  async archivePromo(id: string) {
    if (!supabase) return pv.archivePromo(id)
    must(await supabase.from('campaign_promo_codes').update({ is_archived: true }).eq('id', id))
  },

  // ── creators in the campaign ──
  async creators(campaignId: string): Promise<CampaignCreator[]> {
    if (!supabase) return pv.creators(campaignId)
    const rows = must(await supabase.from('campaign_creators').select('id, creator_id, status, notes').eq('campaign_id', campaignId).eq('is_archived', false).order('created_at')) as
      Omit<CampaignCreator, 'agreed_fee' | 'client_price' | 'creator'>[]
    if (!rows.length) return []
    const fees = must(await supabase.from('campaign_creator_fees').select('campaign_creator_id, agreed_fee, client_price').in('campaign_creator_id', rows.map(r => r.id))) as
      { campaign_creator_id: string; agreed_fee: number | null; client_price: number | null }[]
    const people = await creatorsApi.byIds(rows.map(r => r.creator_id))
    return rows.map(r => ({ ...r, agreed_fee: fees.find(f => f.campaign_creator_id === r.id)?.agreed_fee ?? null,
      client_price: fees.find(f => f.campaign_creator_id === r.id)?.client_price ?? null, creator: people.find(p => p.id === r.creator_id) ?? null }))
  },
  async addCreators(campaignId: string, creatorIds: string[]) {
    if (!supabase) return pv.addCreators(campaignId, creatorIds)
    must(await supabase.from('campaign_creators').upsert(creatorIds.map(creator_id => ({ campaign_id: campaignId, creator_id, status: 'shortlisted' })),
      { onConflict: 'campaign_id,creator_id', ignoreDuplicates: true }))
  },
  async addShortlist(shortlistId: string, campaignId: string): Promise<number> {
    if (!supabase) return pv.addShortlist(shortlistId, campaignId)
    return must(await supabase.rpc('add_shortlist_to_campaign', { p_shortlist: shortlistId, p_campaign: campaignId })) as number
  },
  async setCreatorStatus(id: string, status: CreatorStatus) {
    if (!supabase) return pv.setCreator(id, { status })
    must(await supabase.from('campaign_creators').update({ status }).eq('id', id))
  },
  async setFee(campaignCreatorId: string, agreed_fee: number | null) {
    if (!supabase) return pv.setCreator(campaignCreatorId, { agreed_fee })
    must(await supabase.from('campaign_creator_fees').upsert({ campaign_creator_id: campaignCreatorId, agreed_fee }, { onConflict: 'campaign_creator_id' }))
  },
  async setQuantity(campaignCreatorId: string, type: string, quantity: number) {
    if (!supabase) return pv.setQuantity(campaignCreatorId, type, quantity)
    must(await supabase.rpc('set_creator_deliverables', { p_campaign_creator: campaignCreatorId, p_type: type, p_quantity: quantity }))
  },

  // ── deliverables & performance ──
  async deliverables(campaignId: string): Promise<DeliverableRow[]> {
    if (!supabase) return pv.deliverables(campaignId)
    return must(await supabase.from('deliverable_performance').select('*').eq('campaign_id', campaignId)
      .order('go_live_date', { ascending: true, nullsFirst: false })) as DeliverableRow[]
  },
  async updateDeliverable(id: string, patch: DeliverablePatch) {
    if (!supabase) return pv.updateDeliverable(id, patch)
    must(await supabase.from('deliverables').update(patch).eq('id', id))
  },
  async saveMetrics(deliverableId: string, m: MetricsInput) {
    if (!supabase) return pv.saveMetrics(deliverableId, m)
    must(await supabase.from('deliverable_metrics').upsert({ ...m, deliverable_id: deliverableId }, { onConflict: 'deliverable_id,captured_on' }))
  },

  // ── files (records bucket, campaigns/<id>/) ──
  async files(campaignId: string): Promise<CampaignFile[]> {
    if (!supabase) return pv.files(campaignId)
    return must(await supabase.from('files').select('id, file_name, kind, mime_type, size_bytes, storage_path, created_at, is_archived')
      .eq('campaign_id', campaignId).eq('is_archived', false).order('created_at', { ascending: false })) as CampaignFile[]
  },
  async uploadFile(campaignId: string, file: File, kind: string) {
    if (!supabase) return pv.uploadFile(campaignId, file, kind)
    const path = `campaigns/${campaignId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
    must(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined }))
    const { error } = await supabase.from('files').insert({ bucket: BUCKET, storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, kind, campaign_id: campaignId })
    if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(error.message) }
  },
  async archiveFile(id: string) {
    if (!supabase) return pv.archiveFile(id)
    must(await supabase.from('files').update({ is_archived: true }).eq('id', id))
  },
  async signedUrl(path: string, download?: string) {
    if (path.startsWith('preview:')) return path.slice(8)
    if (!supabase) return null
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600, download ? { download } : undefined)
    return data?.signedUrl ?? null
  },

  async activity(campaignId: string): Promise<ActivityEntry[]> {
    if (!supabase) return pv.activity(campaignId)
    return must(await supabase.rpc('campaign_activity', { p_campaign: campaignId })) as ActivityEntry[]
  },
}
