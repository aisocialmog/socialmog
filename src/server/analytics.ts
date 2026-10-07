/**
 * Weekly influencer analytics: snapshots (manual, CSV, Instagram API), week-over-week and
 * rolling 4-week comparisons, observed findings vs hypotheses, three recommended actions,
 * and the scheduled Monday run. Numbers are computed here; AI only writes narrative.
 * Missing data stays null and is shown as "unavailable" — nothing is estimated.
 */
import type { Express, Request } from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { addDays, formatDate, isIsoDate, partsInTz, weekStart } from '../shared/dates.ts';
import { mean, median, pctChange } from '../shared/calc.ts';
import { formatNumberIN } from '../shared/money.ts';
import { all, audit, decode, get, HttpError, insert, run, tx, update, type Db, type Row, type User } from './db.ts';
import { founders, notify, requireCap, requireInternal } from './app.ts';
import { today } from './finance.ts';
import { enqueue, onTick, registerJob } from './jobs.ts';

export const METRICS: { key: string; label: string }[] = [
  { key: 'followers_end', label: 'Followers (end of week)' },
  { key: 'follower_change', label: 'Follower change' },
  { key: 'posts', label: 'Posts published' },
  { key: 'views', label: 'Views' },
  { key: 'reach', label: 'Reach (accounts)' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
  { key: 'engagement_rate', label: 'Engagement rate %' },
  { key: 'profile_visits', label: 'Profile visits' },
  { key: 'website_clicks', label: 'Website clicks' },
  { key: 'paid_views', label: 'Paid views' },
];
export const INPUT_KEYS = ['followers_start', 'followers_end', 'posts', 'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'engagement_rate', 'profile_visits', 'website_clicks', 'avg_views', 'median_views', 'paid_views', 'paid_reach'];

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Derived metrics; null where the inputs are unavailable. */
export function enrich(m: Row): Row {
  const out: Row = { ...m };
  out.follower_change = num(m.followers_end) !== null && num(m.followers_start) !== null ? m.followers_end - m.followers_start : null;
  if (num(m.engagement_rate) === null) {
    const parts = ['likes', 'comments', 'shares', 'saves'].map((k) => num(m[k]));
    const base = num(m.reach) ?? num(m.views);
    out.engagement_rate = parts.every((p) => p !== null) && base ? Math.round(((parts as number[]).reduce((a, b) => a + b, 0) / base) * 10000) / 100 : null;
    out.engagement_basis = out.engagement_rate === null ? null : num(m.reach) ? 'interactions ÷ reach' : 'interactions ÷ views';
  }
  return out;
}

function snapshots(db: Db, influencerId: number, platform?: string): Row[] {
  return all(db, `SELECT * FROM analytics_snapshots WHERE influencer_id = ? ${platform ? 'AND platform = ?' : ''} AND archived_at IS NULL ORDER BY period_start DESC`, influencerId, ...(platform ? [platform] : []))
    .map((s) => ({ ...decode('analytics_snapshots', s)!, metrics: enrich(decode('analytics_snapshots', s)!.metrics ?? {}) }));
}

export function upsertSnapshot(db: Db, user: User | null, v: { influencer_id: number; platform: string; period_start: string; metrics: Row; source: string; notes?: string }): number {
  if (!isIsoDate(v.period_start)) throw new HttpError(400, 'Week start must be a date');
  const start = weekStart(v.period_start);
  if (!get(db, 'SELECT id FROM influencers WHERE id = ?', v.influencer_id)) throw new HttpError(400, 'Unknown influencer');
  const metrics: Row = {};
  for (const k of INPUT_KEYS) {
    const n = num(v.metrics?.[k]);
    if (n !== null && n < 0 && k !== 'follower_change') throw new HttpError(400, `${k} cannot be negative`);
    metrics[k] = n;
  }
  const existing = get(db, 'SELECT * FROM analytics_snapshots WHERE influencer_id = ? AND platform = ? AND period_start = ?', v.influencer_id, v.platform, start);
  if (existing) {
    // Keep values that this update does not provide (e.g. manual reach added to an API snapshot).
    // An archived snapshot (e.g. from an undone import) contributes nothing.
    const prev = existing.archived_at ? {} : JSON.parse(existing.metrics ?? '{}');
    const merged = Object.fromEntries(INPUT_KEYS.map((k) => [k, metrics[k] ?? prev[k] ?? null]));
    const sources = new Set(existing.archived_at ? [] : String(existing.source ?? '').split(' + ').filter(Boolean));
    sources.add(v.source);
    update(db, 'analytics_snapshots', existing.id, { metrics: merged, source: [...sources].join(' + '), notes: v.notes ?? existing.notes, archived_at: null });
    audit(db, user?.id ?? null, 'update', 'analytics_snapshots', existing.id, JSON.parse(existing.metrics ?? '{}'), merged);
    return existing.id;
  }
  const id = insert(db, 'analytics_snapshots', { influencer_id: v.influencer_id, platform: v.platform, period_start: start, period_end: addDays(start, 6), metrics, source: v.source, notes: v.notes ?? null, created_by: user?.id ?? null });
  audit(db, user?.id ?? null, 'create', 'analytics_snapshots', id, null, metrics);
  return id;
}

// ---------------------------------------------------------------- weekly report

export interface ReportContent {
  period: { start: string; end: string };
  platform: string;
  source: string | null;
  updated_at: string | null;
  metrics: Row[];
  median_views: { value: number | null; basis: string };
  avg_views: number | null;
  organic_vs_paid: Row | null;
  top_content: Row[];
  weak_content: Row[];
  observations: string[];
  patterns: string[];
  hypotheses: string[];
  recommendations: { action: string; rationale: string; metric: string }[];
  recommendations_source: 'ai' | 'rules';
  previous_review: { action: string; outcome: string }[];
  flags: { level: 'high' | 'medium' | 'low'; text: string }[];
  summary: string;
  ai: { status: string; model?: string; error?: string; generated_at?: string };
}

const pct = (n: number | null) => (n === null ? 'unavailable' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);

export function analyseWeek(db: Db, influencerId: number, periodStart: string): ReportContent {
  const start = weekStart(periodStart);
  const end = addDays(start, 6);
  const inf = get(db, 'SELECT name FROM influencers WHERE id = ?', influencerId);
  if (!inf) throw new HttpError(404, 'Influencer not found');
  const allSnaps = snapshots(db, influencerId);
  const platform = allSnaps.find((s) => s.period_start === start)?.platform ?? allSnaps[0]?.platform ?? 'instagram';
  const snaps = allSnaps.filter((s) => s.platform === platform);
  const cur = snaps.find((s) => s.period_start === start) ?? null;
  const prev = snaps.find((s) => s.period_start === addDays(start, -7)) ?? null;
  const baseline = snaps.filter((s) => s.period_start < start && s.period_start >= addDays(start, -28));
  const flags: ReportContent['flags'] = [];
  if (!cur) flags.push({ level: 'high', text: `No ${platform} data recorded for the week of ${formatDate(start)}` });
  if (baseline.length < 4) flags.push({ level: 'low', text: `Baseline uses ${baseline.length} of 4 prior weeks` });

  const metrics = METRICS.map((m) => {
    const c = num(cur?.metrics[m.key]);
    const p = num(prev?.metrics[m.key]);
    const b = mean(baseline.map((s) => num(s.metrics[m.key])));
    const vsBase = pctChange(c, b);
    if (c !== null && vsBase !== null && Math.abs(vsBase) >= 50 && !['posts', 'follower_change'].includes(m.key)) flags.push({ level: 'medium', text: `${m.label} ${pct(vsBase)} vs 4-week baseline — unusually large change; check the data` });
    return { key: m.key, label: m.label, current: c, previous: p, change_pct: pctChange(c, p), baseline: b === null ? null : Math.round(b * 100) / 100, baseline_weeks: baseline.filter((s) => num(s.metrics[m.key]) !== null).length, change_vs_baseline_pct: vsBase };
  });
  const missing = cur ? METRICS.filter((m) => num(cur.metrics[m.key]) === null && !['paid_views', 'follower_change'].includes(m.key)).map((m) => m.label) : [];
  if (missing.length) flags.push({ level: 'low', text: `Unavailable this week: ${missing.join(', ')}` });

  const posts = all(db, `SELECT * FROM posts WHERE influencer_id = ? AND platform = ? AND archived_at IS NULL AND substr(published_at, 1, 10) BETWEEN ? AND ?`, influencerId, platform, start, end).map((p) => decode('posts', p)!);
  const withViews = posts.filter((p) => num(p.metrics?.views) !== null);
  const er = (p: Row) => {
    const parts = ['likes', 'comments', 'shares', 'saves'].map((k) => num(p.metrics?.[k]) ?? 0);
    const base = num(p.metrics?.reach) ?? num(p.metrics?.views);
    return base ? Math.round((parts.reduce((a, b) => a + b, 0) / base) * 10000) / 100 : null;
  };
  const ranked = [...withViews].sort((a, b) => b.metrics.views - a.metrics.views);
  const item = (p: Row) => ({ id: p.id, permalink: p.permalink, format: p.format, topic: p.topic, duration_sec: p.duration_sec, published_at: p.published_at, views: p.metrics.views, engagement_rate: er(p), promotion: p.promotion ?? 'unknown', source: p.source, metrics_as_of: p.metrics_as_of });
  const medianFromPosts = median(withViews.map((p) => p.metrics.views));
  const medianViews = medianFromPosts !== null ? { value: medianFromPosts, basis: `median of ${withViews.length} posts published this week` } : num(cur?.metrics.median_views) !== null ? { value: cur!.metrics.median_views, basis: 'as entered for the week' } : { value: null, basis: 'unavailable — add per-post views to compute' };
  const avgViews = withViews.length ? Math.round(mean(withViews.map((p) => p.metrics.views))!) : num(cur?.metrics.avg_views);

  let organicVsPaid: Row | null = null;
  if (posts.some((p) => p.promotion === 'paid' || p.promotion === 'organic') || num(cur?.metrics.paid_views) !== null) {
    const sumBy = (k: string) => withViews.filter((p) => (p.promotion ?? 'unknown') === k).reduce((s, p) => s + p.metrics.views, 0);
    organicVsPaid = { organic_post_views: sumBy('organic'), paid_post_views: sumBy('paid'), unknown_post_views: sumBy('unknown'), paid_views_reported: num(cur?.metrics.paid_views) };
  }

  const observations: string[] = [];
  const views = metrics.find((m) => m.key === 'views')!;
  const fol = metrics.find((m) => m.key === 'follower_change')!;
  const eng = metrics.find((m) => m.key === 'engagement_rate')!;
  if (views.current !== null) observations.push(`Views ${formatNumberIN(views.current)} (${views.previous === null ? 'no previous week recorded' : `${pct(views.change_pct)} vs last week`}${views.baseline_weeks ? `, ${pct(views.change_vs_baseline_pct)} vs ${views.baseline_weeks}-week average` : ''}).`);
  if (fol.current !== null) observations.push(`Followers ${fol.current >= 0 ? 'grew' : 'fell'} by ${formatNumberIN(Math.abs(fol.current))} to ${formatNumberIN(metrics[0].current)}.`);
  if (eng.current !== null) observations.push(`Engagement rate ${eng.current}% (${pct(eng.change_vs_baseline_pct)} vs baseline).`);
  if (ranked.length >= 2) observations.push(`Strongest post had ${(ranked[0].metrics.views / Math.max(1, ranked[ranked.length - 1].metrics.views)).toFixed(1)}× the views of the weakest.`);
  if (organicVsPaid?.paid_post_views) observations.push(`${formatNumberIN(organicVsPaid.paid_post_views)} views came from posts marked as paid promotion; they are excluded from organic comparisons.`);

  // Patterns only where each group has at least 2 posts (otherwise a "pattern" is one data point).
  const patterns: string[] = [];
  const history = all(db, `SELECT * FROM posts WHERE influencer_id = ? AND platform = ? AND archived_at IS NULL AND substr(published_at, 1, 10) BETWEEN ? AND ? AND (promotion IS NULL OR promotion <> 'paid')`, influencerId, platform, addDays(start, -56), end)
    .map((p) => decode('posts', p)!).filter((p) => num(p.metrics?.views) !== null);
  const groupBy = (label: string, key: (p: Row) => string | null) => {
    const groups = new Map<string, number[]>();
    for (const p of history) {
      const k = key(p);
      if (!k) continue;
      groups.set(k, [...(groups.get(k) ?? []), p.metrics.views]);
    }
    const ok = [...groups.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => ({ k, med: median(v)!, n: v.length })).sort((a, b) => b.med - a.med);
    if (ok.length >= 2) patterns.push(`${label}: "${ok[0].k}" posts had median ${formatNumberIN(ok[0].med)} views (${ok[0].n} posts) vs "${ok[ok.length - 1].k}" at ${formatNumberIN(ok[ok.length - 1].med)} (${ok[ok.length - 1].n} posts), organic posts over the last 8 weeks.`);
  };
  groupBy('Format', (p) => p.format);
  groupBy('Topic', (p) => p.topic);
  groupBy('Duration', (p) => (p.duration_sec == null ? null : p.duration_sec <= 30 ? '≤30s' : p.duration_sec <= 60 ? '31–60s' : '>60s'));
  groupBy('Posting time (IST)', (p) => {
    if (!p.published_at) return null;
    const h = partsInTz(new Date(p.published_at)).hour;
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  });

  // Rule-based hypotheses and actions (replaced by AI narrative when connected). Labelled as hypotheses.
  const hypotheses: string[] = [];
  const recs: ReportContent['recommendations'] = [];
  if (patterns[0]) hypotheses.push(`Hypothesis: the ${patterns[0].split(':')[0].toLowerCase()} difference may be driving results, but the sample is small and other factors (topic, timing, trends) are not controlled.`);
  if (views.change_vs_baseline_pct !== null && views.change_vs_baseline_pct < -15) {
    hypotheses.push('Hypothesis: lower views could reflect fewer posts, weaker hooks, or posting time; the data does not show which.');
    recs.push({ action: 'Re-test the best-performing format from the last 8 weeks with a stronger first 3 seconds', rationale: `Views are ${pct(views.change_vs_baseline_pct)} vs baseline`, metric: 'views' });
  }
  if (ranked[0]) recs.push({ action: `Make a follow-up to the top post (${ranked[0].topic ?? ranked[0].format ?? 'top post'})`, rationale: `It reached ${formatNumberIN(ranked[0].metrics.views)} views, the best this week`, metric: 'views' });
  const postsM = metrics.find((m) => m.key === 'posts')!;
  if (postsM.current !== null && postsM.baseline !== null && postsM.current < postsM.baseline) recs.push({ action: `Return to at least ${Math.round(postsM.baseline)} posts next week`, rationale: `Published ${postsM.current} vs ${postsM.baseline} average`, metric: 'posts' });
  if (eng.current !== null && eng.change_vs_baseline_pct !== null && eng.change_vs_baseline_pct < -10) recs.push({ action: 'Add a clear call-to-comment or save prompt in captions', rationale: `Engagement rate ${pct(eng.change_vs_baseline_pct)} vs baseline`, metric: 'engagement_rate' });
  if (missing.length) recs.push({ action: `Fill the missing data (${missing.slice(0, 3).join(', ')}) so next week's comparison is complete`, rationale: 'Comparisons need the same metrics every week', metric: 'data completeness' });
  recs.push({ action: 'Keep posting at the best-performing time slot and log topic/format for every post', rationale: 'Pattern detection needs at least 2 posts per group', metric: 'posts' });
  while (recs.length < 3) recs.push({ action: 'Review audience questions in comments and turn the most common one into a post', rationale: 'Low-effort idea grounded in audience demand', metric: 'comments' });

  const prevReport = get(db, `SELECT content FROM weekly_reports WHERE influencer_id = ? AND period_start = ? ORDER BY version DESC LIMIT 1`, influencerId, addDays(start, -7));
  const previousReview = prevReport
    ? (JSON.parse(prevReport.content).recommendations as Row[]).map((r) => {
        const m = metrics.find((x) => x.key === r.metric);
        return { action: r.action, outcome: m ? `${m.label}: ${m.current === null ? 'unavailable' : formatNumberIN(m.current)} (${pct(m.change_pct)} vs the week it was recommended)` : 'No single metric to check; review manually' };
      })
    : [];

  const syncIssue = get(db, `SELECT status, last_error FROM social_accounts WHERE influencer_id = ? AND platform = ? AND status IN ('expired','error')`, influencerId, platform);
  if (syncIssue) flags.push({ level: 'high', text: `Instagram connection ${syncIssue.status}${syncIssue.last_error ? `: ${syncIssue.last_error}` : ''} — data may be incomplete` });

  return {
    period: { start, end },
    platform,
    source: cur?.source ?? null,
    updated_at: cur?.updated_at ?? cur?.created_at ?? null,
    metrics,
    median_views: medianViews,
    avg_views: avgViews,
    organic_vs_paid: organicVsPaid,
    top_content: ranked.slice(0, 3).map(item),
    weak_content: ranked.length > 3 ? ranked.slice(-2).map(item) : ranked.length > 1 ? ranked.slice(-1).map(item) : [],
    observations,
    patterns,
    hypotheses,
    recommendations: recs.slice(0, 3),
    recommendations_source: 'rules',
    previous_review: previousReview,
    flags,
    summary: observations[0] ?? 'No metrics recorded for this week.',
    ai: { status: openaiConfigured() ? 'pending' : 'not_connected' },
  };
}

export async function generateReport(db: Db, influencerId: number, periodStart: string, trigger: 'manual' | 'scheduled' | 'regenerate', user: User | null): Promise<number> {
  const content = analyseWeek(db, influencerId, periodStart);
  if (openaiConfigured()) {
    try {
      const ai = await openaiNarrative(db, influencerId, content);
      content.summary = ai.summary || content.summary;
      content.hypotheses = ai.hypotheses.map((h: string) => (h.toLowerCase().startsWith('hypothesis') ? h : `Hypothesis: ${h}`));
      if (ai.recommendations.length === 3) {
        content.recommendations = ai.recommendations;
        content.recommendations_source = 'ai';
      }
      if (ai.previous_review?.length) content.previous_review = content.previous_review.map((p, i) => ({ ...p, outcome: `${p.outcome}${ai.previous_review[i] ? ` — ${ai.previous_review[i]}` : ''}` }));
      content.ai = { status: 'generated', model: ai.model, generated_at: new Date().toISOString() };
    } catch (err) {
      content.ai = { status: 'failed', error: (err as Error).message.slice(0, 300) };
      if (trigger === 'scheduled') throw err; // let the job retry; manual runs fall back to rule-based text
    }
  }
  return tx(db, () => {
    const start = content.period.start;
    const version = (get(db, `SELECT MAX(version) v FROM weekly_reports WHERE influencer_id = ? AND period_start = ?`, influencerId, start)?.v ?? 0) + 1;
    const prev = get(db, `SELECT manager_notes, founder_notes, checklist FROM weekly_reports WHERE influencer_id = ? AND period_start = ? ORDER BY version DESC LIMIT 1`, influencerId, start);
    const id = insert(db, 'weekly_reports', {
      influencer_id: influencerId, period_start: start, version, content, trigger,
      manager_notes: prev?.manager_notes ?? null, founder_notes: prev?.founder_notes ?? null,
      checklist: prev?.checklist ? JSON.parse(prev.checklist) : content.recommendations.map((r) => ({ text: r.action, done: false })),
      ai_status: content.ai.status, ai_model: content.ai.model ?? null, created_by: user?.id ?? null,
    });
    audit(db, user?.id ?? null, 'generate', 'weekly_reports', id, null, { influencer_id: influencerId, period_start: start, version, trigger });
    return id;
  });
}

export function agencySummary(db: Db, periodStart: string) {
  const start = weekStart(periodStart);
  const end = addDays(start, 6);
  const creators = all(db, `SELECT id, name FROM influencers WHERE archived_at IS NULL AND relationship IN ('exclusive','non_exclusive','campaign_only','agency_owned')`).map((i) => {
    const a = analyseWeek(db, i.id, start);
    const m = (k: string) => a.metrics.find((x) => x.key === k)!;
    return { id: i.id, name: i.name, has_data: a.source !== null, followers: m('followers_end').current, follower_change: m('follower_change').current, views: m('views').current, views_vs_baseline: m('views').change_vs_baseline_pct, engagement_rate: m('engagement_rate').current, flags: a.flags.filter((f) => f.level !== 'low') };
  });
  const live = all(db, `SELECT d.title, d.metrics, d.live_url, c.name AS campaign, i.name AS creator FROM deliverables d JOIN campaigns c ON c.id = d.campaign_id JOIN influencers i ON i.id = d.influencer_id WHERE d.publish_date BETWEEN ? AND ? AND d.archived_at IS NULL`, start, end).map((d) => ({ ...d, metrics: JSON.parse(d.metrics ?? 'null') }));
  return {
    period: { start, end },
    creators,
    campaign_deliverables: live,
    attention: creators.filter((c) => !c.has_data || c.flags.length || (c.views_vs_baseline !== null && c.views_vs_baseline <= -20)),
    growth_leaders: [...creators].filter((c) => c.views_vs_baseline !== null).sort((a, b) => b.views_vs_baseline! - a.views_vs_baseline!).slice(0, 5),
  };
}

// ---------------------------------------------------------------- OpenAI (narrative only)

export const openaiConfigured = () => !!process.env.OPENAI_API_KEY;

async function openaiNarrative(db: Db, influencerId: number, c: ReportContent) {
  const inf = get(db, 'SELECT handle, niches FROM influencers WHERE id = ?', influencerId);
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const facts = {
    creator: inf?.handle, niches: inf?.niches, period: c.period, platform: c.platform,
    metrics: c.metrics.map((m) => ({ metric: m.label, this_week: m.current, last_week: m.previous, four_week_avg: m.baseline, change_vs_last_week_pct: m.change_pct, change_vs_baseline_pct: m.change_vs_baseline_pct })),
    median_views: c.median_views, top_posts: c.top_content, weakest_posts: c.weak_content, observed_patterns: c.patterns, organic_vs_paid: c.organic_vs_paid,
    previous_recommendations: c.previous_review, data_flags: c.flags,
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You analyse weekly social media metrics for a talent agency. Use ONLY the numbers provided; never invent metrics, causes, or benchmarks. Null means unavailable — say so rather than guessing. Clearly separate what the data shows from hypotheses about why. Return JSON: {"summary": string (2 sentences), "hypotheses": string[] (each starting "Hypothesis:"), "recommendations": [{"action": string, "rationale": string (cite a provided number), "metric": string}] (exactly 3, specific to next week), "previous_review": string[] (one short assessment per previous recommendation, in order)}' },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '{}');
  return {
    model: body.model ?? model,
    summary: String(parsed.summary ?? ''),
    hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses.map(String).slice(0, 5) : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 3).map((r: Row) => ({ action: String(r.action ?? ''), rationale: String(r.rationale ?? ''), metric: String(r.metric ?? '') })) : [],
    previous_review: Array.isArray(parsed.previous_review) ? parsed.previous_review.map(String) : [],
  };
}

// ---------------------------------------------------------------- Instagram (Meta official OAuth)

const GRAPH = () => `https://graph.instagram.com/${process.env.META_GRAPH_VERSION || 'v23.0'}`;
export const instagramConfigured = () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.APP_BASE_URL);
const redirectUri = () => `${process.env.APP_BASE_URL}/oauth/instagram/callback`;
const SCOPES = 'instagram_business_basic,instagram_business_manage_insights';

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16 || secret.startsWith('change-me')) throw new HttpError(500, 'Set a strong APP_SECRET before connecting accounts (tokens are encrypted with it)');
  return createHash('sha256').update(secret).digest();
}
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
export function decrypt(blob: string): string {
  const [, iv, tag, data] = blob.split(':');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function authorizeUrl(state: string) {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', process.env.META_APP_ID!);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('state', state);
  return u.toString();
}

/** Creates (or reuses) the creator's pending connection and returns a single-use state token valid for 7 days. */
function pendingConnection(db: Db, user: User, influencerId: number): string {
  const token = randomBytes(24).toString('base64url');
  const existing = get(db, `SELECT id, status FROM social_accounts WHERE platform = 'instagram' AND influencer_id = ?`, influencerId);
  const values = { invite_token_hash: sha(token), invite_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() };
  if (existing) update(db, 'social_accounts', existing.id, { ...values, status: existing.status === 'connected' ? 'connected' : 'invited' });
  else insert(db, 'social_accounts', { influencer_id: influencerId, platform: 'instagram', status: 'invited', ...values, created_by: user.id });
  return token;
}

async function igJson(url: string, init?: RequestInit): Promise<Row> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = new Error(body.error?.message ?? body.error_message ?? `Instagram API ${res.status}`) as Error & { code?: number };
    e.code = body.error?.code;
    throw e;
  }
  return body;
}

async function completeOAuth(db: Db, state: string, code: string) {
  const acct = get(db, `SELECT * FROM social_accounts WHERE invite_token_hash = ? AND invite_expires_at > ?`, sha(state), new Date().toISOString());
  if (!acct) throw new HttpError(400, 'This connection link has expired or was already used. Ask Socialmog for a new one.');
  const form = new URLSearchParams({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, grant_type: 'authorization_code', redirect_uri: redirectUri(), code });
  const short = await igJson('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
  const long = await igJson(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(process.env.META_APP_SECRET!)}&access_token=${encodeURIComponent(short.access_token)}`);
  const me = await igJson(`${GRAPH()}/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(long.access_token)}`);
  update(db, 'social_accounts', acct.id, {
    token_enc: encrypt(long.access_token), token_expires_at: new Date(Date.now() + (long.expires_in ?? 5_184_000) * 1000).toISOString(),
    username: me.username ?? null, external_user_id: String(me.user_id ?? short.user_id ?? ''), scopes: Array.isArray(short.permissions) ? short.permissions.join(',') : SCOPES,
    status: 'connected', last_error: null, invite_token_hash: null, invite_expires_at: null,
  });
  audit(db, null, 'connect', 'social_accounts', acct.id, null, { username: me.username });
  notify(db, founders(db), { kind: 'connection', title: `Instagram connected: @${me.username}`, link: '/analytics/connections' });
}

const INSIGHT_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saves', 'profile_views', 'website_clicks', 'total_interactions'];

/** Pulls the week's metrics the authorisation allows. Unavailable metrics stay null and are listed. */
export async function syncInstagram(db: Db, accountId: number, periodStart: string): Promise<Row> {
  const acct = get(db, 'SELECT * FROM social_accounts WHERE id = ?', accountId);
  if (!acct || acct.status !== 'connected' || !acct.token_enc) throw new Error('Account is not connected');
  if (!acct.influencer_id) throw new Error('Agency-owned account: link it to a roster profile to store weekly snapshots');
  let token = decrypt(acct.token_enc);
  try {
    if (acct.token_expires_at && Date.parse(acct.token_expires_at) - Date.now() < 10 * 86_400_000) {
      const r = await igJson(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
      token = r.access_token;
      update(db, 'social_accounts', acct.id, { token_enc: encrypt(token), token_expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString() });
    }
    const start = weekStart(periodStart);
    const since = Math.floor(Date.parse(`${start}T00:00:00+05:30`) / 1000);
    const until = Math.floor(Date.parse(`${addDays(start, 7)}T00:00:00+05:30`) / 1000);
    const me = await igJson(`${GRAPH()}/me?fields=followers_count,media_count,username&access_token=${encodeURIComponent(token)}`);
    const metrics: Row = { followers_end: me.followers_count ?? null };
    const prev = get(db, `SELECT metrics FROM analytics_snapshots WHERE influencer_id = ? AND platform = 'instagram' AND period_start = ?`, acct.influencer_id, addDays(start, -7));
    metrics.followers_start = prev ? JSON.parse(prev.metrics).followers_end ?? null : null;
    const available: string[] = [];
    const unavailable: Row = {};
    for (const m of INSIGHT_METRICS) {
      try {
        const r = await igJson(`${GRAPH()}/${acct.external_user_id}/insights?metric=${m}&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`);
        const v = r.data?.[0]?.total_value?.value;
        if (typeof v === 'number') {
          metrics[m === 'profile_views' ? 'profile_visits' : m] = v;
          available.push(m);
        }
      } catch (e) {
        unavailable[m] = (e as Error).message;
      }
    }
    const media = await igJson(`${GRAPH()}/${acct.external_user_id}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp&since=${since}&until=${until}&limit=50&access_token=${encodeURIComponent(token)}`);
    let posts = 0;
    for (const m of media.data ?? []) {
      posts++;
      const pm: Row = {};
      try {
        const r = await igJson(`${GRAPH()}/${m.id}/insights?metric=reach,views,likes,comments,shares,saved&access_token=${encodeURIComponent(token)}`);
        for (const d of r.data ?? []) pm[d.name === 'saved' ? 'saves' : d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? null;
      } catch {
        /* per-post insights not available for this media type */
      }
      const format = m.media_product_type === 'REELS' ? 'reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : m.media_product_type === 'STORY' ? 'story' : 'post';
      const existing = get(db, `SELECT id FROM posts WHERE influencer_id = ? AND platform = 'instagram' AND external_id = ?`, acct.influencer_id, m.id);
      const row = { permalink: m.permalink, published_at: m.timestamp, format, caption: String(m.caption ?? '').slice(0, 300), metrics: pm, source: 'instagram_api', metrics_as_of: new Date().toISOString() };
      if (existing) update(db, 'posts', existing.id, row);
      else insert(db, 'posts', { ...row, influencer_id: acct.influencer_id, platform: 'instagram', external_id: m.id, promotion: 'unknown' });
    }
    metrics.posts = posts;
    upsertSnapshot(db, null, { influencer_id: acct.influencer_id, platform: 'instagram', period_start: start, metrics, source: 'instagram_api' });
    update(db, 'social_accounts', acct.id, { last_sync_at: new Date().toISOString(), last_sync_status: 'success', last_error: Object.keys(unavailable).length ? `Unavailable: ${Object.keys(unavailable).join(', ')}` : null, available_metrics: available, username: me.username ?? acct.username });
    return { available, unavailable, posts };
  } catch (err) {
    const e = err as Error & { code?: number };
    update(db, 'social_accounts', acct.id, { last_sync_at: new Date().toISOString(), last_sync_status: 'failed', last_error: e.message.slice(0, 500), status: e.code === 190 ? 'expired' : 'error' });
    throw err;
  }
}

// ---------------------------------------------------------------- scheduled weekly run

export async function runWeekly(db: Db, periodStart: string, trigger: 'scheduled' | 'manual', user: User | null) {
  const errors: string[] = [];
  for (const a of all(db, `SELECT id, username FROM social_accounts WHERE status = 'connected' AND influencer_id IS NOT NULL`)) {
    try {
      await syncInstagram(db, a.id, periodStart);
    } catch (e) {
      errors.push(`Sync @${a.username ?? a.id}: ${(e as Error).message}`);
    }
  }
  const infs = all(db, `SELECT DISTINCT i.id FROM influencers i JOIN analytics_snapshots s ON s.influencer_id = i.id WHERE i.archived_at IS NULL AND i.relationship <> 'inactive'`);
  let made = 0;
  for (const i of infs) {
    if (trigger === 'scheduled' && get(db, `SELECT id FROM weekly_reports WHERE influencer_id = ? AND period_start = ? AND trigger = 'scheduled'`, i.id, weekStart(periodStart))) continue;
    try {
      await generateReport(db, i.id, periodStart, trigger, user);
      made++;
    } catch (e) {
      errors.push(`Report for influencer #${i.id}: ${(e as Error).message}`);
    }
  }
  const summary = agencySummary(db, periodStart);
  const version = (get(db, `SELECT MAX(version) v FROM weekly_reports WHERE influencer_id IS NULL AND period_start = ?`, summary.period.start)?.v ?? 0) + 1;
  const alreadyScheduled = trigger === 'scheduled' && get(db, `SELECT id FROM weekly_reports WHERE influencer_id IS NULL AND period_start = ? AND trigger = 'scheduled'`, summary.period.start);
  if (!alreadyScheduled) insert(db, 'weekly_reports', { influencer_id: null, period_start: summary.period.start, version, content: summary, trigger, ai_status: 'n/a' });
  notify(db, founders(db), { kind: 'analysis', title: `Weekly analysis ready: ${made} creator report(s)`, body: errors.length ? `${errors.length} problem(s): ${errors.slice(0, 2).join('; ')}` : `Week of ${formatDate(summary.period.start)}`, link: '/analytics', dedupe: `weekly:${summary.period.start}:${version}` });
  if (errors.length && trigger === 'scheduled' && made === 0 && infs.length) throw new Error(errors.join('; '));
  return { made, errors };
}

registerJob('weekly_analysis', (db, payload) => runWeekly(db, payload.period_start, 'scheduled', null));

onTick((db, now, tz) => {
  const sched = get(db, `SELECT value FROM settings WHERE key = 'analysis_schedule'`);
  const s = sched ? JSON.parse(sched.value) : { enabled: true, weekday: 1, time: '09:00' };
  if (s.enabled === false) return;
  const p = partsInTz(now, tz);
  const [hh, mm] = String(s.time).split(':').map(Number);
  if (p.weekday !== s.weekday || p.hour * 60 + p.minute < hh * 60 + mm) return;
  // Analyse the week that just ended (Monday–Sunday). The unique key stops duplicate runs.
  const period = addDays(weekStart(p.date), -7);
  enqueue(db, 'weekly_analysis', { period_start: period }, `weekly_analysis:${period}`);
});

// ---------------------------------------------------------------- routes

export function analyticsRoutes(app: Express) {
  const staff = (req: Request) => {
    const u = requireInternal(req);
    if (u.role === 'editor') throw new HttpError(403, 'Not available');
    return u;
  };

  app.get('/api/analytics/overview', (req, res) => {
    staff(req);
    const db = req.db;
    const t = today(db);
    const lastWeek = addDays(weekStart(t), -7);
    const rows = all(db, `SELECT id, name, handle, relationship FROM influencers WHERE archived_at IS NULL AND relationship <> 'inactive' ORDER BY name`).map((i) => {
      const latest = get(db, `SELECT period_start, source, updated_at, created_at, metrics FROM analytics_snapshots WHERE influencer_id = ? AND archived_at IS NULL ORDER BY period_start DESC LIMIT 1`, i.id);
      const report = get(db, `SELECT id, period_start, version, ai_status, created_at FROM weekly_reports WHERE influencer_id = ? ORDER BY period_start DESC, version DESC LIMIT 1`, i.id);
      const conn = get(db, `SELECT status, last_sync_at, last_sync_status FROM social_accounts WHERE influencer_id = ? AND platform = 'instagram'`, i.id);
      return { ...i, latest: latest ? { ...latest, metrics: enrich(JSON.parse(latest.metrics ?? '{}')) } : null, report, connection: conn ?? null, missing_last_week: !latest || latest.period_start < lastWeek };
    });
    const summary = get(db, `SELECT * FROM weekly_reports WHERE influencer_id IS NULL ORDER BY period_start DESC, version DESC LIMIT 1`);
    res.json({ last_week: lastWeek, rows, summary: summary ? decode('weekly_reports', summary) : null, ai: openaiConfigured(), instagram: instagramConfigured() });
  });

  app.get('/api/analytics/influencer/:id', (req, res) => {
    staff(req);
    const id = Number(req.params.id);
    const inf = get(req.db, 'SELECT id, name, handle, platforms FROM influencers WHERE id = ?', id);
    if (!inf) throw new HttpError(404, 'Influencer not found');
    res.json({
      influencer: decode('influencers', inf),
      snapshots: snapshots(req.db, id),
      posts: all(req.db, `SELECT * FROM posts WHERE influencer_id = ? AND archived_at IS NULL ORDER BY published_at DESC LIMIT 200`, id).map((p) => decode('posts', p)),
      reports: all(req.db, `SELECT id, period_start, version, trigger, ai_status, created_at FROM weekly_reports WHERE influencer_id = ? ORDER BY period_start DESC, version DESC`, id),
      connection: get(req.db, `SELECT id, status, username, last_sync_at, last_sync_status, last_error, available_metrics, token_expires_at FROM social_accounts WHERE influencer_id = ? AND platform = 'instagram'`, id) ?? null,
    });
  });

  app.post('/api/analytics/snapshots', (req, res) => {
    const u = requireCap(req, 'talent');
    const b = req.body ?? {};
    res.status(201).json({ id: upsertSnapshot(req.db, u, { influencer_id: Number(b.influencer_id), platform: String(b.platform || 'instagram'), period_start: b.period_start, metrics: b.metrics ?? {}, source: String(b.source || 'manual').slice(0, 80), notes: b.notes }) });
  });

  app.post('/api/analytics/posts', (req, res) => {
    const u = requireCap(req, 'talent');
    const b = req.body ?? {};
    if (!get(req.db, 'SELECT id FROM influencers WHERE id = ?', Number(b.influencer_id))) throw new HttpError(400, 'Choose a creator');
    if (b.permalink && !/^https?:\/\//.test(b.permalink)) throw new HttpError(400, 'Link must start with http(s)://');
    if (!b.published_at || Number.isNaN(Date.parse(b.published_at))) throw new HttpError(400, 'Published date is required');
    const metrics = Object.fromEntries(['views', 'reach', 'likes', 'comments', 'shares', 'saves'].map((k) => [k, num(b.metrics?.[k])]));
    const id = insert(req.db, 'posts', { influencer_id: Number(b.influencer_id), platform: b.platform || 'instagram', external_id: b.external_id || null, permalink: b.permalink || null, published_at: new Date(b.published_at).toISOString(), format: b.format || null, topic: b.topic || null, duration_sec: num(b.duration_sec), caption: b.caption || null, promotion: ['organic', 'paid'].includes(b.promotion) ? b.promotion : 'unknown', campaign_id: b.campaign_id || null, metrics, source: String(b.source || 'manual').slice(0, 80), metrics_as_of: new Date().toISOString(), created_by: u.id });
    res.status(201).json({ id });
  });

  /** CSV rows already parsed in the browser. kind = snapshots | posts. Influencer matched by name or handle. */
  app.post('/api/analytics/import', (req, res) => {
    const u = requireCap(req, 'talent');
    const { kind, rows } = req.body ?? {};
    if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new HttpError(400, 'Provide 1–5,000 rows');
    const infs = all(req.db, 'SELECT id, name, handle FROM influencers WHERE archived_at IS NULL');
    const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/^@/, '');
    const find = (v: unknown) => infs.find((i) => norm(i.name) === norm(v) || (i.handle && norm(i.handle) === norm(v)));
    const out = { imported: 0, updated: 0, errors: [] as Row[] };
    tx(req.db, () => {
      rows.forEach((r: Row, i: number) => {
        try {
          const inf = find(r.influencer ?? r.creator ?? r.handle);
          if (!inf) throw new Error(`Unknown creator "${r.influencer ?? r.creator ?? r.handle ?? ''}"`);
          if (kind === 'posts') {
            const ext = r.external_id || r.permalink;
            const metrics = Object.fromEntries(['views', 'reach', 'likes', 'comments', 'shares', 'saves'].map((k) => [k, num(r[k])]));
            const published = r.published_at && !Number.isNaN(Date.parse(r.published_at)) ? new Date(r.published_at).toISOString() : null;
            if (!published) throw new Error('published_at is missing or invalid');
            const existing = ext ? get(req.db, 'SELECT id FROM posts WHERE influencer_id = ? AND platform = ? AND external_id = ?', inf.id, r.platform || 'instagram', ext) : null;
            const values = { permalink: r.permalink || null, published_at: published, format: r.format || null, topic: r.topic || null, duration_sec: num(r.duration_sec), promotion: ['organic', 'paid'].includes(r.promotion) ? r.promotion : 'unknown', metrics, source: 'csv', metrics_as_of: new Date().toISOString() };
            if (existing) (update(req.db, 'posts', existing.id, values), out.updated++);
            else (insert(req.db, 'posts', { ...values, influencer_id: inf.id, platform: r.platform || 'instagram', external_id: ext || null, created_by: u.id }), out.imported++);
          } else {
            if (!isIsoDate(r.week_start)) throw new Error('week_start must be YYYY-MM-DD');
            const had = get(req.db, 'SELECT id FROM analytics_snapshots WHERE influencer_id = ? AND platform = ? AND period_start = ?', inf.id, r.platform || 'instagram', weekStart(r.week_start));
            upsertSnapshot(req.db, u, { influencer_id: inf.id, platform: r.platform || 'instagram', period_start: r.week_start, metrics: r, source: 'csv' });
            had ? out.updated++ : out.imported++;
          }
        } catch (e) {
          out.errors.push({ row: i + 1, error: (e as Error).message });
        }
      });
    });
    res.json(out);
  });

  app.post('/api/analytics/reports', async (req, res) => {
    const u = staff(req);
    const id = Number(req.body?.influencer_id);
    const period = isIsoDate(req.body?.period_start) ? req.body.period_start : addDays(weekStart(today(req.db)), -7);
    res.status(201).json({ id: await generateReport(req.db, id, period, req.body?.regenerate ? 'regenerate' : 'manual', u) });
  });

  app.get('/api/analytics/reports/:id', (req, res) => {
    staff(req);
    const r = get(req.db, `SELECT w.*, i.name, i.handle FROM weekly_reports w LEFT JOIN influencers i ON i.id = w.influencer_id WHERE w.id = ?`, Number(req.params.id));
    if (!r) throw new HttpError(404, 'Report not found');
    const versions = all(req.db, `SELECT id, version, trigger, ai_status, created_at FROM weekly_reports WHERE coalesce(influencer_id,0) = coalesce(?,0) AND period_start = ? ORDER BY version DESC`, r.influencer_id, r.period_start);
    res.json({ row: decode('weekly_reports', r), versions });
  });

  app.patch('/api/analytics/reports/:id', (req, res) => {
    const u = staff(req);
    const id = Number(req.params.id);
    const r = get(req.db, 'SELECT * FROM weekly_reports WHERE id = ?', id);
    if (!r) throw new HttpError(404, 'Report not found');
    const values: Row = {};
    if (typeof req.body?.manager_notes === 'string') values.manager_notes = req.body.manager_notes.slice(0, 20_000);
    if (typeof req.body?.founder_notes === 'string') {
      if (u.role !== 'founder') throw new HttpError(403, 'Only the founder can edit founder notes');
      values.founder_notes = req.body.founder_notes.slice(0, 20_000);
    }
    if (Array.isArray(req.body?.checklist)) values.checklist = req.body.checklist.slice(0, 50).map((c: Row) => ({ text: String(c.text ?? '').slice(0, 300), done: !!c.done }));
    update(req.db, 'weekly_reports', id, values);
    audit(req.db, u.id, 'update', 'weekly_reports', id, null, values);
    res.json({ ok: true });
  });

  app.post('/api/analytics/run', async (req, res) => {
    const u = requireCap(req, 'talent');
    const period = isIsoDate(req.body?.period_start) ? weekStart(req.body.period_start) : addDays(weekStart(today(req.db)), -7);
    res.json(await runWeekly(req.db, period, 'manual', u));
  });

  // ---- integrations
  app.get('/api/integrations/status', (req, res) => {
    staff(req);
    res.json({
      instagram: { configured: instagramConfigured(), redirect_uri: process.env.APP_BASE_URL ? redirectUri() : null, scopes: SCOPES },
      openai: { configured: openaiConfigured(), model: openaiConfigured() ? process.env.OPENAI_MODEL || 'gpt-4.1-mini' : null },
      email: { configured: false, note: 'No email service is connected. Invite and report links are copied or opened in your own mail app.' },
      accounts: all(req.db, `SELECT a.id, a.influencer_id, i.name, a.username, a.status, a.last_sync_at, a.last_sync_status, a.last_error, a.available_metrics, a.token_expires_at, a.invite_expires_at FROM social_accounts a LEFT JOIN influencers i ON i.id = a.influencer_id ORDER BY a.id DESC`).map((r) => ({ ...r, available_metrics: JSON.parse(r.available_metrics ?? 'null') })),
    });
  });

  app.post('/api/integrations/instagram/invite', (req, res) => {
    const u = requireCap(req, 'talent');
    if (!instagramConfigured()) throw new HttpError(400, 'Instagram is not connected: add META_APP_ID, META_APP_SECRET and APP_BASE_URL to the server environment');
    key();
    const influencerId = Number(req.body?.influencer_id);
    if (!get(req.db, 'SELECT id FROM influencers WHERE id = ?', influencerId)) throw new HttpError(400, 'Choose the roster profile this account belongs to (use an "Agency-owned" profile for Socialmog accounts)');
    const token = pendingConnection(req.db, u, influencerId);
    audit(req.db, u.id, 'invite', 'social_accounts', null, null, { influencer_id: influencerId });
    res.json({ link: `${process.env.APP_BASE_URL}/oauth/instagram/invite/${token}`, authorize_url: authorizeUrl(token), expires_in_days: 7 });
  });

  app.post('/api/integrations/instagram/:id/sync', async (req, res) => {
    requireCap(req, 'talent');
    const period = isIsoDate(req.body?.period_start) ? req.body.period_start : addDays(weekStart(today(req.db)), -7);
    res.json(await syncInstagram(req.db, Number(req.params.id), period));
  });

  app.post('/api/integrations/instagram/:id/disconnect', (req, res) => {
    const u = requireCap(req, 'talent');
    update(req.db, 'social_accounts', Number(req.params.id), { status: 'revoked', token_enc: null, token_expires_at: null });
    audit(req.db, u.id, 'disconnect', 'social_accounts', Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- public OAuth pages (no login: the creator authorises their own account with Instagram)
  const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#0f172a;line-height:1.5}a.btn{display:inline-block;background:#2747d8;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600}.muted{color:#64748b;font-size:14px}</style></head><body>${body}</body></html>`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  app.get('/oauth/instagram/invite/:token', (req, res) => {
    const acct = get(req.db, `SELECT a.*, i.name FROM social_accounts a LEFT JOIN influencers i ON i.id = a.influencer_id WHERE a.invite_token_hash = ? AND a.invite_expires_at > ?`, sha(req.params.token), new Date().toISOString());
    if (!acct || !instagramConfigured()) return res.status(404).send(page('Link expired', '<h1>This link has expired</h1><p>Ask your Socialmog manager for a new connection link.</p>'));
    res.send(page('Connect Instagram to Socialmog', `<h1>Connect your Instagram${acct.name ? `, ${esc(acct.name)}` : ''}</h1>
      <p>Socialmog will be able to read your <strong>profile basics (username, follower count)</strong> and <strong>insights for your posts and account (reach, views, likes, comments, shares, saves)</strong> to prepare your weekly performance report.</p>
      <p>Socialmog cannot post, message, or change anything on your account. You sign in on Instagram's own page — never share your password with anyone. You can remove access anytime in Instagram settings.</p>
      <p><a class="btn" href="${esc(authorizeUrl(req.params.token))}">Continue with Instagram</a></p><p class="muted">Requires an Instagram professional (Business or Creator) account.</p>`));
  });

  app.get('/oauth/instagram/callback', async (req, res) => {
    const { code, state, error_description } = req.query as Record<string, string>;
    if (error_description || !code || !state) return res.status(400).send(page('Not connected', `<h1>Not connected</h1><p>${esc(error_description ?? 'Authorisation was cancelled.')}</p>`));
    try {
      await completeOAuth(req.db, state, code);
      res.send(page('Connected', '<h1>Connected ✓</h1><p>Your Instagram account is now linked to Socialmog. You can close this tab.</p>'));
    } catch (e) {
      res.status(400).send(page('Not connected', `<h1>Could not connect</h1><p>${esc((e as Error).message)}</p>`));
    }
  });
}

export function weeklyContentForPdf(db: Db, reportId: number) {
  const r = get(db, `SELECT w.*, i.name, i.handle, i.platforms FROM weekly_reports w LEFT JOIN influencers i ON i.id = w.influencer_id WHERE w.id = ?`, reportId);
  return r ? { ...decode('weekly_reports', r)!, platforms: JSON.parse(r.platforms ?? '[]'), snapshots: r.influencer_id ? snapshots(db, r.influencer_id).slice(0, 12) : [] } : null;
}

