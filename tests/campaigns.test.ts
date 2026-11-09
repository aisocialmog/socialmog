import { describe, expect, it } from 'vitest'
import { costPerView, deliverableSummary, engagementRate, formatCPV, isConfirmed, isOverdue } from '../src/lib/campaigns'

describe('campaign maths (same as the database views)', () => {
  it('engagement rate uses views, else reach', () => {
    expect(engagementRate({ views: 184000, likes: 9800, comments: 412, shares: 1350, saves: 2240 })).toBe(7.5)
    expect(engagementRate({ reach: 1000, likes: 50 })).toBe(5)
    expect(engagementRate({ likes: 5 })).toBeNull()
  })
  it('cost per view', () => {
    expect(costPerView(86000, 301500)).toBe(0.2852)
    expect(costPerView(null, 100)).toBeNull()
    expect(formatCPV(0.2852)).toBe('₹0.29')
  })
  it('confirmed-or-later statuses count as spend', () => {
    expect(['shortlisted', 'contacted', 'negotiating', 'dropped'].some(isConfirmed)).toBe(false)
    expect(['confirmed', 'content_submitted', 'approved', 'posted', 'paid'].every(isConfirmed)).toBe(true)
  })
  it('overdue = go-live passed and not posted', () => {
    expect(isOverdue('2026-11-07', 'approved', '2026-11-09')).toBe(true)
    expect(isOverdue('2026-11-07', 'live', '2026-11-09')).toBe(false)
    expect(isOverdue('2026-11-09', 'approved', '2026-11-09')).toBe(false)
  })
  it('summarises planned deliverables', () => {
    expect(deliverableSummary({ story: 3, reel: 2 })).toBe('2 Reels + 3 Stories')
    expect(deliverableSummary({ youtube_video: 1, short: 2 })).toBe('1 YouTube video + 2 Shorts')
    expect(deliverableSummary({})).toBe('No deliverables yet')
  })
})
