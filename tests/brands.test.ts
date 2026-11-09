import { describe, expect, it } from 'vitest'
import { gstinProblem, normalizeHandle, normalizeWebsite, renewalNotice, safeFileName, stateFromGstin } from '../src/lib/brands'

describe('GSTIN', () => {
  it('accepts a valid GSTIN (with checksum) and finds the state', () => {
    expect(gstinProblem('27AAPFU0939F1ZV')).toBeNull()
    expect(stateFromGstin('27AAPFU0939F1ZV')).toEqual({ code: '27', name: 'Maharashtra' })
  })
  it('explains what is wrong', () => {
    expect(gstinProblem('')).toBeNull()
    expect(gstinProblem('27AAPFU')).toMatch(/15 characters/)
    expect(gstinProblem('27AAPFU0939F1ZW')).toMatch(/last character/)
    expect(gstinProblem('99AAPFU0939F1ZV')).toMatch(/state code/)
  })
})

describe('links', () => {
  it('cleans websites and handles', () => {
    expect(normalizeWebsite('chaisutra.com')).toBe('https://chaisutra.com')
    expect(normalizeWebsite('  ')).toBeNull()
    expect(normalizeHandle('@chai.sutra')).toBe('chai.sutra')
    expect(normalizeHandle('https://www.instagram.com/chai.sutra/?hl=en')).toBe('chai.sutra')
  })
  it('makes storage-safe file names', () => {
    expect(safeFileName('Brand Guidelines (v2) final!.PDF')).toBe('Brand-Guidelines-v2-final-.pdf')
  })
})

describe('retainer renewal warning (15 days)', () => {
  it('warns inside 15 days and when overdue, not before', () => {
    expect(renewalNotice('2026-11-25', 16)).toBeNull()
    expect(renewalNotice('2026-11-24', 15)?.text).toBe('Retainer renews in 15 days · 24 Nov 2026')
    expect(renewalNotice('2026-11-10', 1)?.text).toMatch(/in 1 day ·/)
    expect(renewalNotice('2026-11-09', 0)?.text).toBe('Retainer renews today')
    expect(renewalNotice('2026-11-01', -8)?.text).toMatch(/8 days ago/)
    expect(renewalNotice(null, null)).toBeNull()
  })
})
