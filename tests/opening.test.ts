import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { dayBefore, normaliseKind, openingTotals, parseAmount, parseDateIN, splitByShare } from '../src/lib/opening'

describe('splitByShare', () => {
  const f = (...p: (number | null)[]) => p.map((x, i) => ({ founder_id: `f${i + 1}`, profit_share_pct: x }))
  it('splits 50:50', () => expect(splitByShare(2000, f(50, 50))).toEqual({ f1: 1000, f2: 1000 }))
  it('splits unevenly', () => expect(splitByShare(1000, f(60, 40))).toEqual({ f1: 600, f2: 400 }))
  it('three ways always sums to total, remainder to first', () => {
    const r = splitByShare(100, f(33.33, 33.33, 33.34))
    expect(Object.values(r).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2)
    expect(r.f1).toBeCloseTo(33.33, 2)
  })
  it('remainder paise go to the first founder', () => {
    const r = splitByShare(100, f(1, 1, 1))
    expect(r).toEqual({ f1: 33.34, f2: 33.33, f3: 33.33 })
  })
  it('tiny amount', () => expect(splitByShare(0.01, f(50, 50))).toEqual({ f1: 0.01, f2: 0 }))
  it('zero shares split equally', () => expect(splitByShare(100, f(0, 0))).toEqual({ f1: 50, f2: 50 }))
  it('null shares split equally', () => expect(splitByShare(101, f(null, null))).toEqual({ f1: 50.5, f2: 50.5 }))
  it('negative amount', () => {
    const r = splitByShare(-100, f(50, 50))
    expect(r.f1 + r.f2).toBeCloseTo(-100, 2)
  })
  it('no founders', () => expect(splitByShare(100, [])).toEqual({}))
})

describe('openingTotals', () => {
  it('balances', () => {
    const t = openingTotals({ capital: 100000, accounts: 80000, receivables: 50000, payables: 30000 })
    expect(t).toMatchObject({ net_position: 100000, difference: 0, is_balanced: true })
  })
  it('difference sign and rounding', () => {
    const t = openingTotals({ capital: 100, accounts: 0.1 + 0.2, receivables: 0, payables: 0 })
    expect(t.accounts).toBe(0.3)
    expect(t.difference).toBe(-99.7)
    expect(t.is_balanced).toBe(false)
  })
  it('within a rupee counts as balanced', () => {
    expect(openingTotals({ capital: 100, accounts: 100.99, receivables: 0, payables: 0 }).is_balanced).toBe(true)
    expect(openingTotals({ capital: 100, accounts: 101, receivables: 0, payables: 0 }).is_balanced).toBe(false)
  })
})

describe('dayBefore', () => {
  it('plain', () => expect(dayBefore('2026-11-15')).toBe('2026-11-14'))
  it('month start', () => expect(dayBefore('2026-03-01')).toBe('2026-02-28'))
  it('leap year', () => expect(dayBefore('2024-03-01')).toBe('2024-02-29'))
  it('year start', () => expect(dayBefore('2026-01-01')).toBe('2025-12-31'))
})

describe('parseAmount', () => {
  it.each([
    ['₹1,50,000', 150000], ['1,50,000.50', 150000.5], [' 2000 ', 2000], ['2.5L', 250000], ['2.5 lakh', 250000], ['2 Lakhs', 200000],
    ['1.2Cr', 12000000], ['1 crore', 10000000], ['45k', 45000], ['45 K', 45000], ['Rs. 500', 500], ['0', 0], ['99.999', 100], [1234.5, 1234.5],
  ])('%s -> %s', (raw, want) => expect(parseAmount(raw)).toBe(want))
  it.each([[''], ['   '], ['abc'], ['12abc'], ['5 zz'], [null], [undefined], [{}], [NaN], ['₹']])('%s -> null', raw => expect(parseAmount(raw)).toBeNull())
})

describe('parseDateIN', () => {
  it.each([
    ['2025-03-31', '2025-03-31'], ['31/03/2025', '2025-03-31'], ['31-03-2025', '2025-03-31'], ['31.03.25', '2025-03-31'],
    ['1/2/2025', '2025-02-01'], ['31 Mar 2025', '2025-03-31'], ['31-Mar-25', '2025-03-31'], ['5 March 2025', '2025-03-05'],
    ['March 2025', '2025-03-01'], ['Mar 2025', '2025-03-01'], ['29/02/2024', '2024-02-29'], ['  01/04/2025 ', '2025-04-01'],
  ])('%s -> %s', (raw, want) => expect(parseDateIN(raw)).toBe(want))
  it.each([[''], ['31/02/2025'], ['29/02/2025'], ['32/01/2025'], ['00/01/2025'], ['13/13/2025'], ['2025-02-30'], ['hello'], ['31 Foo 2025'], [null], [42]])('%s -> null', raw => expect(parseDateIN(raw)).toBeNull())
  it('is day-first', () => expect(parseDateIN('03/04/2025')).toBe('2025-04-03'))
})

describe('normaliseKind', () => {
  it.each([
    ['Influencer campaign', 'influencer'], ['UGC', 'ugc'], ['Production / shoot', 'production'], ['Retainer', 'full_marketing_month'],
    ['Full marketing', 'full_marketing_month'], ['monthly', 'full_marketing_month'], ['', 'influencer'], ['whatever', 'influencer'], [null, 'influencer'],
    ['full_marketing_month', 'full_marketing_month'],
  ])('%s -> %s', (raw, want) => expect(normaliseKind(raw)).toBe(want))
})

describe('opening preview store', () => {
  type Mod = typeof import('../src/data/openingPreview')
  let pv: Mod['openingPreview']
  beforeEach(async () => {
    vi.resetModules()
    pv = (await import('../src/data/openingPreview')).openingPreview
  })
  const ME = '00000000-0000-0000-0000-000000000000'

  it('starts unlocked and empty', async () => {
    const s = await pv.state()
    expect(s.go_live_date).toBeNull()
    expect(s.locked_at).toBeNull()
    expect(s.founders).toHaveLength(2)
    expect(s.accounts).toHaveLength(3)
    expect(s.totals.is_balanced).toBe(true)
  })

  it('needs go-live first', async () => {
    await expect(pv.saveCapital([])).rejects.toThrow('Set the go-live date first')
    await expect(pv.setBalances([])).rejects.toThrow('Set the go-live date first')
  })

  it('state is a copy', async () => {
    const s = await pv.state()
    s.accounts[0].opening_balance = 999
    expect((await pv.state()).accounts[0].opening_balance).toBe(0)
  })

  it('full flow', async () => {
    await pv.setGoLive('2026-04-01')
    await pv.saveCapital([{ founder_id: ME, accumulated_profit: 100000, own_money: 50000 }, { founder_id: 'f2', accumulated_profit: 100000, own_money: 0 }])
    let s = await pv.state()
    const f1 = s.founders.find(x => x.founder_id === ME)!
    expect(f1).toMatchObject({ accumulated_profit: 100000, own_money: 50000, other: 0, total: 150000 })
    expect(s.totals.capital).toBe(250000)
    // replaced on second save
    await pv.saveCapital([{ founder_id: ME, accumulated_profit: 200000, own_money: 0 }])
    s = await pv.state()
    expect(s.totals.capital).toBe(200000)
    expect(s.founders.find(x => x.founder_id === 'f2')!.total).toBe(0)
    await expect(pv.saveCapital([{ founder_id: ME, accumulated_profit: -1, own_money: 0 }])).rejects.toThrow('negative')
    expect((await pv.state()).totals.capital).toBe(200000)

    await pv.setBalances([{ account_id: 'a1', balance: 150000 }, { account_id: 'a3', balance: 20000 }])
    await pv.addInvoice({ brand_id: 'b1', invoice_number: 'SM/22', issue_date: '2026-03-10', due_date: null, amount: 80000, note: null })
    await pv.addPayout({ creator_id: 'c1', vendor_id: null, amount: 30000, tds_rate: 10, due_date: null, description: null })
    s = await pv.state()
    expect(s.receivables[0]).toMatchObject({ brand_name: 'Chai Sutra (sample)', amount: 80000 })
    expect(s.payables[0]).toMatchObject({ payee_name: 'Aarohi Sinha (sample)', payee_kind: 'creator' })
    expect(s.totals).toMatchObject({ accounts: 170000, receivables: 80000, payables: 30000, net_position: 220000, difference: 20000, is_balanced: false })

    await expect(pv.lock()).rejects.toThrow('20,000')
    await pv.addAdjustment(20000, 'Old advance from a client')
    s = await pv.state()
    expect(s.totals.is_balanced).toBe(true)
    expect(s.founders.map(x => x.other)).toEqual([10000, 10000])
    expect(s.adjustments).toHaveLength(1)
    await pv.lock()
    s = await pv.state()
    expect(s.locked_at).not.toBeNull()

    const locked = 'Opening balances are locked — unlock them first'
    await expect(pv.setGoLive('2026-05-01')).rejects.toThrow(locked)
    await expect(pv.saveCapital([])).rejects.toThrow(locked)
    await expect(pv.setBalances([])).rejects.toThrow(locked)
    await expect(pv.addAdjustment(1, 'x')).rejects.toThrow(locked)
    await expect(pv.remove('invoice', s.receivables[0].invoice_id)).rejects.toThrow(locked)
    await expect(pv.lock()).rejects.toThrow(locked)

    await expect(pv.unlock('a@b.c', 'wrong')).rejects.toThrow('That password isn’t right.')
    await expect(pv.unlock('a@b.c', '')).rejects.toThrow('That password isn’t right.')
    expect((await pv.state()).locked_at).not.toBeNull()
    await pv.unlock('a@b.c', 'x')
    expect((await pv.state()).locked_at).toBeNull()
    await pv.remove('adjustment', s.adjustments[0].id)
    await pv.remove('invoice', s.receivables[0].invoice_id)
    await pv.remove('payout', s.payables[0].payout_id)
    s = await pv.state()
    expect(s.adjustments).toHaveLength(0)
    expect(s.receivables).toHaveLength(0)
    expect(s.payables).toHaveLength(0)
  })

  it('validates adjustments and items', async () => {
    await pv.setGoLive('2026-04-01')
    await expect(pv.addAdjustment(0, 'zero')).rejects.toThrow()
    await expect(pv.addAdjustment(5, '  ')).rejects.toThrow('note')
    await pv.addAdjustment(-500, 'Overstated')
    expect((await pv.state()).totals.capital).toBe(-500)
    const inv = { brand_id: 'b1', invoice_number: 'X1', issue_date: '2026-03-01', due_date: null, amount: 100, note: null }
    await expect(pv.addInvoice({ ...inv, invoice_number: ' ' })).rejects.toThrow()
    await expect(pv.addInvoice({ ...inv, issue_date: '2026-04-01' })).rejects.toThrow('before go-live')
    await expect(pv.addInvoice({ ...inv, amount: 0 })).rejects.toThrow()
    await expect(pv.addPayout({ creator_id: 'c1', vendor_id: null, amount: 0, tds_rate: 0, due_date: null, description: null })).rejects.toThrow()
    await pv.addInvoice(inv)
    await expect(pv.setGoLive('2026-03-01')).rejects.toThrow('on or after')
    await pv.setGoLive('2026-06-01')
    await pv.addPayout({ creator_id: null, vendor_id: 'v2', amount: 1000, tds_rate: 0, due_date: null, description: 'Edit' })
    expect((await pv.state()).payables[0]).toMatchObject({ payee_name: 'Farid (freelance editor)', payee_kind: 'freelancer' })
  })

  it('imports brands', async () => {
    const r = await pv.importBrands([
      { name: 'Chai Sutra (sample)' }, { name: 'New Brand', gstin: '27aaacc1234d1zc' }, { name: 'Bad Gst', gstin: 'nope' }, { name: '' }, { name: 'new brand' },
    ], 'f.csv')
    expect(r.created).toBe(2)
    expect(r.skipped).toBe(2)
    expect(r.errors).toEqual([
      { row: 3, name: 'Bad Gst', problem: 'GSTIN doesn’t look right — imported without it' },
      { row: 4, name: '', problem: 'No brand name' },
    ])
  })

  it('imports campaigns and creators', async () => {
    await pv.setGoLive('2026-04-01')
    await pv.importBrands([{ name: 'Old Co' }], 's')
    const r = await pv.importCampaigns([
      { brand: 'Ghost', name: 'A' }, { brand: 'old co', name: 'Past', start_date: '2025-05-01' }, { brand: 'Old Co', name: 'past' },
      { brand: 'Old Co', name: 'Late', start_date: '2026-04-01' }, { brand: 'Chai Sutra (sample)', name: 'Old Reels', start_date: '2025-01-01' },
    ], 's')
    expect(r.created).toBe(2)
    expect(r.skipped).toBe(1)
    expect(r.errors.map(e => [e.row, e.problem])).toEqual([
      [1, 'Brand “Ghost” not found — import the brand first'],
      [4, 'Starts on or after go-live — add it as a normal campaign'],
    ])
    const c = await pv.importCampaignCreators([
      { campaign: 'Past', creator: 'Kabir Menon (sample)' }, { brand: 'Old Co', campaign: 'past', creator: 'kabir menon (sample)' },
      { campaign: 'Nope', creator: 'Kabir Menon (sample)' }, { campaign: 'Past', creator: 'Unknown Person' }, { campaign: 'Old Reels', creator: 'Meenal Jha (sample)', fee: '5000' },
    ], 's')
    expect(c.created).toBe(2)
    expect(c.skipped).toBe(1)
    expect(c.errors).toHaveLength(2)
    expect(c.errors[0].row).toBe(3)
    expect(c.errors[1].problem).toContain('Creator')
  })

  it('campaign creators need a campaign imported first', async () => {
    const c = await pv.importCampaignCreators([{ campaign: 'Past', creator: 'Kabir Menon (sample)' }], 's')
    expect(c.created).toBe(0)
    expect(c.errors).toHaveLength(1)
  })
})
