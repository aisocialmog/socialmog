import { describe, expect, it } from 'vitest'
import { canOpen, moreFor, navFor, tabsFor, type Role } from '../src/lib/access'
import { passwordProblems } from '../src/lib/password'

const labels = (r: Role) => navFor(r).map(n => n.label)

describe('pages per role', () => {
  it('founder and manager see every page', () => {
    expect(labels('founder')).toHaveLength(11)
    expect(labels('manager')).toHaveLength(11)
  })
  it('team members never see money, reports, brands or creators', () => {
    expect(labels('team_member')).toEqual(['Dashboard', 'Campaigns', 'Production', 'Calendar', 'Tasks', 'AI Tools', 'Settings'])
    expect(canOpen('team_member', '/money')).toBe(false)
    expect(canOpen('team_member', '/money/invoices/123')).toBe(false)
    expect(canOpen('team_member', '/campaigns/abc')).toBe(true)
  })
  it('freelancers only see their own work', () => {
    expect(labels('freelancer')).toEqual(['Dashboard', 'Production', 'Calendar', 'Tasks', 'Settings'])
    expect(canOpen('freelancer', '/campaigns')).toBe(false)
    expect(canOpen('freelancer', '/brands/x')).toBe(false)
  })
})

describe('phone tab bar', () => {
  it('has at most five tabs, and More holds the rest', () => {
    for (const r of ['founder', 'manager', 'team_member', 'freelancer'] as Role[]) {
      const tabs = tabsFor(r), more = moreFor(r)
      expect(tabs.length).toBeLessThanOrEqual(5)
      expect([...tabs, ...more].map(n => n.to).sort()).toEqual(navFor(r).map(n => n.to).sort())
      expect(tabs.every(t => t.roles.includes(r))).toBe(true)
    }
  })
})

describe('password rules', () => {
  it('needs 8+ characters with letters and numbers', () => {
    expect(passwordProblems('short1')).toContain('at least 8 characters')
    expect(passwordProblems('longpassword')).toContain('letters and numbers')
    expect(passwordProblems('fuji2026sunset')).toEqual([])
  })
})
