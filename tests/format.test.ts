import { describe, expect, it } from 'vitest'
import { formatINR, formatINRShort, formatDate, formatDateTime, fyLabel, fyStart, periodRange } from '../src/lib/format'
import { skyPhase, season, greeting } from '../src/lib/time'
import { toCSV } from '../src/lib/csv'

describe('money', () => {
  it('uses Indian grouping', () => {
    expect(formatINR(100000)).toBe('₹1,00,000')
    expect(formatINR(12345678)).toBe('₹1,23,45,678')
    expect(formatINR(1499.5)).toBe('₹1,499.50')
    expect(formatINR('250000.00')).toBe('₹2,50,000')
    expect(formatINR(null)).toBe('—')
  })
  it('short form uses lakh and crore', () => {
    expect(formatINRShort(420000)).toBe('₹4.2L')
    expect(formatINRShort(13500000)).toBe('₹1.35Cr')
  })
})

describe('dates (IST)', () => {
  it('shows DD MMM YYYY', () => expect(formatDate('2026-11-09')).toBe('09 Nov 2026'))
  it('converts timestamps to IST before taking the date', () => {
    expect(formatDate('2026-11-09T20:00:00Z')).toBe('10 Nov 2026')   // 1:30 am IST next day
    expect(formatDateTime('2026-11-09T10:35:00Z')).toBe('09 Nov 2026, 4:05 pm')
  })
})

describe('financial year & periods', () => {
  it('FY runs 1 April – 31 March', () => {
    expect(fyStart('2027-03-31')).toBe('2026-04-01')
    expect(fyStart('2026-04-01')).toBe('2026-04-01')
    expect(fyLabel('2027-02-15')).toBe('FY 2026-27')
  })
  it('matches the database period_bounds() for 15 Feb 2027', () => {
    const t = '2027-02-15'
    expect(periodRange('this_week', t)).toEqual({ from: '2027-02-15', to: '2027-02-21' })
    expect(periodRange('last_week', t)).toEqual({ from: '2027-02-08', to: '2027-02-14' })
    expect(periodRange('this_month', t)).toEqual({ from: '2027-02-01', to: '2027-02-28' })
    expect(periodRange('last_month', t)).toEqual({ from: '2027-01-01', to: '2027-01-31' })
    expect(periodRange('this_quarter', t)).toEqual({ from: '2027-01-01', to: '2027-03-31' })
    expect(periodRange('last_quarter', t)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('this_fy', t)).toEqual({ from: '2026-04-01', to: '2027-03-31' })
    expect(periodRange('last_fy', t)).toEqual({ from: '2025-04-01', to: '2026-03-31' })
  })
  it('handles month and year edges', () => {
    expect(periodRange('last_month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodRange('this_quarter', '2026-04-01')).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(() => periodRange('custom', t0, { from: '2026-05-02', to: '2026-05-01' })).toThrow()
  })
})
const t0 = '2026-05-01'

describe('sky, seasons, greetings in IST', () => {
  // 01:30 UTC = 07:00 IST
  it('dawn / day / sunset / night', () => {
    expect(skyPhase(new Date('2026-11-09T01:30:00Z'))).toBe('dawn')
    expect(skyPhase(new Date('2026-11-09T06:30:00Z'))).toBe('day')     // 12:00
    expect(skyPhase(new Date('2026-11-09T11:30:00Z'))).toBe('sunset')  // 17:00
    expect(skyPhase(new Date('2026-11-09T14:30:00Z'))).toBe('night')   // 20:00
  })
  it('seasons follow IST month', () => {
    expect(season(new Date('2026-04-10T00:00:00Z'))).toBe('haru')
    expect(season(new Date('2026-07-10T00:00:00Z'))).toBe('natsu')
    expect(season(new Date('2026-11-30T20:00:00Z'))).toBe('fuyu') // already 1 Dec in IST
  })
  it('greets by time', () => {
    expect(greeting(new Date('2026-11-09T02:30:00Z')).romaji).toBe('Ohayō')
    expect(greeting(new Date('2026-11-09T08:30:00Z')).romaji).toBe('Konnichiwa')
    expect(greeting(new Date('2026-11-09T13:30:00Z')).romaji).toBe('Konbanwa')
  })
})

describe('csv', () => {
  it('quotes, escapes and blocks formulas', () => {
    const csv = toCSV([{ a: 'Mama, Bites', b: '=SUM(A1)' }], [{ header: 'Name', value: r => r.a }, { header: 'X', value: r => r.b }])
    expect(csv).toBe('﻿Name,X\r\n"Mama, Bites",\'=SUM(A1)')
  })
})
