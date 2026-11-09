// Creator vocabulary + pure helpers (tiers, counts, filters, CSV import mapping).
export type Tier = 'nano' | 'micro' | 'mid' | 'macro' | 'mega'
export const TIERS: Tier[] = ['nano', 'micro', 'mid', 'macro', 'mega']
export const TIER_LABEL: Record<Tier, string> = { nano: 'Nano', micro: 'Micro', mid: 'Mid', macro: 'Macro', mega: 'Mega' }
export const TIER_RANGE: Record<Tier, string> = { nano: 'under 10K', micro: '10K–100K', mid: '100K–500K', macro: '500K–1M', mega: '1M+' }
/** Same thresholds as public.creator_tier() in the database. */
export function tierFor(followers: number | null | undefined): Tier | null {
  if (followers == null) return null
  if (followers < 10_000) return 'nano'
  if (followers < 100_000) return 'micro'
  if (followers < 500_000) return 'mid'
  if (followers < 1_000_000) return 'macro'
  return 'mega'
}

export type Platform = 'instagram' | 'youtube' | 'moj' | 'josh' | 'linkedin' | 'x'
export const PLATFORMS: Platform[] = ['instagram', 'youtube', 'moj', 'josh', 'linkedin', 'x']
export const PLATFORM_LABEL: Record<string, string> = { instagram: 'Instagram', youtube: 'YouTube', moj: 'Moj', josh: 'Josh', linkedin: 'LinkedIn', x: 'X', other: 'Other' }
export const FOLLOWER_WORD: Record<string, string> = { youtube: 'subscribers', linkedin: 'connections' }
export function profileUrl(platform: string, handle: string): string | null {
  const h = handle.replace(/^@/, '')
  switch (platform) {
    case 'instagram': return `https://instagram.com/${h}`
    case 'youtube': return h.startsWith('UC') ? `https://youtube.com/channel/${h}` : `https://youtube.com/@${h}`
    case 'x': return `https://x.com/${h}`
    case 'linkedin': return `https://linkedin.com/in/${h}`
    case 'moj': return `https://mojapp.in/@${h}`
    case 'josh': return `https://share.myjosh.in/profile/${h}`
    default: return null
  }
}

export type DeliverableType = 'reel' | 'story' | 'post' | 'youtube_video' | 'short' | 'ugc_video' | 'live'
export const RATE_TYPES: DeliverableType[] = ['reel', 'story', 'post', 'youtube_video', 'short', 'ugc_video', 'live']
export const RATE_LABEL: Record<DeliverableType, string> = {
  reel: 'Reel', story: 'Story', post: 'Post', youtube_video: 'YouTube video', short: 'Shorts', ugc_video: 'UGC video', live: 'Live',
}

export const GENDERS = [
  { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'non_binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' }, { value: 'undisclosed', label: 'Prefer not to say' },
] as const
export const LANGUAGES = ['Hindi', 'English', 'Bengali', 'Marathi', 'Telugu', 'Tamil', 'Gujarati', 'Kannada', 'Malayalam', 'Odia', 'Punjabi', 'Assamese', 'Bhojpuri', 'Urdu', 'Haryanvi', 'Rajasthani']
export const CREATOR_STATUS_LABEL: Record<string, string> = { prospect: 'Prospect', active: 'Active', inactive: 'Inactive' }

/** "48.2K", "1.2M", "1.5L", "2 lakh", "1,20,000", "3cr" → number. null if not a number. */
export function parseCount(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null
  let s = String(raw).trim().toLowerCase().replace(/[,\s₹]/g, '').replace(/^rs\.?/, '')
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m|mn|l|lac|lakh|lakhs|cr|crore|crores|b)?\+?$/)
  if (!m) return null
  const n = parseFloat(m[1]); s = m[2] ?? ''
  const mult = s === 'k' ? 1e3 : s === 'm' || s === 'mn' ? 1e6 : ['l', 'lac', 'lakh', 'lakhs'].includes(s) ? 1e5 : ['cr', 'crore', 'crores'].includes(s) ? 1e7 : s === 'b' ? 1e9 : 1
  return Math.round(n * mult)
}
/** 48200 → "48.2K", 1240000 → "1.24M" (follower counts read better this way than lakh). */
export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—'
  const t = (x: number) => x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  if (n >= 1e6) return `${t(n / 1e6)}M`
  if (n >= 1e3) return `${t(n / 1e3)}K`
  return String(n)
}
export function parsePercent(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = parseFloat(String(raw).replace('%', '').trim())
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 1000) / 1000 : null
}
export const phoneKey = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, '').slice(-10); return d || null }
export function cleanHandle(raw: string | null | undefined): string | null {
  let v = (raw ?? '').trim()
  if (!v) return null
  v = v.replace(/^https?:\/\/(www\.|m\.)?[^/]+\/(channel\/|in\/|profile\/)?/i, '').replace(/^@/, '').replace(/\/+$/, '')
  return v.split(/[/?#\s]/)[0]?.replace(/^@/, '') || null
}
export const splitList = (raw: unknown) => String(raw ?? '').split(/[,;|/]+/).map(s => s.trim()).filter(Boolean)

// ─── List filters (also what a saved view stores) ────────────
export interface CreatorFilters {
  q: string; niches: string[]; city: string; language: string; tiers: Tier[]; platform: string
  followersMin: string; followersMax: string; rateType: DeliverableType; rateMin: string; rateMax: string
  minRating: number; showBlacklisted: boolean
}
export const EMPTY_FILTERS: CreatorFilters = {
  q: '', niches: [], city: '', language: '', tiers: [], platform: '', followersMin: '', followersMax: '',
  rateType: 'reel', rateMin: '', rateMax: '', minRating: 0, showBlacklisted: false,
}
export interface FilterableCreator {
  name: string; city: string | null; languages: string[]; niches: string[]; tier: Tier | null; platforms: string[] | null
  max_followers: number | null; rating: number | null; is_blacklisted: boolean; handles: string[] | null
  manager_agency?: string | null
}
export function activeFilterCount(f: CreatorFilters) {
  return [f.niches.length > 0, !!f.city, !!f.language, f.tiers.length > 0, !!f.platform, !!(f.followersMin || f.followersMax),
    !!(f.rateMin || f.rateMax), f.minRating > 0, f.showBlacklisted].filter(Boolean).length
}
export function applyCreatorFilters<T extends FilterableCreator>(rows: T[], f: CreatorFilters): T[] {
  const q = f.q.trim().toLowerCase().replace(/^@/, '')
  const fMin = parseCount(f.followersMin), fMax = parseCount(f.followersMax)
  const rMin = parseCount(f.rateMin), rMax = parseCount(f.rateMax)
  return rows.filter(c => {
    if (!f.showBlacklisted && c.is_blacklisted) return false
    if (q && ![c.name, c.city, c.manager_agency, ...(c.handles ?? []).map(h => h.split(':')[1])].some(x => x?.toLowerCase().includes(q))) return false
    if (f.niches.length && !f.niches.every(n => c.niches.some(x => x.toLowerCase() === n.toLowerCase()))) return false
    if (f.city && c.city?.toLowerCase() !== f.city.toLowerCase()) return false
    if (f.language && !c.languages.some(l => l.toLowerCase() === f.language.toLowerCase())) return false
    if (f.tiers.length && (!c.tier || !f.tiers.includes(c.tier))) return false
    if (f.platform && !(c.platforms ?? []).includes(f.platform)) return false
    if (fMin != null && (c.max_followers ?? -1) < fMin) return false
    if (fMax != null && (c.max_followers == null || c.max_followers > fMax)) return false
    if (rMin != null || rMax != null) {
      const r = (c as unknown as Record<string, unknown>)[`rate_${f.rateType}`] as number | null | undefined
      if (r == null) return false
      if (rMin != null && Number(r) < rMin) return false
      if (rMax != null && Number(r) > rMax) return false
    }
    if (f.minRating && (c.rating ?? 0) < f.minRating) return false
    return true
  })
}

// ─── CSV import ───────────────────────────────────────────────
/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF, BOM). Also accepts ; or tab separated files. */
export function parseCSV(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = [',', ';', '\t'].map(s => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c.trim() !== '')) rows.push(row)
  return rows
}

export interface ImportField { key: string; label: string; group: string; hints: RegExp }
const P = (p: string, label: string, hint: string): ImportField[] => [
  { key: `${p}_handle`, label: `${label} handle / URL`, group: label, hints: new RegExp(`^(${hint})\\s*(handle|id|username|url|link|profile)?$`) },
  { key: `${p}_followers`, label: `${label} ${p === 'youtube' ? 'subscribers' : 'followers'}`, group: label, hints: new RegExp(`^(${hint})\\s*(followers|subs|subscribers|fans)$|^(${hint})\\s*(count)$`) },
  { key: `${p}_avg_views`, label: `${label} average views`, group: label, hints: new RegExp(`^(${hint})\\s*(avg|average)\\s*views?$|^(${hint})\\s*views$`) },
  { key: `${p}_er`, label: `${label} engagement %`, group: label, hints: new RegExp(`^(${hint})\\s*(er|engagement|engagement rate)%?$`) },
]
export const IMPORT_FIELDS: ImportField[] = [
  { key: 'name', label: 'Name *', group: 'Creator', hints: /^(name|creator|creator name|full name|influencer|influencer name)$/ },
  { key: 'phone', label: 'Phone', group: 'Creator', hints: /^(phone|mobile|contact|phone number|mobile number|contact number)$/ },
  { key: 'whatsapp', label: 'WhatsApp', group: 'Creator', hints: /^(whatsapp|wa|whatsapp number)$/ },
  { key: 'email', label: 'Email', group: 'Creator', hints: /^(email|e-mail|mail|email id)$/ },
  { key: 'city', label: 'City', group: 'Creator', hints: /^(city|location|town|based in)$/ },
  { key: 'state', label: 'State', group: 'Creator', hints: /^(state)$/ },
  { key: 'gender', label: 'Gender', group: 'Creator', hints: /^(gender|sex)$/ },
  { key: 'languages', label: 'Languages', group: 'Creator', hints: /^(languages?|lang)$/ },
  { key: 'niches', label: 'Niches', group: 'Creator', hints: /^(niches?|category|categories|genre|tags?|vertical)$/ },
  { key: 'rating', label: 'Rating (1–5)', group: 'Creator', hints: /^(rating|stars|score)$/ },
  { key: 'notes', label: 'Notes', group: 'Creator', hints: /^(notes?|remarks?|comments?)$/ },
  { key: 'manager_name', label: 'Manager name', group: 'Manager', hints: /^(manager|manager name|agency contact)$/ },
  { key: 'manager_phone', label: 'Manager phone', group: 'Manager', hints: /^(manager phone|manager contact|manager mobile)$/ },
  { key: 'manager_email', label: 'Manager email', group: 'Manager', hints: /^(manager email)$/ },
  ...P('instagram', 'Instagram', 'instagram|insta|ig'),
  ...P('youtube', 'YouTube', 'youtube|yt'),
  ...P('moj', 'Moj', 'moj'), ...P('josh', 'Josh', 'josh'), ...P('linkedin', 'LinkedIn', 'linkedin'), ...P('x', 'X', 'x|twitter'),
  ...RATE_TYPES.map(t => ({ key: `rate_${t}`, label: `Rate: ${RATE_LABEL[t]}`, group: 'Rate card',
    hints: new RegExp(`^(rate|price|cost|charges?)?\\s*[-:(]?\\s*(${RATE_LABEL[t].toLowerCase()}|${t.replace('_', ' ')})s?\\s*(rate|price|cost|charges?)?\\)?$`) })),
]
const norm = (h: string) => h.toLowerCase().replace(/[_.]+/g, ' ').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()
/** Best-guess mapping from CSV headers to fields (each field used once). */
export function guessMapping(headers: string[]): (string | '')[] {
  const used = new Set<string>()
  return headers.map(h => {
    const n = norm(h)
    const f = IMPORT_FIELDS.find(x => !used.has(x.key) && x.hints.test(n))
    if (f) { used.add(f.key); return f.key }
    return ''
  })
}

export interface ImportRow {
  name: string; phone: string | null; whatsapp: string | null; email: string | null; city: string | null; state: string | null
  gender: string | null; languages: string[]; niches: string[]; rating: number | null; notes: string | null
  manager_name: string | null; manager_phone: string | null; manager_email: string | null
  platforms: { platform: string; handle: string; followers: number | null; avg_views: number | null; engagement_rate: number | null }[]
  rates: Partial<Record<DeliverableType, number>>
  raw: Record<string, string>
}
export interface PreparedRow { line: number; row: ImportRow; problems: string[] }

const GENDER_MAP: Record<string, string> = { f: 'female', female: 'female', woman: 'female', m: 'male', male: 'male', man: 'male', 'non-binary': 'non_binary', nonbinary: 'non_binary', other: 'other' }
/** Turn CSV rows into import rows using the chosen mapping, with per-row problems. */
export function prepareRows(headers: string[], data: string[][], mapping: (string | '')[]): PreparedRow[] {
  return data.map((cells, i) => {
    const get = (k: string) => { const idx = mapping.indexOf(k); return idx >= 0 ? (cells[idx] ?? '').trim() : '' }
    const problems: string[] = []
    const name = get('name')
    if (!name) problems.push('Name is missing')
    const email = get('email') || null
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push(`Email “${email}” looks wrong`)
    const ratingRaw = get('rating'); let rating: number | null = null
    if (ratingRaw) { rating = Math.round(Number(ratingRaw)); if (!(rating >= 1 && rating <= 5)) { problems.push('Rating must be 1–5'); rating = null } }
    const platforms: ImportRow['platforms'] = []
    for (const p of PLATFORMS) {
      const handle = cleanHandle(get(`${p}_handle`))
      const fRaw = get(`${p}_followers`), vRaw = get(`${p}_avg_views`), eRaw = get(`${p}_er`)
      if (!handle) { if (fRaw || vRaw) problems.push(`${PLATFORM_LABEL[p]} numbers given without a handle`); continue }
      const followers = parseCount(fRaw), avg_views = parseCount(vRaw), engagement_rate = parsePercent(eRaw)
      if (fRaw && followers == null) problems.push(`${PLATFORM_LABEL[p]} followers “${fRaw}” isn’t a number`)
      if (eRaw && engagement_rate == null) problems.push(`${PLATFORM_LABEL[p]} engagement “${eRaw}” isn’t a percentage`)
      platforms.push({ platform: p, handle, followers, avg_views, engagement_rate })
    }
    const rates: ImportRow['rates'] = {}
    for (const t of RATE_TYPES) {
      const r = get(`rate_${t}`); if (!r) continue
      const n = parseCount(r); if (n == null) problems.push(`${RATE_LABEL[t]} rate “${r}” isn’t a number`); else rates[t] = n
    }
    const g = get('gender').toLowerCase()
    return {
      line: i + 2, problems,
      row: {
        name, phone: get('phone') || null, whatsapp: get('whatsapp') || null, email, city: get('city') || null, state: get('state') || null,
        gender: GENDER_MAP[g] ?? (g ? 'other' : null), languages: splitList(get('languages')), niches: splitList(get('niches')),
        rating, notes: get('notes') || null, manager_name: get('manager_name') || null, manager_phone: get('manager_phone') || null,
        manager_email: get('manager_email') || null, platforms, rates,
        raw: Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ''])),
      },
    }
  })
}

/** Duplicates inside the file itself (same phone or same platform handle). Returns line → reason. */
export function duplicatesWithinFile(rows: PreparedRow[]): Map<number, string> {
  const seen = new Map<string, number>(); const out = new Map<number, string>()
  for (const r of rows) {
    const keys = [phoneKey(r.row.phone) && `phone:${phoneKey(r.row.phone)}`, ...r.row.platforms.map(p => `${p.platform}:${p.handle.toLowerCase()}`)].filter(Boolean) as string[]
    for (const k of keys) {
      if (seen.has(k)) { out.set(r.line, `Same ${k.startsWith('phone') ? 'phone' : 'handle'} as row ${seen.get(k)}`); break }
    }
    for (const k of keys) if (!seen.has(k)) seen.set(k, r.line)
  }
  return out
}
