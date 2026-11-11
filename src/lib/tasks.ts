// Task labels and the quick-add parser. Pure functions — tested in tests/tasks.test.ts.
import type { Tone } from '../components/ui/kit'
import { addDaysISO } from './production'

export type TaskStatus = 'todo' | 'in_progress' | 'waiting_client' | 'done'
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'waiting_client', 'done']
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', waiting_client: 'Waiting on client', done: 'Done' }
export const TASK_STATUS_KANJI: Record<TaskStatus, string> = { todo: '未', in_progress: '進', waiting_client: '待', done: '済' }

export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent']
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', normal: 'Medium', high: 'High', urgent: 'Urgent' }
export const PRIORITY_TONE: Record<Priority, Tone> = { low: 'quiet', normal: 'quiet', high: 'warm', urgent: 'alert' }
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

export const LINK_PATH: Record<string, string> = { brands: '/brands', campaigns: '/campaigns', deliverables: '/production', invoices: '/money/invoices', creators: '/creators', tasks: '/tasks' }
export const LINK_LABEL: Record<string, string> = { brands: 'Brand', campaigns: 'Campaign', deliverables: 'Production item', invoices: 'Invoice', creators: 'Creator' }

export const formatTime = (t: string | null | undefined) => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`
}
export const formatMinutes = (min: number) => min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`

export interface Named { id: string; name: string }
export interface QuickAdd { title: string; assignee_ids: string[]; brand_id: string | null; due_date: string | null; due_time: string | null; unmatched: string[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "@asha" matches the full name without spaces, or a name that starts with it. */
function find(tag: string, list: Named[]) {
  const t = norm(tag)
  return list.find(x => norm(x.name) === t) ?? list.find(x => norm(x.name.split(' ')[0]) === t) ?? list.find(x => norm(x.name).startsWith(t))
}

/** "Call Rohan about reel edit tomorrow 4pm @Founder2 #BrandX" → title, people, brand, date and time. */
export function parseQuickAdd(text: string, members: Named[], brands: Named[], today: string): QuickAdd {
  const out: QuickAdd = { title: '', assignee_ids: [], brand_id: null, due_date: null, due_time: null, unmatched: [] }
  let s = ' ' + text + ' '
  s = s.replace(/\s@([\w.-]+)/g, (m, tag: string) => {
    const hit = find(tag, members)
    if (!hit) { out.unmatched.push('@' + tag); return m }
    if (!out.assignee_ids.includes(hit.id)) out.assignee_ids.push(hit.id)
    return ' '
  })
  s = s.replace(/\s#([\w.-]+)/g, (m, tag: string) => {
    const hit = find(tag, brands)
    if (!hit) { out.unmatched.push('#' + tag); return m }
    out.brand_id = hit.id
    return ' '
  })
  // time: 4pm, 4:30 pm, 16:00
  s = s.replace(/\s(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)(?=\s)/i, (m, h: string, min: string | undefined, ap: string) => {
    let hr = Number(h); if (hr < 1 || hr > 12) return m
    if (ap.toLowerCase() === 'pm' && hr < 12) hr += 12
    if (ap.toLowerCase() === 'am' && hr === 12) hr = 0
    out.due_time = `${String(hr).padStart(2, '0')}:${min ?? '00'}`
    return ' '
  })
  if (!out.due_time) s = s.replace(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (_m, h: string, min: string) => { out.due_time = `${h.padStart(2, '0')}:${min}`; return ' ' })
  // date: today, tomorrow, a weekday (the next one), "12 dec"
  const dow = new Date(today + 'T00:00:00Z').getUTCDay()
  s = s.replace(/\s(?:on\s+|by\s+)?(today|tonight|tomorrow|tmrw|(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|urday)?|(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)(?=\s)/i,
    (_m, word: string, d: string | undefined, mon: string | undefined) => {
      const w = word.toLowerCase()
      if (d && mon) {
        const y = Number(today.slice(0, 4)), iso = (yr: number) => `${yr}-${String(MONTHS.indexOf(mon.toLowerCase()) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`
        out.due_date = iso(y) < today ? iso(y + 1) : iso(y)
      } else if (w === 'today' || w === 'tonight') out.due_date = today
      else if (w === 'tomorrow' || w === 'tmrw') out.due_date = addDaysISO(today, 1)
      else { const target = DAYS.indexOf(w.slice(0, 3)); out.due_date = addDaysISO(today, ((target - dow + 7) % 7) || 7) }
      return ' '
    })
  if (out.due_time && !out.due_date) out.due_date = today
  out.title = s.replace(/\s+/g, ' ').trim()
  return out
}

/** Weeks in a row (ending this week or last) with at least one entry. `dates` are YYYY-MM-DD. */
export function weekStreak(dates: string[], today: string): number {
  const monday = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return addDaysISO(iso, -((d.getUTCDay() + 6) % 7)) }
  const weeks = new Set(dates.map(monday))
  let w = monday(today), n = 0
  if (!weeks.has(w)) w = addDaysISO(w, -7)      // this week isn't over yet: don't break the streak
  while (weeks.has(w)) { n++; w = addDaysISO(w, -7) }
  return n
}
