// Creators data access: Supabase when configured, otherwise the in-memory
// preview copy of the five sample creators (local design preview only).
import { supabase } from '../lib/supabase'
import type { ActivityEntry } from '../lib/activity'
import type { CreatorFilters, DeliverableType, ImportRow, Tier } from '../lib/creators'
import { creatorsPreview as pv } from './creatorsPreview'

export interface CreatorOverview {
  id: string; created_at: string; updated_at: string; is_archived: boolean; name: string; photo_path: string | null
  gender: string | null; city: string | null; state: string | null; languages: string[]; email: string | null; phone: string | null
  whatsapp: string | null; phone_key: string | null; manager_name: string | null; manager_agency: string | null
  manager_phone: string | null; manager_email: string | null; status: string; rating: number | null
  would_work_again: boolean | null; is_blacklisted: boolean; blacklist_reason: string | null; owner_id: string | null; notes: string | null
  import_batch_id: string | null
  max_followers: number | null; tier: Tier | null; top_platform: string | null; top_handle: string | null
  top_avg_views: number | null; top_engagement_rate: number | null; platforms: string[] | null; handles: string[] | null
  metrics_updated_on: string | null; niches: string[]; niche_ids: string[]
  rate_reel: number | null; rate_story: number | null; rate_post: number | null; rate_youtube_video: number | null
  rate_short: number | null; rate_ugc_video: number | null; rate_live: number | null
  rates_updated_on: string | null; min_rate: number | null; max_rate: number | null
  campaigns_count: number; last_campaign_on: string | null; total_paid: number
}
export interface CreatorInput {
  name: string; gender: string | null; city: string | null; state: string | null; languages: string[]
  phone: string | null; whatsapp: string | null; email: string | null
  manager_name: string | null; manager_agency: string | null; manager_phone: string | null; manager_email: string | null
  status: string; rating: number | null; would_work_again: boolean | null; is_blacklisted: boolean; blacklist_reason: string | null; notes: string | null
}
export interface PlatformRow {
  id: string; creator_id: string; platform: string; handle: string; url: string | null; followers: number | null
  avg_views: number | null; engagement_rate: number | null; metrics_updated_on: string | null; is_primary: boolean
}
export type PlatformInput = Pick<PlatformRow, 'platform' | 'handle' | 'url' | 'followers' | 'avg_views' | 'engagement_rate'> & { metrics_updated_on?: string | null }
export interface RateRow { id: string; deliverable_type: DeliverableType; rate: number; valid_from: string; valid_to: string | null; notes: string | null; is_archived: boolean }
export interface PaymentDetails {
  legal_name: string | null; pan: string | null; upi_id: string | null; bank_name: string | null
  bank_account_name: string | null; bank_account_number: string | null; ifsc: string | null; gstin: string | null
  tds_section: string | null; tds_rate: number | null
}
export interface Niche { id: string; name: string }
export interface Snapshot { creator_platform_id: string; captured_on: string; followers: number | null; avg_views: number | null }
export interface HistoryRow {
  campaign_creator_id: string; campaign_id: string; campaign_name: string; campaign_status: string; creator_status: string
  start_date: string | null; end_date: string | null; brand_id: string; brand_name: string
  agreed_fee: number | null; paid: number; deliverables: number; live: number; total_views: number | null
}
export interface PayoutRow { payout_id: string; campaign_id: string | null; status: string; due_date: string | null; paid_on: string | null; gross: number; tds: number; net_payable: number }
export interface Shortlist { id: string; name: string; notes: string | null; brand_id: string | null; campaign_id: string | null; created_at: string; count: number }
export interface ShortlistEntry { id: string; creator_id: string; status: string; note: string | null; position: number; created_at: string }
export interface SavedView { id: string; name: string; query: CreatorFilters; is_shared: boolean; created_by: string | null }
export interface Duplicate { creator_id: string; creator_name: string; matched_on: 'phone' | 'handle'; value: string }

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

export const creatorsApi = {
  async list(archived = false): Promise<CreatorOverview[]> {
    if (!supabase) return pv.list(archived)
    return must(await supabase.from('creator_overview').select('*').eq('is_archived', archived).order('name')) as CreatorOverview[]
  },
  async get(id: string): Promise<CreatorOverview | null> {
    if (!supabase) return pv.get(id)
    return must(await supabase.from('creator_overview').select('*').eq('id', id).maybeSingle()) as CreatorOverview | null
  },
  async byIds(ids: string[]): Promise<CreatorOverview[]> {
    if (!ids.length) return []
    if (!supabase) return pv.byIds(ids)
    return must(await supabase.from('creator_overview').select('*').in('id', ids)) as CreatorOverview[]
  },
  async save(input: CreatorInput, id?: string): Promise<string> {
    if (!supabase) return pv.save(input, id)
    if (id) { must(await supabase.from('creators').update(input).eq('id', id)); return id }
    return (must(await supabase.from('creators').insert(input).select('id').single()) as { id: string }).id
  },
  async setArchived(id: string, archived: boolean) {
    if (!supabase) return pv.patch(id, { is_archived: archived })
    must(await supabase.from('creators').update({ is_archived: archived }).eq('id', id))
  },
  async uploadPhoto(id: string, file: File) {
    if (!supabase) return pv.patch(id, { photo_path: `preview:${URL.createObjectURL(file)}` })
    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const path = `creators/${id}/photo-${Date.now()}.${ext}`
    must(await supabase.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false }))
    must(await supabase.from('creators').update({ photo_path: path }).eq('id', id))
  },

  // ── niches (editable list) ──
  async niches(): Promise<Niche[]> {
    if (!supabase) return pv.niches()
    return must(await supabase.from('tags').select('id, name').eq('kind', 'niche').eq('is_archived', false).order('name')) as Niche[]
  },
  async addNiche(name: string): Promise<Niche> {
    if (!supabase) return pv.addNiche(name)
    return must(await supabase.from('tags').insert({ kind: 'niche', name: name.trim() }).select('id, name').single()) as Niche
  },
  async renameNiche(id: string, name: string) {
    if (!supabase) return pv.renameNiche(id, name)
    must(await supabase.from('tags').update({ name: name.trim() }).eq('id', id))
  },
  async archiveNiche(id: string) {
    if (!supabase) return pv.archiveNiche(id)
    must(await supabase.from('tags').update({ is_archived: true }).eq('id', id))
  },
  async setNiches(creatorId: string, current: string[], next: string[]) {
    if (!supabase) return pv.setNiches(creatorId, next)
    const add = next.filter(x => !current.includes(x)), remove = current.filter(x => !next.includes(x))
    if (add.length) must(await supabase.from('creator_tags').insert(add.map(tag_id => ({ creator_id: creatorId, tag_id }))))
    if (remove.length) must(await supabase.from('creator_tags').delete().eq('creator_id', creatorId).in('tag_id', remove))
  },

  // ── platforms & stats ──
  async platforms(creatorId: string): Promise<PlatformRow[]> {
    if (!supabase) return pv.platforms(creatorId)
    return must(await supabase.from('creator_platforms').select('id, creator_id, platform, handle, url, followers, avg_views, engagement_rate, metrics_updated_on, is_primary')
      .eq('creator_id', creatorId).eq('is_archived', false).order('followers', { ascending: false, nullsFirst: false })) as PlatformRow[]
  },
  async savePlatform(creatorId: string, input: PlatformInput, id?: string) {
    if (!supabase) return pv.savePlatform(creatorId, input, id)
    if (id) must(await supabase.from('creator_platforms').update(input).eq('id', id))
    else must(await supabase.from('creator_platforms').insert({ ...input, creator_id: creatorId }))
  },
  async archivePlatform(id: string) {
    if (!supabase) return pv.archivePlatform(id)
    must(await supabase.from('creator_platforms').update({ is_archived: true }).eq('id', id))
  },
  async snapshots(platformIds: string[]): Promise<Snapshot[]> {
    if (!platformIds.length) return []
    if (!supabase) return pv.snapshots(platformIds)
    return must(await supabase.from('creator_metric_snapshots').select('creator_platform_id, captured_on, followers, avg_views')
      .in('creator_platform_id', platformIds).order('captured_on')) as Snapshot[]
  },

  // ── rate card ──
  async rates(creatorId: string): Promise<RateRow[]> {
    if (!supabase) return pv.rates(creatorId)
    return must(await supabase.from('creator_rate_cards').select('id, deliverable_type, rate, valid_from, valid_to, notes, is_archived')
      .eq('creator_id', creatorId).eq('is_archived', false).order('valid_from', { ascending: false })) as RateRow[]
  },
  async setRate(creatorId: string, type: DeliverableType, rate: number | null, notes: string | null = null) {
    if (!supabase) return pv.setRate(creatorId, type, rate)
    must(await supabase.rpc('set_creator_rate', { p_creator: creatorId, p_type: type, p_rate: rate, p_notes: notes }))
  },

  // ── payment details (founders only — RLS returns nothing for anyone else) ──
  async payment(creatorId: string): Promise<PaymentDetails | null> {
    if (!supabase) return pv.payment(creatorId)
    return must(await supabase.from('creator_payment_details')
      .select('legal_name, pan, upi_id, bank_name, bank_account_name, bank_account_number, ifsc, gstin, tds_section, tds_rate')
      .eq('creator_id', creatorId).maybeSingle()) as PaymentDetails | null
  },
  async savePayment(creatorId: string, input: PaymentDetails) {
    if (!supabase) return pv.savePayment(creatorId, input)
    must(await supabase.from('creator_payment_details').upsert({ ...input, creator_id: creatorId }, { onConflict: 'creator_id' }))
  },

  // ── linked records ──
  async history(creatorId: string): Promise<HistoryRow[]> {
    if (!supabase) return []
    return must(await supabase.from('creator_campaign_history').select('*').eq('creator_id', creatorId).order('start_date', { ascending: false, nullsFirst: false })) as HistoryRow[]
  },
  async payouts(creatorId: string): Promise<PayoutRow[]> {
    if (!supabase) return []
    return must(await supabase.from('creator_payout_totals').select('payout_id, campaign_id, status, due_date, paid_on, gross, tds, net_payable')
      .eq('creator_id', creatorId).order('due_date', { ascending: false, nullsFirst: false })) as PayoutRow[]
  },
  async activity(creatorId: string): Promise<ActivityEntry[]> {
    if (!supabase) return pv.activity(creatorId)
    return must(await supabase.rpc('creator_activity', { p_creator: creatorId })) as ActivityEntry[]
  },

  // ── import ──
  async duplicates(phones: string[], handles: string[]): Promise<Duplicate[]> {
    if (!supabase) return pv.duplicates(phones, handles)
    return must(await supabase.rpc('creator_duplicates', { p_phones: phones, p_handles: handles })) as Duplicate[]
  },
  async importRows(fileName: string, rows: ImportRow[]): Promise<{ batch_id: string; created: number }> {
    if (!supabase) return pv.importRows(rows)
    const out = must(await supabase.rpc('import_creators', { p_source: 'CSV upload', p_file_name: fileName, p_rows: rows })) as { batch_id: string; created: number }[]
    return out[0]
  },

  // ── shortlists ──
  async shortlists(): Promise<Shortlist[]> {
    if (!supabase) return pv.shortlists()
    const rows = must(await supabase.from('shortlists').select('id, name, notes, brand_id, campaign_id, created_at')
      .eq('is_archived', false).order('created_at', { ascending: false })) as Omit<Shortlist, 'count'>[]
    if (!rows.length) return []
    const entries = must(await supabase.from('shortlist_creators').select('shortlist_id')
      .in('shortlist_id', rows.map(r => r.id)).eq('is_archived', false)) as { shortlist_id: string }[]
    return rows.map(s => ({ ...s, count: entries.filter(e => e.shortlist_id === s.id).length }))
  },
  async createShortlist(name: string, notes: string | null, brandId: string | null): Promise<string> {
    if (!supabase) return pv.createShortlist(name, notes)
    return (must(await supabase.from('shortlists').insert({ name: name.trim(), notes, brand_id: brandId }).select('id').single()) as { id: string }).id
  },
  async addToShortlist(shortlistId: string, creatorIds: string[]) {
    if (!supabase) return pv.addToShortlist(shortlistId, creatorIds)
    must(await supabase.from('shortlist_creators').upsert(creatorIds.map(creator_id => ({ shortlist_id: shortlistId, creator_id })),
      { onConflict: 'shortlist_id,creator_id', ignoreDuplicates: true }))
    // bring back anyone removed earlier
    must(await supabase.from('shortlist_creators').update({ is_archived: false }).eq('shortlist_id', shortlistId).in('creator_id', creatorIds).eq('is_archived', true))
  },
  async shortlistEntries(shortlistId: string): Promise<ShortlistEntry[]> {
    if (!supabase) return pv.entries(shortlistId)
    return must(await supabase.from('shortlist_creators').select('id, creator_id, status, note, position, created_at')
      .eq('shortlist_id', shortlistId).eq('is_archived', false).order('position').order('created_at')) as ShortlistEntry[]
  },
  async updateEntry(id: string, patch: Partial<Pick<ShortlistEntry, 'status' | 'note'>>) {
    if (!supabase) return pv.updateEntry(id, patch)
    must(await supabase.from('shortlist_creators').update(patch).eq('id', id))
  },
  async removeEntry(id: string) {
    if (!supabase) return pv.updateEntry(id, { is_archived: true } as never)
    must(await supabase.from('shortlist_creators').update({ is_archived: true }).eq('id', id))
  },
  async archiveShortlist(id: string) {
    if (!supabase) return pv.archiveShortlist(id)
    must(await supabase.from('shortlists').update({ is_archived: true }).eq('id', id))
  },

  // ── saved filter views ──
  async views(): Promise<SavedView[]> {
    if (!supabase) return pv.views()
    return must(await supabase.from('saved_views').select('id, name, query, is_shared, created_by').eq('page', 'creators').eq('is_archived', false).order('name')) as SavedView[]
  },
  async saveView(name: string, query: CreatorFilters, shared: boolean): Promise<string> {
    if (!supabase) return pv.saveView(name, query, shared)
    return (must(await supabase.from('saved_views').insert({ page: 'creators', name: name.trim(), query, is_shared: shared }).select('id').single()) as { id: string }).id
  },
  async deleteView(id: string) {
    if (!supabase) return pv.deleteView(id)
    must(await supabase.from('saved_views').update({ is_archived: true }).eq('id', id))
  },
}
