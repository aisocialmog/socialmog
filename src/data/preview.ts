// Design preview for features 8–12 (local development without Supabase only).
// Small in-memory tables + stand-ins for the database functions, so the screens
// can be walked through. None of this runs once Supabase is connected.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { istToday } from '../lib/format'
import { addDaysISO } from '../lib/production'
import type { Match } from './db'

type Row = Record<string, any>
const today = istToday()
const ME = '00000000-0000-0000-0000-000000000000', F2 = 'f2', MG = 'mg', ED = 'ed'
const B1 = 'b1', B2 = 'b2'
let seq = 100
const uid = () => `pv-${++seq}`
const now = () => new Date().toISOString()
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString()

const task = (id: string, title: string, o: Row = {}): Row => ({
  id, title, description: null, status: 'todo', priority: 'normal', assignee_id: ME, due_date: today, due_time: null, completed_at: null,
  estimate_hours: 1, recurring_id: null, source: 'manual', brand_id: null, creator_id: null, campaign_id: null, deliverable_id: null, invoice_id: null,
  is_archived: false, created_at: hoursAgo(30), updated_at: hoursAgo(2), created_by: ME, ...o })

export const T: Record<string, Row[]> = {
  team_directory: [
    { id: ME, name: '[Founder 1 name]', role: 'founder', photo_path: null }, { id: F2, name: '[Founder 2 name]', role: 'founder', photo_path: null },
    { id: MG, name: 'Meera (manager)', role: 'manager', photo_path: null }, { id: ED, name: 'Farid (editor)', role: 'team_member', photo_path: null }],
  brands_lite: [{ id: B1, name: 'Chai Sutra (sample)' }, { id: B2, name: 'Neelam Naturals (sample)' }],
  tasks: [
    task('t1', 'Call Rohan about the reel edit', { due_time: '16:00', priority: 'high', brand_id: B1, status: 'in_progress', estimate_hours: 0.5 }),
    task('t2', 'Send weekly report to Chai Sutra', { brand_id: B1, recurring_id: 'r1', estimate_hours: 2 }),
    task('t3', 'Chase Neelam invoice', { due_date: addDaysISO(today, -3), priority: 'urgent', brand_id: B2 }),
    task('t4', 'Collect creator drafts', { assignee_id: F2, due_date: addDaysISO(today, 1), status: 'waiting_client', estimate_hours: 3 }),
    task('t5', 'Book studio for Friday shoot', { assignee_id: F2, due_date: addDaysISO(today, 2), estimate_hours: 1 }),
    task('t6', 'Edit Diwali reel v2', { assignee_id: ED, due_date: addDaysISO(today, 1), priority: 'high', estimate_hours: 6 }),
    task('t7', 'Share brief with creators', { status: 'done', completed_at: hoursAgo(5), due_date: addDaysISO(today, -1) }),
    task('t8', 'Plan December content calendar', { due_date: addDaysISO(today, 4), estimate_hours: 4, priority: 'low' })],
  task_assignees: [['t1', ME], ['t2', ME], ['t3', ME], ['t4', F2], ['t4', ME], ['t5', F2], ['t6', ED], ['t7', ME], ['t8', ME]].map(([task_id, member_id]) => ({ id: uid(), task_id, member_id })),
  task_checklist_items: [
    { id: 'c1', task_id: 't1', title: 'Check the latest cut', is_done: true, position: 0, is_archived: false },
    { id: 'c2', task_id: 't1', title: 'Note the three changes', is_done: false, position: 1, is_archived: false }],
  comments: [{ id: 'cm1', task_id: 't1', body: 'Rohan is free after 3 — @Founder2 can you join?', created_at: hoursAgo(3), created_by: ME, is_archived: false }],
  files: [], time_logs: [{ id: 'l1', member_id: ME, task_id: 't7', started_at: hoursAgo(7), ended_at: hoursAgo(5.5), duration_minutes: 90, source: 'timer' }],
  recurring_tasks: [{ id: 'r1', title: 'Send weekly report to Chai Sutra', description: null, frequency: 'weekly', next_on: addDaysISO(today, 7), due_time: null, priority: 'normal', assignee_id: ME, brand_id: B1, is_paused: false, is_archived: false }],
  notifications: [], wip_limits: [{ id: 'w1', board: 'tasks', column_key: 'in_progress', max_items: 1 }, { id: 'w2', board: 'production', column_key: 'editing', max_items: 4 }],
  andons: [{ id: 'a1', task_id: 't6', deliverable_id: null, campaign_id: null, title: 'Edit Diwali reel v2', reason: 'Raw footage link is dead', unblocker_id: ME, unblocker_name: '[Founder 1 name]',
    raised_by_name: 'Farid (editor)', created_at: hoursAgo(4), resolved_at: null, source: 'person', record_table: 'tasks', record_id: 't6' }],
  kaizen_entries: [
    { id: 'k1', problem: 'Creators sent drafts over WhatsApp and files got lost', change_made: 'One Drive folder per campaign, link in the brief', result: 'No lost drafts in two campaigns', entry_date: addDaysISO(today, -2), created_by: ME, is_archived: false },
    { id: 'k2', problem: 'Invoices went out late', change_made: 'Retainer invoices drafted automatically on billing day', result: 'Sent on day one', entry_date: addDaysISO(today, -9), created_by: F2, is_archived: false }],
  hansei_entries: [{ id: 'h1', member_id: F2, week_start: addDaysISO(today, -((new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7)), went_well: 'Chai Sutra renewed for six months', went_wrong: 'Two reels slipped past go-live', will_change: 'Lock scripts by Wednesday\nOne editor per brand', created_at: now() }],
  task_templates: [
    { id: 'tt1', title: 'Share brief with creators', anchor: 'start', offset_days: 0, is_active: true, is_archived: false },
    { id: 'tt2', title: 'Collect drafts', anchor: 'start', offset_days: 7, is_active: true, is_archived: false },
    { id: 'tt3', title: 'Send report', anchor: 'end', offset_days: 3, is_active: true, is_archived: false }],
  message_drafts: [{ id: 'md1', kind: 'payment_reminder', to_name: 'Neelam Naturals (sample)', channel: 'email', body: 'Hi team, a gentle reminder that invoice SM/26-27/002 for ₹76,700 was due on 3 Nov. Could you share an expected payment date? Thank you!', status: 'draft', created_at: hoursAgo(6), invoice_id: 'i2' }],
  ai_providers: [
    { id: 'p1', name: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.0-flash', secret_name: 'GEMINI_API_KEY', priority: 1, is_enabled: true, daily_limit: 1500 },
    { id: 'p2', name: 'Groq', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', secret_name: 'GROQ_API_KEY', priority: 2, is_enabled: true, daily_limit: 1000 },
    { id: 'p3', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', secret_name: 'OPENROUTER_API_KEY', priority: 3, is_enabled: true, daily_limit: 50 }],
  ai_insights: [], api_clients: [], org_settings: [{ id: 'org', ops_webhook_url: null, ops_allowed_origin: null, min_margin_pct: 15, fee_alert_multiple: 3, overload_hours: 45, overload_gap_pct: 40, hansei_hour: 18, away_after_minutes: 30, books_locked_through: null }],
  presence: [{ id: 'pr1', member_id: ME, status: 'working', message: null, since: hoursAgo(2), expected_back: null }, { id: 'pr2', member_id: F2, status: 'in_shoot', message: 'Chai Sutra shoot', since: hoursAgo(1), expected_back: null }],
}

const name = (id: string | null) => T.team_directory.find(m => m.id === id)?.name ?? null
const taskList = (): Row[] => T.tasks.map(t => {
  const ids = T.task_assignees.filter(a => a.task_id === t.id).map(a => a.member_id)
  const cl = T.task_checklist_items.filter(c => c.task_id === t.id && !c.is_archived)
  const link = t.brand_id ? ['brands', t.brand_id, T.brands_lite.find(b => b.id === t.brand_id)?.name] : [null, null, null]
  return { ...t, is_overdue: !!t.due_date && t.due_date < today && t.status !== 'done', link_table: link[0], link_id: link[1], link_name: link[2],
    assignee_ids: ids, assignee_names: ids.map(name), checklist_total: cl.length, checklist_done: cl.filter(c => c.is_done).length,
    minutes_logged: T.time_logs.filter(l => l.task_id === t.id).reduce((s, l) => s + (l.duration_minutes ?? (Date.now() - Date.parse(l.started_at)) / 60000), 0) }
})
const VIEWS: Record<string, () => Row[]> = {
  task_list: taskList,
  open_andons: () => T.andons.filter(a => !a.resolved_at),
  ai_usage_today: () => T.ai_providers.map(p => ({ provider: p.name, calls: p.priority === 1 ? 12 : 0, failures: 0, tokens: p.priority === 1 ? 8400 : 0, daily_limit: p.daily_limit, remaining: p.daily_limit - (p.priority === 1 ? 12 : 0) })),
}

const act = (id: string, h: number, actor: string, action: string, table: string, record: string, label: string, nv: Row, ov: Row | null = null, fields: string[] = []) =>
  ({ id, created_at: hoursAgo(h), action, table_name: table, record_id: record, changed_fields: fields, old_values: ov, new_values: nv, source: 'app', actor_id: actor, actor_name: name(actor), reason: null, record_name: label })
const FEED = [
  act('f1', 1, ME, 'status_change', 'deliverables', 'd1', 'Diwali Reel', { stage: 'client_review' }, { stage: 'internal_review' }, ['stage']),
  act('f2', 2, F2, 'create', 'receipts', 'r1', 'Chai Sutra (sample)', { amount_received: 15000 }),
  act('f3', 5, ME, 'status_change', 'tasks', 't7', 'Share brief with creators', { status: 'done' }, { status: 'todo' }, ['status']),
  act('f4', 26, MG, 'create', 'tasks', 't5', 'Book studio for Friday shoot', { title: 'Book studio for Friday shoot' }),
  act('f5', 28, F2, 'create', 'expenses', 'e1', 'Ring light rental', { amount: 3000 })]

const kpi = (value: number, prev: number, extra: Row = {}) => ({ value, prev, ...extra })
const month = (i: number) => { const d = new Date(today.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 10) }
const DASH = () => ({
  money: { revenue: kpi(482000, 391000), cash_received: kpi(356000, 402000), expenses: kpi(96000, 88000), net_profit: kpi(214000, 171000), outstanding: kpi(226700, 180000), payouts_pending: kpi(64000, 52000), total_capital: kpi(1250000, 1210000) },
  work: { active_brands: kpi(6, 5), live_campaigns: kpi(3, 2), content_posted: kpi(14, 11), in_production: kpi(9, 9), overdue_tasks: kpi(T.tasks.filter(t => t.due_date < today && t.status !== 'done').length, 2), shoots_this_week: kpi(2, 1) },
  charts: {
    months: Array.from({ length: 12 }, (_, i) => ({ month: month(11 - i), revenue: 220000 + ((i * 37) % 9) * 32000, expenses: 120000 + ((i * 53) % 7) * 21000 })),
    brands: [['Chai Sutra (sample)', 182000], ['Neelam Naturals (sample)', 96000], ['Urban Tadka', 64000], ['Kiko Kids', 41000], ['Loom & Leaf', -8000]].map(([n, p], i) => ({ id: 'b' + (i + 1), name: n, profit: p })),
    weeks: Array.from({ length: 8 }, (_, i) => ({ week: addDaysISO(today, -7 * (7 - i)), posted: [2, 3, 1, 4, 3, 5, 2, 4][i] })),
    funnel: [['idea', 3], ['script', 2], ['shoot_scheduled', 1], ['editing', 5], ['client_review', 2], ['approved', 1], ['live', 14]].map(([stage, n]) => ({ stage, n })),
  },
  lists: {
    shoots: [{ id: 's1', title: 'Chai Sutra — winter menu', sub: '10:00 am · Studio 4, Andheri', link: '/calendar' }],
    due_today: T.tasks.filter(t => t.due_date === today && t.status !== 'done').map(t => ({ id: t.id, title: t.title, sub: name(t.assignee_id), link: `/tasks/${t.id}` })),
    overdue_invoices: [{ id: 'i2', title: 'SM/26-27/002 · Neelam Naturals (sample)', sub: '7 days overdue', amount: 76700, link: '/money/invoices/i2' }],
    renewals: [{ id: B1, title: 'Chai Sutra (sample)', sub: 'Renews in 12 days', amount: 85000, link: `/brands/${B1}` }],
    stuck: [{ id: 'd2', title: 'Kiko Kids unboxing', sub: 'Editing · 5 days', link: '/production/d2' }],
  },
  team: [{ member_id: ME, name: '[Founder 1 name]', role: 'founder', tasks_done: 9, hours_logged: 31.5, records_created: 22, records_updated: 61 }, { member_id: F2, name: '[Founder 2 name]', role: 'founder', tasks_done: 7, hours_logged: 28, records_created: 14, records_updated: 40 }],
  andons: VIEWS.open_andons(),
})

const col = (key: string, label: string, type = 'text') => ({ key, label, type })
const REPORTS: Record<string, () => Row> = {
  pnl: () => ({ sections: [{ title: 'Profit & Loss', columns: [col('line', 'Line'), col('amount', 'Amount', 'money')], rows: [
    { line: 'Revenue', amount: 482000, metric: 'revenue' }, { line: 'Cost of creators', amount: -148000, metric: 'creator_payouts' }, { line: 'Production costs', amount: -24000, metric: 'direct_expenses' },
    { line: 'Gross profit', amount: 310000, bold: true }, { line: 'Overheads', amount: -96000, metric: 'overhead_expenses' }, { line: 'Net profit', amount: 214000, bold: true }] }] }),
  brands: () => ({ sections: [{ title: 'Brands', columns: [col('name', 'Brand'), col('revenue', 'Revenue', 'money'), col('profit', 'Profit', 'money'), col('campaigns', 'Campaigns', 'number'), col('content', 'Content delivered', 'number')],
    rows: [{ id: B1, name: 'Chai Sutra (sample)', revenue: 255000, profit: 182000, campaigns: 2, content: 9, link: `/brands/${B1}` }, { id: B2, name: 'Neelam Naturals (sample)', revenue: 130000, profit: 96000, campaigns: 1, content: 5, link: `/brands/${B2}` }] }] }),
}
const emptyReport = (t: string) => ({ sections: [{ title: t, columns: [col('name', 'Name'), col('value', 'Value', 'number')], rows: [{ name: 'Sample row', value: 1 }] }] })

const RPC: Record<string, (a: Row) => any> = {
  timer_start: a => { RPC.timer_stop({}); T.time_logs.push({ id: uid(), member_id: ME, task_id: a.p_task, started_at: now(), ended_at: null, duration_minutes: null, source: a.p_source ?? 'timer' }); const t = T.tasks.find(x => x.id === a.p_task); if (t?.status === 'todo') t.status = 'in_progress' },
  timer_stop: () => T.time_logs.filter(l => !l.ended_at).forEach(l => { l.ended_at = now(); l.duration_minutes = (Date.now() - Date.parse(l.started_at)) / 60000 }),
  task_activity: a => FEED.filter(f => f.table_name === 'tasks' && f.record_id === a.p_task),
  activity_feed: a => FEED.filter(f => (!a.p_actor || f.actor_id === a.p_actor) && (!a.p_tables || a.p_tables.includes(f.table_name))),
  work_summary: () => DASH().team.concat([{ member_id: ED, name: 'Farid (editor)', role: 'team_member', tasks_done: 4, hours_logged: 22, records_created: 3, records_updated: 18 }]),
  dashboard: DASH,
  records_behind: a => [{ label: 'SM/26-27/004 · Chai Sutra (sample)', sub: 'Invoice', on_date: today, amount: 85000, link: '/money/invoices/i4' }, { label: 'SM/26-27/005 · Neelam Naturals (sample)', sub: 'Invoice', on_date: addDaysISO(today, -4), amount: 65000, link: '/money/invoices/i5' }].map(r => ({ ...r, sub: `${r.sub} · ${a.p_metric}` })),
  report: a => (REPORTS[a.p_name] ?? (() => emptyReport(a.p_name)))(),
  morning_brief: () => ({ shoots: DASH().lists.shoots, tasks: DASH().lists.due_today, payments_expected: DASH().lists.overdue_invoices, payouts_due: [{ id: 'p1', title: 'Farid (freelance editor)', sub: 'Due today', amount: 18000, link: '/money/payouts/due' }],
    ichiban: { title: 'Unblock: Edit Diwali reel v2', sub: 'Farid is blocked — raw footage link is dead', link: '/tasks/t6' } }),
  andon_raise: a => { T.andons.push({ id: uid(), task_id: a.p_table === 'tasks' ? a.p_id : null, title: T.tasks.find(t => t.id === a.p_id)?.title ?? 'Record', reason: a.p_reason, unblocker_id: a.p_unblocker, unblocker_name: name(a.p_unblocker), raised_by_name: name(ME), created_at: now(), resolved_at: null, source: 'person', record_table: a.p_table, record_id: a.p_id }) },
  andon_resolve: a => { const x = T.andons.find(n => n.id === a.p_id); if (x) x.resolved_at = now() },
  workload_week: a => {
    const days = Array.from({ length: 7 }, (_, i) => addDaysISO(a.p_week_start, i))
    const people = [ME, F2, ED].map(id => { const mine = taskList().filter(t => t.assignee_ids.includes(id) && t.status !== 'done')
      const perDay = days.map(d => { const ts = mine.filter(t => t.due_date === d); return { day: d, tasks: ts.length, hours: ts.reduce((s, t) => s + (t.estimate_hours ?? 1), 0) } })
      return { member_id: id, name: name(id), days: perDay, tasks: perDay.reduce((s, d) => s + d.tasks, 0), hours: perDay.reduce((s, d) => s + d.hours, 0) } })
    return { days, people, limit_hours: 45, gap_pct: 40, warnings: [{ member_id: ME, name: name(ME), text: `${name(ME)} has 60% more work than ${name(F2)} this week.` }],
      suggestions: [{ task_id: 't8', title: 'Plan December content calendar', from_name: name(ME), to_id: F2, to_name: name(F2), hours: 4 }] }
  },
  task_move: a => { const t = T.tasks.find(x => x.id === a.p_task); if (t) { t.assignee_id = a.p_to; T.task_assignees = T.task_assignees.filter(x => x.task_id !== a.p_task).concat([{ id: uid(), task_id: a.p_task, member_id: a.p_to }]) } },
  muda_week: () => [
    { kind: 'reopened', title: 'Share brief with creators', detail: 'Reopened twice this week', link: '/tasks/t7', fix: 'Open task' },
    { kind: 'revisions', title: 'Kiko Kids unboxing', detail: '4 revision rounds — limit is 2', link: '/production/d2', fix: 'Open item' },
    { kind: 'stuck', title: 'Urban Tadka recipe reel', detail: 'In Editing for 5 days', link: '/production/d3', fix: 'Open item' },
    { kind: 'overdue_invoice', title: 'SM/26-27/001 · Loom & Leaf', detail: '₹42,000 · 34 days overdue', link: '/money/invoices/i1', fix: 'Chase payment' },
    { kind: 'subscription', title: 'Envato Elements', detail: '₹1,650 a month · not confirmed in use for 90+ days', link: '/money/expenses', fix: 'Still using', id: 'rx1' }],
  subscription_reviewed: () => null,
  hansei_due: () => ({ due: false, week_start: T.hansei_entries[0].week_start }),
  automations_list: () => [
    ['retainer_invoices', 'Retainer invoice drafts', 'Drafts each active retainer’s invoice on its billing day.', 'Daily 6:00 am', '2 drafts created'],
    ['reminders', 'Reminders to us', 'Invoices due and overdue, payouts, shoots, go-lives, renewals, overdue tasks.', 'Daily 8:30 am', '5 reminders sent'],
    ['month_end_close', 'Month-end close', 'Locks last month’s money records and emails the P&L and capital statement.', '1st of the month 7:00 am', 'Locked through 31 Oct 2026'],
    ['jidoka_checks', 'Jidoka checks', 'Stops and lights the andon when margins, fees or the balance check look wrong.', 'Daily 6:30 am', 'Stopped: margin on “Winter skin launch” is 9% (below 15%)']]
    .map(([key, n, d, s, r], i) => ({ key, name: n, description: d, schedule_label: s, is_enabled: true, last_run_at: hoursAgo(3 + i), last_result: r, last_error: i === 3 ? 'Andon raised' : null })),
  run_automation: () => 'Ran in preview — nothing changed.',
  creator_match: () => [
    { creator_id: 'cr1', name: 'Sana Kapoor (sample)', score: 86, tier: 'Micro', city: 'Mumbai', niches: ['food', 'lifestyle'], avg_views: 42000, engagement_rate: 5.2, rate: 18000, past_campaigns: 2, avg_cpv: 0.41 },
    { creator_id: 'cr2', name: 'Dev Malhotra (sample)', score: 74, tier: 'Mid', city: 'Delhi', niches: ['food'], avg_views: 120000, engagement_rate: 3.1, rate: 60000, past_campaigns: 0, avg_cpv: null }],
  ops_key_create: a => { const key = 'smog_ops_' + Math.random().toString(36).slice(2, 14); T.api_clients.push({ id: uid(), name: a.p_name, key_prefix: key.slice(0, 13), created_at: now(), last_used_at: null, revoked_at: null }); return key },
  ops_key_revoke: a => { const k = T.api_clients.find(c => c.id === a.p_id); if (k) k.revoked_at = now() },
  set_presence: a => { const p = T.presence.find(x => x.member_id === ME)!; Object.assign(p, { status: a.p_status, message: a.p_message ?? null, since: now(), expected_back: a.p_expected_back ?? null }) },
  presence_ping: () => null,
  presence_days: () => [{ member_id: ME, name: name(ME), day: today, worked_minutes: 380, break_minutes: 45 }, { member_id: F2, name: name(F2), day: today, worked_minutes: 340, break_minutes: 60 }],
}

const SAMPLE_AI: Record<string, string> = {
  brief_to_plan: 'Objective: drive trial of the winter menu among 22–35 office-goers in Mumbai.\n\nContent pillars\n1. Comfort in a cup\n2. Behind the counter\n3. Office chai breaks\n\nDeliverable plan: 6 reels, 10 stories, 2 carousels over 4 weeks.\n\nSuggested creators: food and lifestyle micro-creators (20k–80k) in Mumbai with 4%+ engagement.',
  script: 'HOOK OPTIONS\n1. “Yeh chai nahi, winter ka hug hai.”\n2. “3 baje ki neend? Iska ilaaj mil gaya.”\n3. “Office wali chai se breakup kar lo.”\n\nSCRIPT\n(0–3s) Close-up: steam rising from the kulhad…',
  ask: 'Chai Sutra was the most profitable brand last month with ₹1,82,000 profit on ₹2,55,000 revenue (71% margin).',
}
const INVOKE: Record<string, (b: Row) => any> = {
  ai_generate: b => b.task === 'notes_to_tasks'
    ? { output: JSON.stringify([{ title: 'Send revised quote to Kiko Kids', assignee: '[Founder 2 name]', due_date: addDaysISO(today, 1) }, { title: 'Book studio for the 14th', assignee: '[Founder 1 name]', due_date: addDaysISO(today, 3) }]), provider: 'Preview', cached: false }
    : b.task === 'creator_reasons' ? { output: JSON.stringify(Object.fromEntries((b.input.creators as Row[]).map(c => [c.creator_id, `Strong ${c.niches?.[0] ?? 'niche'} fit in ${c.city}; rate sits inside the budget.`]))), provider: 'Preview', cached: false }
    : b.task === 'ask' ? { output: SAMPLE_AI.ask, provider: 'Preview', cached: false, rows: [{ brand_name: 'Chai Sutra (sample)', profit: 182000 }], query: { view: 'brand_financials', order_by: 'profit' } }
    : { output: SAMPLE_AI[b.task] ?? `Preview draft for “${b.task}”. Connect Supabase and add a provider key to get real drafts.`, provider: 'Preview', cached: false },
}

const matches = (r: Row, m: Match) => Object.entries(m).every(([k, v]) => (r[k] ?? null) === v)
export const pv = {
  rows(table: string, match: Match, order?: string, asc = true): Row[] {
    const out = (VIEWS[table]?.() ?? T[table] ?? []).filter(r => matches(r, match))
    return order ? [...out].sort((a, b) => (a[order] > b[order] ? 1 : a[order] < b[order] ? -1 : 0) * (asc ? 1 : -1)) : out
  },
  insert(table: string, row: Row): Row {
    const r: Row = { id: uid(), created_at: now(), updated_at: now(), created_by: ME, is_archived: false, ...row }
    if (table === 'tasks') Object.assign(r, { ...task(r.id, r.title), ...r })
    ;(T[table] ??= []).push(r)
    if (table === 'tasks' && r.assignee_id) T.task_assignees.push({ id: uid(), task_id: r.id, member_id: r.assignee_id })
    return r
  },
  update(table: string, id: string, patch: Row) {
    const r = T[table]?.find(x => x.id === id); if (!r) return
    Object.assign(r, patch, { updated_at: now() })
    if (table === 'tasks' && 'status' in patch) r.completed_at = patch.status === 'done' ? now() : null
  },
  del(table: string, match: Match) { T[table] = (T[table] ?? []).filter(r => !matches(r, match)) },
  rpc(fn: string, args: Row): unknown { if (!RPC[fn]) throw new Error(`Preview has no stand-in for ${fn}()`); return RPC[fn](args) ?? null },
  invoke(fn: string, body: Row): unknown { if (!INVOKE[fn]) throw new Error(`Preview has no stand-in for the ${fn} function`); return INVOKE[fn](body) },
}
