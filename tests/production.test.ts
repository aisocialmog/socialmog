import { describe, expect, it } from 'vitest'
import { brandColor, BRAND_COLORS, monthGrid, plainText, weekDays, weekStart } from '../src/lib/production'

describe('calendar dates', () => {
  it('month grid starts Monday and covers the month', () => {
    const g = monthGrid(2026, 11)
    expect(g[0]).toBe('2026-10-26')           // Mon before 1 Nov 2026 (a Sunday)
    expect(g).toContain('2026-11-30')
    expect(g.length % 7).toBe(0)
  })
  it('weeks are Monday–Sunday', () => {
    expect(weekStart('2026-11-09')).toBe('2026-11-09')
    expect(weekStart('2026-11-15')).toBe('2026-11-09')
    expect(weekDays('2026-11-12')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
  })
})
describe('brand colours', () => {
  it('slots map to palette colours, strongest first', () => {
    expect(brandColor(0)).toBe('#E3793A'); expect(brandColor(1)).toBe('#B7282E'); expect(brandColor(6)).toBe(brandColor(0))
    expect(BRAND_COLORS).toContain(brandColor(null))
  })
})
describe('script text', () => {
  it('turns rich text into plain text for the card preview', () => {
    expect(plainText('<p><strong>Hook:</strong> steam&nbsp;rising</p><p>Line 2</p>')).toBe('Hook: steam rising\nLine 2')
  })
})
