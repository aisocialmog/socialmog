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
