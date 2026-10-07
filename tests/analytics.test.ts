import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { all, get, insert, openDb, type User } from '../src/server/db.ts';
import { hashPassword } from '../src/server/app.ts';
import { seedDemo } from '../src/server/seed.ts';
import { analyseWeek, runWeekly, upsertSnapshot } from '../src/server/analytics.ts';
import { enqueue } from '../src/server/jobs.ts';
import { produce, requestReport } from '../src/server/reports.ts';

process.env.HQ_TODAY = '2026-10-07';
const db = openDb(':memory:');
insert(db, 'users', { name: 'Founder', email: 'f@test.in', role: 'founder', status: 'active', password_hash: hashPassword('founder-password') });
seedDemo(db);
const founder = get(db, `SELECT id, name, email, role, editor_id, influencer_id, brand_id FROM users WHERE email = 'f@test.in'`) as User;

test('weekly analysis: week-over-week and 4-week baseline; missing data stays unavailable', () => {
  const inf = insert(db, 'influencers', { name: 'Test Creator', relationship: 'exclusive' });
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
  [100, 200, 300, 400].forEach((views, i) => upsertSnapshot(db, founder, { influencer_id: inf, platform: 'instagram', period_start: weeks[i], metrics: { views, followers_start: 1000 + i, followers_end: 1001 + i }, source: 'manual' }));
  upsertSnapshot(db, founder, { influencer_id: inf, platform: 'instagram', period_start: '2026-10-05', metrics: { views: 500 }, source: 'manual' });
  const a = analyseWeek(db, inf, '2026-10-05');
  const views = a.metrics.find((m) => m.key === 'views')!;
  assert.equal(views.current, 500);
  assert.equal(views.previous, 400);
  assert.equal(views.change_pct, 25);
  assert.equal(views.baseline, 250);
  assert.equal(views.baseline_weeks, 4);
  assert.equal(views.change_vs_baseline_pct, 100);
  const reach = a.metrics.find((m) => m.key === 'reach')!;
  assert.equal(reach.current, null, 'not provided means unavailable, not zero');
  assert.ok(a.flags.some((f) => /Unavailable this week/.test(f.text)));
  assert.ok(a.flags.some((f) => /unusually large change/.test(f.text)));
  assert.equal(a.recommendations.length, 3);
  assert.equal(a.recommendations_source, 'rules');
  // A later manual update keeps existing values it doesn't provide.
  upsertSnapshot(db, founder, { influencer_id: inf, platform: 'instagram', period_start: '2026-10-07', metrics: { reach: 450 }, source: 'csv' });
  const merged = analyseWeek(db, inf, '2026-10-05');
  assert.equal(merged.metrics.find((m) => m.key === 'views')!.current, 500);
  assert.equal(merged.metrics.find((m) => m.key === 'reach')!.current, 450);
  assert.match(merged.source!, /manual \+ csv/);
});

test('scheduled analysis runs once per week (duplicate jobs and reports prevented)', async () => {
  const a = enqueue(db, 'weekly_analysis', { period_start: '2026-09-28' }, 'weekly_analysis:2026-09-28');
  const b = enqueue(db, 'weekly_analysis', { period_start: '2026-09-28' }, 'weekly_analysis:2026-09-28');
  assert.equal(a, b);
  await runWeekly(db, '2026-09-28', 'scheduled', null);
  const first = all(db, `SELECT COUNT(*) n FROM weekly_reports WHERE period_start = '2026-09-28' AND trigger = 'scheduled'`)[0].n;
  await runWeekly(db, '2026-09-28', 'scheduled', null);
  const second = all(db, `SELECT COUNT(*) n FROM weekly_reports WHERE period_start = '2026-09-28' AND trigger = 'scheduled'`)[0].n;
  assert.ok(first > 0);
  assert.equal(second, first);
});

test('external campaign PDF leaves out margins and creator fees', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-rep-'));
  const camp = get(db, `SELECT id FROM campaigns WHERE name LIKE '%Diwali%'`)!.id;
  const ext = requestReport(db, founder, { report_type: 'campaign', audience: 'external', params: { campaign_id: camp } });
  const int = requestReport(db, founder, { report_type: 'campaign', audience: 'internal', params: { campaign_id: camp } });
  await produce(db, dir, ext);
  await produce(db, dir, int);
  const extRun = get(db, 'SELECT * FROM report_runs WHERE id = ?', ext)!;
  const intRun = get(db, 'SELECT * FROM report_runs WHERE id = ?', int)!;
  assert.equal(extRun.status, 'completed');
  assert.ok(readFileSync(join(dir, 'reports', extRun.file)).length > 1000);
  assert.equal(JSON.parse(extRun.snapshot).finance, null, 'no financials archived with the external version');
  assert.ok(JSON.parse(intRun.snapshot).finance.contribution_margin !== undefined);
  assert.throws(() => requestReport(db, founder, { report_type: 'finance', audience: 'external', params: {} }), /internal only/);
  const editor = get(db, `SELECT id, name, email, role, editor_id, influencer_id, brand_id FROM users WHERE role = 'editor' LIMIT 1`) as User;
  assert.throws(() => requestReport(db, editor, { report_type: 'campaign', audience: 'external', params: { campaign_id: camp } }), /cannot generate/);
});
