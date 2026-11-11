import { describe, expect, it } from 'vitest'
import { formatMinutes, formatTime, parseQuickAdd, weekStreak } from '../src/lib/tasks'

const members = [{ id: 'f1', name: 'Asha Rao' }, { id: 'f2', name: 'Founder2' }, { id: 'e', name: 'Farid Khan' }]
const brands = [{ id: 'b1', name: 'BrandX' }, { id: 'b2', name: 'Chai Sutra' }]
const TODAY = '2026-11-10' // a Tuesday

describe('parseQuickAdd', () => {
  it('reads the example from the brief', () => {
    const r = parseQuickAdd('Call Rohan about reel edit tomorrow 4pm @Founder2 #BrandX', members, brands, TODAY)
    expect(r).toEqual({ title: 'Call Rohan about reel edit', assignee_ids: ['f2'], brand_id: 'b1', due_date: '2026-11-11', due_time: '16:00', unmatched: [] })
  })
  it('matches first names, brand prefixes and several people', () => {
    const r = parseQuickAdd('Send report @asha @farid #chai friday', members, brands, TODAY)
    expect(r.assignee_ids).toEqual(['f1', 'e']); expect(r.brand_id).toBe('b2'); expect(r.due_date).toBe('2026-11-13'); expect(r.title).toBe('Send report')
  })
  it('a weekday named today means next week', () => expect(parseQuickAdd('Standup tuesday', members, brands, TODAY).due_date).toBe('2026-11-17'))
  it('reads 24h and half-hour times; a time alone means today', () => {
    expect(parseQuickAdd('Shoot prep 16:30', members, brands, TODAY)).toMatchObject({ due_time: '16:30', due_date: TODAY, title: 'Shoot prep' })
    expect(parseQuickAdd('Call at 9:15 am', members, brands, TODAY).due_time).toBe('09:15')
    expect(parseQuickAdd('Call 12am', members, brands, TODAY).due_time).toBe('00:00')
  })
  it('reads a day and month, rolling into next year when past', () => {
    expect(parseQuickAdd('File GST 20 Dec', members, brands, TODAY).due_date).toBe('2026-12-20')
    expect(parseQuickAdd('Renew domain 3 jan', members, brands, TODAY).due_date).toBe('2027-01-03')
  })
  it('keeps unknown tags in the title and reports them', () => {
    const r = parseQuickAdd('Ping @nobody about #ghost', members, brands, TODAY)
    expect(r.unmatched).toEqual(['@nobody', '#ghost']); expect(r.title).toBe('Ping @nobody about #ghost'); expect(r.assignee_ids).toEqual([])
  })
  it('leaves ordinary numbers and emails alone', () => {
    const r = parseQuickAdd('Order 4 lights, mail a@b.co', members, brands, TODAY)
    expect(r).toMatchObject({ title: 'Order 4 lights, mail a@b.co', due_date: null, due_time: null })
  })
})

describe('formatting', () => {
  it('times and durations', () => {
    expect(formatTime('16:00:00')).toBe('4 pm'); expect(formatTime('09:05')).toBe('9:05 am'); expect(formatTime(null)).toBe('')
    expect(formatMinutes(45)).toBe('45 min'); expect(formatMinutes(125)).toBe('2 h 05 min')
  })
})

describe('weekStreak', () => {
  it('counts weeks in a row, forgiving the current unfinished week', () => {
    expect(weekStreak(['2026-11-10', '2026-11-05', '2026-10-28'], TODAY)).toBe(3)
    expect(weekStreak(['2026-11-05', '2026-10-28'], TODAY)).toBe(2)
    expect(weekStreak(['2026-10-20'], TODAY)).toBe(0)
    expect(weekStreak([], TODAY)).toBe(0)
  })
})
