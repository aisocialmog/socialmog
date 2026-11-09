// Time-of-day sky, seasons and greetings — all from the real clock in IST.
import { TZ } from './format'

export type SkyPhase = 'dawn' | 'day' | 'sunset' | 'night'
export type Season = 'haru' | 'natsu' | 'aki' | 'fuyu'

function istParts(now: Date) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23', month: 'numeric' }).formatToParts(now)
  return { hour: Number(p.find(x => x.type === 'hour')!.value), month: Number(p.find(x => x.type === 'month')!.value) }
}

/** dawn 5–9, day 9–16, sunset 16–19, night 19–5 (IST) */
export function skyPhase(now = new Date()): SkyPhase {
  const { hour } = istParts(now)
  if (hour >= 5 && hour < 9) return 'dawn'
  if (hour >= 9 && hour < 16) return 'day'
  if (hour >= 16 && hour < 19) return 'sunset'
  return 'night'
}

/** Mar–May sakura, Jun–Aug fireflies, Sep–Nov momiji, Dec–Feb snow */
export function season(now = new Date()): Season {
  const { month } = istParts(now)
  if (month >= 3 && month <= 5) return 'haru'
  if (month >= 6 && month <= 8) return 'natsu'
  if (month >= 9 && month <= 11) return 'aki'
  return 'fuyu'
}

export const SEASON_NAMES: Record<Season, { kanji: string; en: string }> = {
  haru: { kanji: '春', en: 'Spring' }, natsu: { kanji: '夏', en: 'Summer' },
  aki: { kanji: '秋', en: 'Autumn' }, fuyu: { kanji: '冬', en: 'Winter' },
}

/** Ohayō before noon, Konnichiwa until 5 pm, Konbanwa after. */
export function greeting(now = new Date()): { romaji: string; kana: string } {
  const { hour } = istParts(now)
  if (hour >= 4 && hour < 12) return { romaji: 'Ohayō', kana: 'おはよう' }
  if (hour >= 12 && hour < 17) return { romaji: 'Konnichiwa', kana: 'こんにちは' }
  return { romaji: 'Konbanwa', kana: 'こんばんは' }
}
