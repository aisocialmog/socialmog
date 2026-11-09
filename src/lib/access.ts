// Which pages each role sees. This mirrors the database policies so the UI
// never offers a page whose data the role cannot read — but the policies in
// supabase/migrations/…_security_triggers.sql are what actually enforce it.
export type Role = 'founder' | 'manager' | 'team_member' | 'freelancer'

export const ROLE_LABEL: Record<Role, string> = {
  founder: 'Founder', manager: 'Manager', team_member: 'Team member', freelancer: 'Freelancer',
}
export const ROLE_HELP: Record<Role, string> = {
  founder: 'Everything, including money, capital and the team.',
  manager: 'Everything except capital and founder withdrawals. Cannot manage the team.',
  team_member: 'Their own tasks, the campaigns they are on and those production items. No money.',
  freelancer: 'Only the deliverables, tasks and shoots assigned to them.',
}

export interface NavItem { to: string; label: string; kanji: string; roles: readonly Role[]; feature: number }
const ALL: Role[] = ['founder', 'manager', 'team_member', 'freelancer']
const STAFF: Role[] = ['founder', 'manager']

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', kanji: '家', roles: ALL, feature: 9 },
  { to: '/brands', label: 'Brands', kanji: '商', roles: STAFF, feature: 2 },
  { to: '/creators', label: 'Creators', kanji: '人', roles: STAFF, feature: 3 },
  { to: '/campaigns', label: 'Campaigns', kanji: '陣', roles: ['founder', 'manager', 'team_member'], feature: 4 },
  { to: '/production', label: 'Production', kanji: '作', roles: ALL, feature: 5 },
  { to: '/calendar', label: 'Calendar', kanji: '暦', roles: ALL, feature: 5 },
  { to: '/tasks', label: 'Tasks', kanji: '務', roles: ALL, feature: 8 },
  { to: '/money', label: 'Money', kanji: '金', roles: STAFF, feature: 6 },
  { to: '/reports', label: 'Reports', kanji: '報', roles: STAFF, feature: 9 },
  { to: '/ai', label: 'AI Tools', kanji: '智', roles: ['founder', 'manager', 'team_member'], feature: 10 },
  { to: '/settings', label: 'Settings', kanji: '設', roles: ALL, feature: 13 },
]

/** Phone bottom bar: the five most-used pages per role; everything else lives under "More". */
const TABS: Record<Role, string[]> = {
  founder: ['/', '/campaigns', '/production', '/tasks', '/money'],
  manager: ['/', '/campaigns', '/production', '/tasks', '/money'],
  team_member: ['/', '/campaigns', '/production', '/calendar', '/tasks'],
  freelancer: ['/', '/production', '/calendar', '/tasks'],
}

export const navFor = (role: Role) => NAV.filter(n => n.roles.includes(role))
export const tabsFor = (role: Role) => TABS[role].map(p => NAV.find(n => n.to === p)!)
export const moreFor = (role: Role) => navFor(role).filter(n => !TABS[role].includes(n.to))

export function canOpen(role: Role, pathname: string) {
  const item = [...NAV].sort((a, b) => b.to.length - a.to.length)
    .find(n => n.to === '/' ? pathname === '/' : pathname === n.to || pathname.startsWith(n.to + '/'))
  return item ? item.roles.includes(role) : true
}

export const isStaff = (r: Role | null | undefined) => r === 'founder' || r === 'manager'
