// Brands data access. With Supabase configured everything goes to the
// database (RLS decides what each role gets). In the local design preview
// (no Supabase) the same calls run against an in-memory copy of the two
// sample brands, so every screen can be tried.
import { supabase } from '../lib/supabase'
import type { BrandStatus, EngagementType, BrandFileKind } from '../lib/brands'
import { safeFileName } from '../lib/brands'
import type { ActivityEntry } from '../lib/activity'
import { preview } from './brandsPreview'

export interface BrandOverview {
  id: string; created_at: string; updated_at: string; is_archived: boolean
  name: string; billing_name: string | null; logo_path: string | null; industry: string | null
  website: string | null; instagram_handle: string | null; youtube_handle: string | null
  engagement_type: EngagementType; status: BrandStatus; source: string | null
  owner_id: string | null; owner_name: string | null; owner_photo_path: string | null
  city: string | null; state: string | null; state_code: string | null; gstin: string | null; pan: string | null
  billing_address: string | null; payment_terms_days: number | null; notes: string | null
  lifetime_revenue: number; received: number; outstanding: number; overdue: number
  active_campaigns: number; total_campaigns: number
  historical_revenue: number; historical_campaigns: number   // imported pre-go-live history — never in money reports
  primary_contact_id: string | null; primary_contact_name: string | null; primary_contact_email: string | null; primary_contact_phone: string | null
  retainer_id: string | null; retainer_status: string | null; monthly_fee: number | null; retainer_start_date: string | null
  billing_day: number | null; renewal_date: string | null; days_to_renewal: number | null; renewal_warning: boolean
}

export interface BrandInput {
  name: string; billing_name: string | null; industry: string | null; website: string | null
  instagram_handle: string | null; youtube_handle: string | null; engagement_type: EngagementType
  status: BrandStatus; source: string | null; owner_id: string | null; city: string | null
  state: string | null; state_code: string | null; gstin: string | null; billing_address: string | null
  payment_terms_days: number | null; notes: string | null
}

export interface RetainerInput { monthly_fee: number; start_date: string; billing_day: number | null; renewal_date: string | null; scope: string | null }
export interface Retainer extends RetainerInput { id: string; brand_id: string; title: string; status: string }

export interface Contact {
  id: string; brand_id: string; name: string; designation: string | null; phone: string | null
  whatsapp: string | null; email: string | null; is_primary: boolean; is_billing: boolean; notes: string | null; is_archived: boolean
}
export type ContactInput = Pick<Contact, 'name' | 'designation' | 'phone' | 'whatsapp' | 'email' | 'is_billing' | 'notes'> & { is_primary: boolean }

export interface BrandFile {
  id: string; file_name: string; kind: BrandFileKind; mime_type: string | null; size_bytes: number | null
  storage_path: string; created_at: string; created_by: string | null; is_archived: boolean
}
export interface Owner { id: string; name: string; photo_path: string | null; role: string }
export interface CampaignLite { id: string; name: string; code: string | null; status: string; start_date: string | null; end_date: string | null; contract_value?: number | null; billed?: number; profit?: number }
export interface DeliverableLite { id: string; title: string; deliverable_type: string; platform: string | null; stage: string; due_date: string | null; go_live_date: string | null }
export interface InvoiceLite { invoice_id: string; invoice_number: string | null; issue_date: string | null; due_date: string | null; total: number; paid: number; outstanding: number; payment_status: string }
export interface ReceiptLite { id: string; received_on: string; amount_received: number; tds_deducted: number; mode: string | null; reference: string | null }

const BUCKET = 'records'
function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

export const brandsApi = {
  async list(archived = false): Promise<BrandOverview[]> {
    if (!supabase) return preview.list(archived)
    return must(await supabase.from('brand_overview').select('*').eq('is_archived', archived).order('name')) as BrandOverview[]
  },
  async get(id: string): Promise<BrandOverview | null> {
    if (!supabase) return preview.get(id)
    return must(await supabase.from('brand_overview').select('*').eq('id', id).maybeSingle()) as BrandOverview | null
  },
  async owners(): Promise<Owner[]> {
    if (!supabase) return preview.owners()
    const rows = must(await supabase.from('team_directory').select('id, name, photo_path, role').order('name')) as Owner[]
    return rows.filter(r => r.role !== 'freelancer')
  },
  async save(input: BrandInput, id?: string): Promise<string> {
    if (!supabase) return preview.save(input, id)
    if (id) { must(await supabase.from('brands').update(input).eq('id', id)); return id }
    return (must(await supabase.from('brands').insert(input).select('id').single()) as { id: string }).id
  },
  async setStatus(id: string, status: BrandStatus) {
    if (!supabase) return preview.patch(id, { status })
    must(await supabase.from('brands').update({ status }).eq('id', id))
  },
  async setNotes(id: string, notes: string | null) {
    if (!supabase) return preview.patch(id, { notes })
    must(await supabase.from('brands').update({ notes }).eq('id', id))
  },
  async setArchived(id: string, archived: boolean) {
    if (!supabase) return preview.patch(id, { is_archived: archived })
    must(await supabase.from('brands').update({ is_archived: archived }).eq('id', id))
  },

  // ── retainer ──
  async retainer(brandId: string): Promise<Retainer | null> {
    if (!supabase) return preview.retainer(brandId)
    return must(await supabase.from('retainers').select('id, brand_id, title, status, monthly_fee, start_date, billing_day, renewal_date, scope')
      .eq('brand_id', brandId).eq('is_archived', false).in('status', ['draft', 'active', 'paused']).maybeSingle()) as Retainer | null
  },
  /** Create/update the live retainer, or end it (input = null). */
  async saveRetainer(brandId: string, input: RetainerInput | null) {
    if (!supabase) return preview.saveRetainer(brandId, input)
    const current = await brandsApi.retainer(brandId)
    if (!input) {
      if (current) must(await supabase.from('retainers').update({ status: 'ended', end_date: new Date().toISOString().slice(0, 10) }).eq('id', current.id))
      return
    }
    if (current) must(await supabase.from('retainers').update(input).eq('id', current.id))
    else must(await supabase.from('retainers').insert({ ...input, brand_id: brandId, title: 'Monthly retainer', status: 'active' }))
  },

  // ── contacts ──
  async contacts(brandId: string): Promise<Contact[]> {
    if (!supabase) return preview.contacts(brandId)
    return must(await supabase.from('brand_contacts').select('id, brand_id, name, designation, phone, whatsapp, email, is_primary, is_billing, notes, is_archived')
      .eq('brand_id', brandId).order('is_primary', { ascending: false }).order('name')) as Contact[]
  },
  async saveContact(brandId: string, input: ContactInput, id?: string) {
    if (!supabase) return preview.saveContact(brandId, input, id)
    const { is_primary, ...rest } = input
    let contactId = id
    if (id) must(await supabase.from('brand_contacts').update(rest).eq('id', id))
    else contactId = (must(await supabase.from('brand_contacts').insert({ ...rest, brand_id: brandId }).select('id').single()) as { id: string }).id
    if (is_primary) must(await supabase.rpc('set_primary_contact', { p_contact: contactId }))
  },
  async makePrimary(contactId: string) {
    if (!supabase) return preview.makePrimary(contactId)
    must(await supabase.rpc('set_primary_contact', { p_contact: contactId }))
  },
  async archiveContact(contactId: string) {
    if (!supabase) return preview.archiveContact(contactId)
    must(await supabase.from('brand_contacts').update({ is_archived: true, is_primary: false }).eq('id', contactId))
  },

  // ── files & logo (private "records" bucket, folder brands/<id>/) ──
  async files(brandId: string): Promise<BrandFile[]> {
    if (!supabase) return preview.files(brandId)
    return must(await supabase.from('files').select('id, file_name, kind, mime_type, size_bytes, storage_path, created_at, created_by, is_archived')
      .eq('brand_id', brandId).order('created_at', { ascending: false })) as BrandFile[]
  },
  async uploadFile(brandId: string, file: File, kind: BrandFileKind) {
    if (!supabase) return preview.uploadFile(brandId, file, kind)
    const path = `brands/${brandId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
    must(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false }))
    const { error } = await supabase.from('files').insert({
      bucket: BUCKET, storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, kind, brand_id: brandId,
    })
    if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(error.message) }
  },
  async archiveFile(id: string) {
    if (!supabase) return preview.archiveFile(id)
    must(await supabase.from('files').update({ is_archived: true }).eq('id', id))
  },
  async uploadLogo(brandId: string, file: File) {
    if (!supabase) return preview.patch(brandId, { logo_path: `preview:${URL.createObjectURL(file)}` })
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
    const path = `brands/${brandId}/logo-${Date.now()}.${ext}`
    must(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }))
    must(await supabase.from('brands').update({ logo_path: path }).eq('id', brandId))
  },
  async signedUrl(path: string, download?: string): Promise<string | null> {
    if (path.startsWith('preview:')) return path.slice(8)
    if (!supabase) return null
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600, download ? { download } : undefined)
    return data?.signedUrl ?? null
  },

  // ── linked records ──
  async activity(brandId: string): Promise<ActivityEntry[]> {
    if (!supabase) return preview.activity(brandId)
    return must(await supabase.rpc('brand_activity', { p_brand: brandId })) as ActivityEntry[]
  },
  async campaigns(brandId: string, withMoney: boolean): Promise<CampaignLite[]> {
    if (!supabase) return []
    const rows = must(await supabase.from('campaigns').select('id, name, code, status, start_date, end_date')
      .eq('brand_id', brandId).eq('is_archived', false).order('start_date', { ascending: false, nullsFirst: false })) as CampaignLite[]
    if (!withMoney || rows.length === 0) return rows
    const fin = must(await supabase.from('campaign_financials').select('campaign_id, contract_value, billed, profit').eq('brand_id', brandId)) as
      { campaign_id: string; contract_value: number | null; billed: number; profit: number }[]
    return rows.map(r => ({ ...r, ...fin.find(f => f.campaign_id === r.id) }))
  },
  async deliverables(brandId: string): Promise<DeliverableLite[]> {
    if (!supabase) return []
    return must(await supabase.from('deliverables').select('id, title, deliverable_type, platform, stage, due_date, go_live_date')
      .eq('brand_id', brandId).eq('is_archived', false).order('go_live_date', { ascending: true, nullsFirst: false })) as DeliverableLite[]
  },
  async invoices(brandId: string): Promise<InvoiceLite[]> {
    if (!supabase) return []
    return must(await supabase.from('invoice_totals').select('invoice_id, invoice_number, issue_date, due_date, total, paid, outstanding, payment_status')
      .eq('brand_id', brandId).order('issue_date', { ascending: false, nullsFirst: true })) as InvoiceLite[]
  },
  async receipts(brandId: string): Promise<ReceiptLite[]> {
    if (!supabase) return []
    return must(await supabase.from('receipts').select('id, received_on, amount_received, tds_deducted, mode, reference')
      .eq('brand_id', brandId).eq('is_archived', false).order('received_on', { ascending: false })) as ReceiptLite[]
  },
}
