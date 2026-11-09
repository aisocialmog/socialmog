import { describe, expect, it } from 'vitest'
import { describeActivity, type ActivityEntry } from '../src/lib/activity'

const base: ActivityEntry = { id: '1', created_at: '2026-11-09T10:00:00Z', action: 'update', table_name: 'brands', record_id: 'b1',
  changed_fields: [], old_values: null, new_values: null, source: 'app', actor_id: 'm1', actor_name: 'Asha' }
const e = (p: Partial<ActivityEntry>) => ({ ...base, ...p })

describe('activity sentences', () => {
  it('status moves', () => {
    expect(describeActivity(e({ action: 'status_change', changed_fields: ['status'], old_values: { status: 'lead' }, new_values: { status: 'pitching' } })).text)
      .toBe('moved the brand from Lead to Pitching')
  })
  it('single-field edits show before and after', () => {
    expect(describeActivity(e({ changed_fields: ['payment_terms_days'], old_values: { payment_terms_days: 15 }, new_values: { payment_terms_days: 30 } })).text)
      .toBe('changed payment terms from 15 days to 30 days')
    expect(describeActivity(e({ table_name: 'retainers', changed_fields: ['monthly_fee'], old_values: { monthly_fee: 80000 }, new_values: { monthly_fee: 85000 } })))
      .toEqual({ text: 'changed monthly fee of the retainer from ₹80,000 to ₹85,000', kind: 'money' })
  })
  it('owner changes use names', () => {
    expect(describeActivity(e({ changed_fields: ['owner_id'], old_values: { owner_id: 'a' }, new_values: { owner_id: 'b' } }), {}, { a: 'Asha', b: 'Dev' }).text)
      .toBe('changed owner from Asha to Dev')
  })
  it('contacts', () => {
    expect(describeActivity(e({ action: 'create', table_name: 'brand_contacts', new_values: { name: 'Priya Nair' } })).text).toBe('added contact “Priya Nair”')
    expect(describeActivity(e({ table_name: 'brand_contacts', record_id: 'c1', changed_fields: ['is_primary'], old_values: { is_primary: false }, new_values: { is_primary: true } }), { c1: 'Rohan Shah' }).text)
      .toBe('made Rohan Shah the primary contact')
    expect(describeActivity(e({ table_name: 'brand_contacts', record_id: 'c1', changed_fields: ['phone', 'email', 'updated_at'] }), { c1: 'Rohan Shah' }).text)
      .toBe('updated phone and email on contact “Rohan Shah”')
  })
  it('files and archive', () => {
    expect(describeActivity(e({ action: 'create', table_name: 'files', new_values: { file_name: 'contract.pdf' } })).text).toBe('uploaded file “contract.pdf”')
    expect(describeActivity(e({ action: 'archive', table_name: 'files', record_id: 'f1' }), { f1: 'contract.pdf' }).text).toBe('removed file “contract.pdf”')
    expect(describeActivity(e({ action: 'archive' })).text).toBe('archived the brand')
  })
})

describe('creator activity sentences', () => {
  it('rates, niches, platforms, payment details', () => {
    expect(describeActivity(e({ action: 'create', table_name: 'creator_rate_cards', new_values: { deliverable_type: 'reel', rate: 9000 } })).text).toBe('set the Reel rate to ₹9,000')
    expect(describeActivity(e({ action: 'create', table_name: 'creator_tags', new_values: { tag_id: 't1' } }), { t1: 'Food' }).text).toBe('added niche Food')
    expect(describeActivity(e({ action: 'delete', table_name: 'creator_tags', old_values: { tag_id: 't1' } }), { t1: 'Food' }).text).toBe('removed niche Food')
    expect(describeActivity(e({ table_name: 'creator_platforms', record_id: 'p1', changed_fields: ['followers', 'metrics_updated_on'], old_values: { followers: 48200 }, new_values: { followers: 120000 } }), { p1: 'Instagram @aarohi' }).text)
      .toBe('updated Instagram @aarohi stats: followers 48.2K → 120K')
    expect(describeActivity(e({ table_name: 'creator_payment_details', changed_fields: ['upi_id', 'pan'], old_values: { upi_id: '••••axis' }, new_values: { upi_id: '••••okhd' } })).text)
      .toBe('updated payment details (UPI ID, PAN)')
    expect(describeActivity(e({ table_name: 'creators', changed_fields: ['is_blacklisted', 'blacklist_reason'], old_values: {}, new_values: { is_blacklisted: true } })).text)
      .toBe('updated blacklist and blacklist reason')
    expect(describeActivity(e({ table_name: 'creators', changed_fields: ['is_blacklisted'], old_values: { is_blacklisted: false }, new_values: { is_blacklisted: true } })).text).toBe('blacklisted the creator')
  })
})
