// Production vocabulary + calendar helpers.
export type Stage = 'idea' | 'script' | 'script_approved' | 'pre_production' | 'shoot_scheduled' | 'shot' | 'editing' | 'internal_review'
  | 'client_review' | 'revisions' | 'approved' | 'scheduled' | 'live' | 'cancelled'
export const STAGES: Stage[] = ['idea', 'script', 'script_approved', 'pre_production', 'shoot_scheduled', 'shot', 'editing', 'internal_review', 'client_review', 'revisions', 'approved', 'scheduled', 'live']
export const STAGE_LABEL: Record<Stage, string> = {
  idea: 'Idea', script: 'Script', script_approved: 'Script approved', pre_production: 'Pre-production', shoot_scheduled: 'Shoot scheduled',
  shot: 'Shot', editing: 'Editing', internal_review: 'Internal review', client_review: 'Client review', revisions: 'Revisions',
  approved: 'Approved', scheduled: 'Scheduled', live: 'Posted', cancelled: 'Cancelled',
}
export const STAGE_KANJI: Record<Stage, string> = {
  idea: '想', script: '筆', script_approved: '認', pre_production: '備', shoot_scheduled: '予', shot: '撮', editing: '編',
  internal_review: '検', client_review: '客', revisions: '直', approved: '承', scheduled: '待', live: '公', cancelled: '止',
}
export type Format = 'reel' | 'short' | 'youtube_video' | 'ad_film' | 'photo_shoot' | 'carousel' | 'story_set' | 'ugc_video'
export const FORMATS: Format[] = ['reel', 'short', 'youtube_video', 'ad_film', 'photo_shoot', 'carousel', 'story_set', 'ugc_video']
export const FORMAT_LABEL: Record<string, string> = {
  reel: 'Reel', short: 'Short', youtube_video: 'YouTube video', ad_film: 'Ad film', photo_shoot: 'Photo shoot', carousel: 'Carousel',
  story_set: 'Story set', ugc_video: 'UGC', story: 'Story', post: 'Post', live: 'Live', photo: 'Photo', blog: 'Blog', other: 'Other',
}
export type PersonRole = 'scriptwriter' | 'talent' | 'shooter' | 'editor'
export const ROLES: PersonRole[] = ['scriptwriter', 'talent', 'shooter', 'editor']
export const ROLE_LABEL: Record<PersonRole, string> = { scriptwriter: 'Scriptwriter', talent: 'Creator / talent', shooter: 'Shooter', editor: 'Editor' }

/** Brand colours: palette-only steps; each brand keeps the slot it was given when created.
 *  The brand name/initial always shows beside the colour, so identity is never colour-alone. */
export const BRAND_COLORS = ['#E3793A', '#B7282E', '#F2A93B', '#8F877F', '#F2E8D5', '#5c5752'] as const
/** Colour for a brand's stored slot (brands.calendar_color, fixed at creation). */
export function brandColor(slot: number | null | undefined): string {
  return BRAND_COLORS[((slot ?? 3) % BRAND_COLORS.length + BRAND_COLORS.length) % BRAND_COLORS.length]
}
/** Text colour that stays readable on that brand colour. */
export const onBrandColor = (c: string) => (c === '#B7282E' || c === '#5c5752' ? '#F2E8D5' : '#1E1C1A')

// ─── dates (ISO yyyy-mm-dd, Monday-first weeks) ──────────────
const toISO = (d: Date) => d.toISOString().slice(0, 10)
export const addDaysISO = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return toISO(d) }
export const weekStart = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return addDaysISO(iso, -((d.getUTCDay() + 6) % 7)) }
/** The 6×7 (or 5×7) grid of days covering a month, starting Monday. */
export function monthGrid(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const start = weekStart(first)
  const last = toISO(new Date(Date.UTC(year, month, 0)))
  const days: string[] = []
  for (let d = start; d <= last || days.length % 7 !== 0; d = addDaysISO(d, 1)) days.push(d)
  return days
}
export const weekDays = (iso: string) => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart(iso), i))
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Keep only simple formatting in scripts (no scripts, styles, links, attributes). */
const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE'])
export function sanitizeScript(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '')
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      walk(child)
      if (!ALLOWED.has(child.tagName)) { child.replaceWith(...[...child.childNodes]); continue }
      for (const a of [...child.attributes]) child.removeAttribute(a.name)
    }
  }
  const root = doc.body.firstElementChild!
  walk(root)
  return root.innerHTML
}
export const plainText = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h3)>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
