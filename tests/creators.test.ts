import { describe, expect, it } from 'vitest'
import { applyCreatorFilters, cleanHandle, duplicatesWithinFile, EMPTY_FILTERS, formatCount, guessMapping, parseCount, parseCSV, prepareRows, tierFor } from '../src/lib/creators'

describe('tiers (same as the database)', () => {
  it('uses the brief’s thresholds', () => {
    expect([9999, 10000, 99999, 100000, 499999, 500000, 999999, 1_000_000].map(tierFor))
      .toEqual(['nano', 'micro', 'micro', 'mid', 'mid', 'macro', 'macro', 'mega'])
    expect(tierFor(null)).toBeNull()
  })
})

describe('counts', () => {
  it('reads K, M, lakh, crore and Indian commas', () => {
    expect(parseCount('48.2K')).toBe(48200)
    expect(parseCount('1.2M')).toBe(1_200_000)
    expect(parseCount('1.5L')).toBe(150_000)
    expect(parseCount('2 lakh')).toBe(200_000)
    expect(parseCount('1,20,000')).toBe(120_000)
    expect(parseCount('₹9,000')).toBe(9000)
    expect(parseCount('3cr')).toBe(30_000_000)
    expect(parseCount('abc')).toBeNull()
    expect(formatCount(1_240_000)).toBe('1.24M')
    expect(formatCount(48_200)).toBe('48.2K')
    expect(formatCount(120_000)).toBe('120K')
    expect(formatCount(10_000)).toBe('10K')
    expect(formatCount(2_000_000)).toBe('2M')
  })
  it('cleans handles and URLs', () => {
    expect(cleanHandle('@aarohi.eats')).toBe('aarohi.eats')
    expect(cleanHandle('https://www.instagram.com/aarohi.eats/?hl=en')).toBe('aarohi.eats')
    expect(cleanHandle('https://youtube.com/@KabirTech')).toBe('KabirTech')
    expect(cleanHandle('https://www.youtube.com/channel/UCabc123')).toBe('UCabc123')
  })
})

describe('CSV import', () => {
  const csv = '﻿Creator Name,Mobile,Insta,IG Followers,City,Category,Reel Rate\r\n"Aarohi, Ranchi",+91 98350 10001,@aarohi.eats,48.2K,Ranchi,"Food; Regional",₹9000\r\nBadRow,,,12K,,,\r\n"Copy ""Two""",098350-10001,aarohi.EATS,1L,Patna,Food,lots\r\n'
  const [headers, ...data] = parseCSV(csv)
  it('parses quotes, escaped quotes and CRLF', () => {
    expect(headers).toEqual(['Creator Name', 'Mobile', 'Insta', 'IG Followers', 'City', 'Category', 'Reel Rate'])
    expect(data[0][0]).toBe('Aarohi, Ranchi')
    expect(data[2][0]).toBe('Copy "Two"')
  })
  it('guesses the column mapping', () => {
    expect(guessMapping(headers)).toEqual(['name', 'phone', 'instagram_handle', 'instagram_followers', 'city', 'niches', 'rate_reel'])
  })
  it('prepares rows, flags problems and in-file duplicates', () => {
    const rows = prepareRows(headers, data, guessMapping(headers))
    expect(rows[0].row.platforms[0]).toMatchObject({ platform: 'instagram', handle: 'aarohi.eats', followers: 48200 })
    expect(rows[0].row.niches).toEqual(['Food', 'Regional'])
    expect(rows[0].row.rates.reel).toBe(9000)
    expect(rows[1].problems).toContain('Instagram numbers given without a handle')
    expect(rows[2].problems).toContain('Reel rate “lots” isn’t a number')
    expect(duplicatesWithinFile(rows).get(4)).toBe('Same phone as row 2')
  })
  it('reads semicolon files too', () => {
    expect(parseCSV('Name;City\nA;Ranchi')).toEqual([['Name', 'City'], ['A', 'Ranchi']])
  })
})

describe('list filters', () => {
  const base = { languages: ['Hindi'], niches: ['Food'], platforms: ['instagram'], handles: ['instagram:a'], rating: 4, is_blacklisted: false, manager_agency: null }
  const rows = [
    { ...base, name: 'A', city: 'Ranchi', tier: 'micro' as const, max_followers: 48200, rate_reel: 9000 },
    { ...base, name: 'B', city: 'Mumbai', tier: 'mid' as const, max_followers: 156000, rate_reel: 28000, niches: ['Fashion'] },
    { ...base, name: 'C', city: 'Ranchi', tier: 'nano' as const, max_followers: 7400, rate_reel: 3000, is_blacklisted: true },
  ]
  it('"Ranchi food micro creators"', () => {
    expect(applyCreatorFilters(rows, { ...EMPTY_FILTERS, city: 'ranchi', niches: ['food'], tiers: ['micro'] }).map(r => r.name)).toEqual(['A'])
  })
  it('follower and rate ranges; blacklisted hidden unless asked', () => {
    expect(applyCreatorFilters(rows, { ...EMPTY_FILTERS, followersMin: '10K', followersMax: '2L' }).map(r => r.name)).toEqual(['A', 'B'])
    expect(applyCreatorFilters(rows, { ...EMPTY_FILTERS, rateMin: '5000', rateMax: '10,000' }).map(r => r.name)).toEqual(['A'])
    expect(applyCreatorFilters(rows, { ...EMPTY_FILTERS, showBlacklisted: true, city: 'Ranchi' }).map(r => r.name)).toEqual(['A', 'C'])
  })
})
