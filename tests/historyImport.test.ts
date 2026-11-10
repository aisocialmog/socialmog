import { describe, expect, it } from 'vitest'
import { guessHistoryMapping, historyTemplate, HISTORY_FIELDS, prepareHistoryRows } from '../src/lib/historyImport'

describe('guessHistoryMapping', () => {
  it('maps brand synonyms for past campaigns', () => {
    const m = guessHistoryMapping(['Client', 'Campaign name', 'Start Date', 'End date', 'Fees', 'Creator cost', 'Type', 'Remarks'], HISTORY_FIELDS.campaigns)
    expect(m).toEqual(['brand', 'name', 'start_date', 'end_date', 'client_fee', 'creator_spend', 'kind', 'notes'])
  })
  it('maps "Brand name" for old brands and leaves unknown columns blank', () => {
    expect(guessHistoryMapping(['Brand name', 'Favourite colour', 'GST No'], HISTORY_FIELDS.brands)).toEqual(['name', '', 'gstin'])
  })
  it('maps campaign-creator columns, "Amount" being the fee', () => {
    expect(guessHistoryMapping(['Brand', 'Campaign name', 'Influencer', 'Amount'], HISTORY_FIELDS.campaignCreators)).toEqual(['brand', 'campaign', 'creator', 'fee'])
  })
  it('uses each field once', () => {
    expect(guessHistoryMapping(['Fee', 'Amount'], HISTORY_FIELDS.campaigns)).toEqual(['client_fee', ''])
  })
  it('reads the template headers back', () => {
    const t = historyTemplate('campaigns')
    expect(guessHistoryMapping(t.headers, HISTORY_FIELDS.campaigns)).toEqual(HISTORY_FIELDS.campaigns.map(f => f.key))
  })
})

describe('prepareHistoryRows', () => {
  const headers = ['Client', 'Campaign', 'Start', 'End', 'Fees', 'Kind']
  const map = guessHistoryMapping(headers, HISTORY_FIELDS.campaigns)
  it('cleans dates and amounts', () => {
    const r = prepareHistoryRows('campaigns', [['Chai Sutra', 'Diwali', '15/07/2025', '', '₹1,50,000', 'Influencer']], map, null)
    expect(r.problems).toEqual([])
    expect(r.rows[0]).toMatchObject({ brand: 'Chai Sutra', name: 'Diwali', start_date: '2025-07-15', client_fee: '150000' })
  })
  it('reports missing, unreadable date and unreadable amount', () => {
    const r = prepareHistoryRows('campaigns', [['', 'A', 'x', '', '', ''], ['B', 'C', '', '', 'lots', '']], map, null)
    expect(r.rows).toHaveLength(0)
    const texts = r.problems.map(p => `${p.row}:${p.problem}`)
    expect(texts.some(t => t.startsWith('1:Brand is missing'))).toBe(true)
    expect(texts.some(t => t.startsWith('1:Start date'))).toBe(true)
    expect(texts.some(t => t.startsWith('2:Client fee'))).toBe(true)
    expect(r.problems.find(p => p.row === 2)?.name).toBe('C')
  })
  it('skips blank lines and keeps row numbers', () => {
    const r = prepareHistoryRows('campaigns', [['', '', '', '', '', ''], ['X', 'Y', '', '', '', '']], map, null)
    expect(r.review.map(x => x.row)).toEqual([2])
    expect(r.rows).toHaveLength(1)
  })
  it('flags campaigns starting on or after go-live', () => {
    const rows = [['X', 'Old', '31/03/2026', '', '', ''], ['X', 'New', '01/04/2026', '', '', '']]
    const r = prepareHistoryRows('campaigns', rows, map, '2026-04-01')
    expect(r.rows.map(x => x.name)).toEqual(['Old'])
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0].problem).toContain('Starts on or after go-live')
  })
  it('requires brand name for brands and creator/campaign for the join', () => {
    expect(prepareHistoryRows('brands', [['', 'Mumbai']], ['name', 'city'], null).problems).toHaveLength(1)
    const m = guessHistoryMapping(['Campaign', 'Creator', 'Fee'], HISTORY_FIELDS.campaignCreators)
    const r = prepareHistoryRows('campaignCreators', [['Diwali', '', '5,000']], m, null)
    expect(r.problems[0].problem).toBe('Creator is missing')
    expect(prepareHistoryRows('campaignCreators', [['Diwali', 'Asha', '5,000']], m, null).rows[0]).toEqual({ campaign: 'Diwali', creator: 'Asha', fee: '5000' })
  })
})
