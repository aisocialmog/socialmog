import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { all, get, insert, openDb, update, type Row, type User } from '../src/server/db.ts';
import { hashPassword } from '../src/server/app.ts';
import { seedDemo } from '../src/server/seed.ts';
import { applyImport, buildPrompt, canUse, createExport, parseResult, previewImport, SCHEMA_VERSION, undoImport } from '../src/server/chatgpt.ts';
import { dashboard } from '../src/server/domain.ts';
import { cashPosition, listInvoices, today } from '../src/server/finance.ts';
import { produce, requestReport } from '../src/server/reports.ts';
import { enqueue, runDueJobs } from '../src/server/jobs.ts';

process.env.HQ_TODAY = '2026-10-07';
const db = openDb(':memory:');
insert(db, 'users', { name: 'Founder', email: 'f@test.in', role: 'founder', status: 'active', password_hash: hashPassword('founder-password') });
seedDemo(db);
const userBy = (email: string) => get(db, `SELECT id, name, email, role, editor_id, influencer_id, brand_id FROM users WHERE email = ?`, email) as User;
const founder = userBy('f@test.in');
const finance = userBy('meera@demo.socialmog.in');
const campaignManager = userBy('aditya@demo.socialmog.in');
const talent = userBy('sana@demo.socialmog.in');
const editor = userBy('ishaan@demo.socialmog.in');

const pkgOf = (key: string) => JSON.parse(get(db, 'SELECT package FROM ai_exports WHERE export_key = ?', key)!.package);

/** A minimal valid result for an export; tests override the parts they exercise. */
function result(key: string, extra: Row = {}) {
  const p = pkgOf(key);
  return {
    schema_version: SCHEMA_VERSION, analysis_type: p.analysis_type, export_id: key, result_id: `${key}-r1`, generated_at: '2026-10-07T10:00:00Z',
    reporting_period: p.reporting_period, record_ids: [], source_record_versions: p.source_record_versions,
    provenance: [{ source: 'Socialmog HQ export', kind: 'website_export', retrieved_at: null, notes: null }],
    summary: 'Test summary', website_facts: [], connector_metrics: [], derived_calculations: [], observations: [], recommendations: [],
    proposed_tasks: [], proposed_changes: [], missing_data: [], assumptions: [], limitations: [], ...extra,
  };
}

const metrics = (m: Row) => Object.fromEntries(['followers_start', 'followers_end', 'posts', 'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'engagement_rate', 'profile_visits', 'website_clicks', 'avg_views', 'median_views', 'paid_views', 'paid_reach'].map((k) => [k, m[k] ?? null]));
const connector = (record: string | null, username: string, start: string, m: Row, extra: Row = {}) => ({
  record, platform: 'instagram', username, profile_url: null, source: 'Windsor.ai', retrieved_at: '2026-10-07T09:00:00Z',
  period: { start, end: addDays6(start) }, granularity: 'week', status: 'retrieved', metrics: metrics(m), units: { views: 'count' }, content: [], issues: [], ...extra,
});
function addDays6(d: string) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 6);
  return x.toISOString().slice(0, 10);
}

test('export package: IDs, versions, schema and handles; no credentials or private data', () => {
  update(db, 'influencers', 1, { pan: 'ABCDE1234F', bank_details: 'HDFC 0000111122223333', upi_id: 'riya@okbank', internal_notes: 'PRIVATE-NOTE-XYZ' });
  const key = createExport(db, founder, { type: 'influencer_growth', ids: [1, 2], from: '2026-09-28', to: '2026-10-04' });
  const p = pkgOf(key);
  assert.equal(p.schema_version, SCHEMA_VERSION);
  assert.equal(p.export_id, key);
  assert.deepEqual(p.reporting_period, { start: '2026-09-28', end: '2026-10-04', timezone: 'Asia/Kolkata' });
  assert.equal(p.currency.code, 'INR');
  assert.deepEqual(p.records.influencers.map((i: Row) => i.ref), ['influencers:1', 'influencers:2']);
  assert.ok(p.platform_accounts.some((a: Row) => a.record === 'influencers:1' && a.username === 'riyaglows' && a.profile_url));
  assert.ok(p.source_record_versions['influencers:1']);
  assert.ok(p.response_schema['x-allowed-changes'].update.influencers);
  const text = JSON.stringify(p);
  for (const secret of ['ABCDE1234F', '0000111122223333', 'riya@okbank', 'PRIVATE-NOTE-XYZ', 'password', 'token_enc']) assert.ok(!text.includes(secret), `package must not contain ${secret}`);
  const exp = { ...get(db, 'SELECT * FROM ai_exports WHERE export_key = ?', key), package: p };
  assert.match(buildPrompt(exp, 'standard'), /no Markdown code fences/);
  const conn = buildPrompt(exp, 'connector');
  assert.match(conn, /Windsor\.ai, or any other provider/);
  assert.match(conn, /does not connect it to Socialmog HQ/);
  assert.match(conn, /manual export/);
  assert.match(conn, /Never|never/);
  // Role checks: talent managers cannot export finance; editors cannot use the workspace.
  assert.throws(() => createExport(db, talent, { type: 'finance_summary' }), /cannot run/);
  assert.throws(() => createExport(db, finance, { type: 'founder_review' }), /cannot run/);
  assert.equal(canUse(editor, 'content_planning'), false);
});

test('import validation gives readable errors and tolerates fences only with a note', () => {
  const key = createExport(db, founder, { type: 'influencer_growth', ids: [1], from: '2026-09-28', to: '2026-10-04' });
  assert.throws(() => previewImport(db, founder, 'Here is your analysis!'), /Not valid JSON/);
  const bad = result(key, { connector_metrics: [connector('influencers:1', 'riyaglows', '2026-09-28', { views: '12k' })] });
  try {
    previewImport(db, founder, JSON.stringify(bad));
    assert.fail('should reject');
  } catch (e: any) {
    assert.equal(e.status, 400);
    assert.ok(e.details.schema_errors.some((x: string) => x.includes('$.connector_metrics[0].metrics.views') && x.includes('expected number or null')));
  }
  const { notes } = parseResult('```json\n' + JSON.stringify(result(key)) + '\n```');
  assert.match(notes[0], /Markdown/);
  assert.throws(() => previewImport(db, founder, JSON.stringify({ ...result(key), export_id: 'exp_doesnotexist' })), /not found/);
  assert.throws(() => previewImport(db, founder, JSON.stringify({ ...result(key), extra_field: 1 })), /does not match/);
});

let appliedImport = 0;
test('apply: metrics become new snapshots with provenance; conflicts keep existing values; analysis, task and change applied; duplicates blocked', () => {
  const key = createExport(db, founder, { type: 'influencer_growth', ids: [1, 2], from: '2026-09-28', to: '2026-10-04' });
  const existing = get(db, `SELECT * FROM analytics_snapshots WHERE influencer_id = 1 AND period_start = '2026-09-28'`)!;
  const oldViews = JSON.parse(existing.metrics).views;
  const r = result(key, {
    record_ids: ['influencers:1', 'influencers:2'],
    provenance: [{ source: 'Windsor.ai', kind: 'connector', retrieved_at: '2026-10-07T09:00:00Z', notes: null }],
    connector_metrics: [
      connector('influencers:1', 'riyaglows', '2026-09-28', { views: oldViews + 1000, profile_visits: 1200 }),
      connector('influencers:2', 'kabircooks', '2026-10-05', { views: 50000, followers_end: 211000 }, { granularity: 'week' }),
      connector('influencers:9999', 'someone', '2026-09-28', { views: 1 }),
    ],
    observations: [{ record: 'influencers:1', type: 'observed', text: 'Reels outperform carousels', evidence: '2 of 2 top posts are reels' }, { record: null, type: 'hypothesis', text: 'Evening posts may do better', evidence: null }],
    recommendations: [{ id: 'rec1', record: 'influencers:1', text: 'Post 3 GRWM reels', rationale: 'Top format', priority: 'high', metric_to_watch: 'views' }],
    proposed_tasks: [{ id: 't1', title: 'Brief Riya on GRWM series', description: '<script>alert(1)</script>', related_record: 'influencers:1', owner_hint: 'Sana', priority: 'high', due_date: '2026-10-10' }],
    proposed_changes: [{ id: 'c1', action: 'update', entity: 'influencers', record: 'influencers:1', fields: { availability_notes: 'Busy with Diwali shoots till 20 Oct' }, reason: 'From manager notes' }],
  });
  const pv = previewImport(db, founder, JSON.stringify(r));
  const views = pv.connector[0].metrics.find((m: Row) => m.key === 'views');
  assert.equal(views.conflict, true);
  assert.equal(views.existing, oldViews);
  assert.equal(pv.connector[0].metrics.find((m: Row) => m.key === 'profile_visits').conflict, false);
  assert.equal(pv.connector[2].unresolved, true, 'unknown IDs are never guessed');
  assert.equal(pv.changes[0].fields[0].changed, true);
  assert.equal(pv.changes[0].financial, false);

  // Unresolved item selected without a resolution: nothing is applied.
  assert.throws(() => applyImport(db, founder, pv.import_id, { analysis: true, metrics: [{ index: 2 }] }), /choose which creator/);
  assert.equal(get(db, 'SELECT status FROM ai_imports WHERE id = ?', pv.import_id)!.status, 'previewed');

  const before = get(db, 'SELECT COUNT(*) n FROM analytics_snapshots')!.n;
  const out = applyImport(db, founder, pv.import_id, { analysis: true, dashboard: true, metrics: [{ index: 0 }, { index: 1 }], tasks: [{ id: 't1', owner_id: talent.id }], changes: [{ id: 'c1' }] });
  appliedImport = pv.import_id;
  assert.equal(get(db, 'SELECT COUNT(*) n FROM analytics_snapshots')!.n, before + 1, 'one new weekly snapshot');
  const after = get(db, 'SELECT * FROM analytics_snapshots WHERE id = ?', existing.id)!;
  assert.equal(JSON.parse(after.metrics).views, oldViews, 'conflicting value kept unless chosen');
  assert.equal(JSON.parse(after.metrics).profile_visits, 1200);
  assert.match(after.source, /ChatGPT connector import: Windsor\.ai \(user-imported/);
  assert.ok(!/verified/i.test(after.source));
  const task = get(db, `SELECT * FROM tasks WHERE title = 'Brief Riya on GRWM series'`)!;
  assert.equal(task.owner_id, talent.id);
  assert.equal(task.related_type, 'influencers');
  assert.ok(task.description.includes('<script>alert(1)</script>'), 'imported text stored as plain data');
  assert.equal(get(db, 'SELECT availability_notes FROM influencers WHERE id = 1')!.availability_notes, 'Busy with Diwali shoots till 20 Oct');
  assert.equal(out.applied.filter((a) => a.kind === 'analysis').length, 1);
  const d = dashboard(db, founder);
  assert.ok(d.chatgpt!.recommendations.some((x: Row) => x.text === 'Post 3 GRWM reels'));
  assert.ok(all(db, `SELECT * FROM audit_log WHERE action = 'apply' AND entity = 'ai_imports'`).length > 0);
  // The same result cannot be imported twice.
  assert.throws(() => previewImport(db, founder, JSON.stringify(r)), /already imported/);
});

test('atomic: a failing item rolls back everything selected with it', () => {
  const key = createExport(db, founder, { type: 'influencer_growth', ids: [3], from: '2026-09-28', to: '2026-10-04' });
  const r = result(key, { connector_metrics: [connector('influencers:3', 'x', '2026-10-05', { views: 999 })], proposed_tasks: [{ id: 't1', title: 'Atomic task', description: null, related_record: null, owner_hint: null, priority: 'normal', due_date: null }] });
  const pv = previewImport(db, founder, JSON.stringify(r));
  const snaps = get(db, 'SELECT COUNT(*) n FROM analytics_snapshots')!.n;
  assert.throws(() => applyImport(db, founder, pv.import_id, { analysis: true, metrics: [{ index: 0, resolve_ref: 'influencers:3' }], tasks: [{ id: 't1', owner_id: 999999 }] }), /Owner refers to a record that does not exist/);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM analytics_snapshots')!.n, snaps);
  assert.equal(get(db, `SELECT COUNT(*) n FROM tasks WHERE title = 'Atomic task'`)!.n, 0);
  assert.equal(get(db, `SELECT COUNT(*) n FROM ai_analyses WHERE export_key = ?`, key)!.n, 0);
  assert.equal(get(db, 'SELECT status FROM ai_imports WHERE id = ?', pv.import_id)!.status, 'previewed');
});

test('finance: AI output never changes money; planning changes need explicit confirmation', () => {
  const key = createExport(db, founder, { type: 'finance_summary' });
  const inv = listInvoices(db, today(db), { open: true })[0];
  const cashBefore = cashPosition(db, today(db)).cash;
  // Transactions are not even an allowed entity in the schema.
  assert.throws(() => previewImport(db, founder, JSON.stringify(result(key, { proposed_changes: [{ id: 'x', action: 'update', entity: 'transactions', record: 'invoices:1', fields: { amount: 1 }, reason: 'r' }] }))), /does not match/);
  const r = result(key, {
    proposed_changes: [
      { id: 'amt', action: 'update', entity: 'invoices', record: `invoices:${inv.id}`, fields: { subtotal: 1 }, reason: 'ChatGPT thinks it is smaller' },
      { id: 'date', action: 'update', entity: 'invoices', record: `invoices:${inv.id}`, fields: { expected_date: '2026-11-30', confidence: 'at_risk' }, reason: 'Brand said payment is delayed' },
    ],
  });
  const pv = previewImport(db, founder, JSON.stringify(r));
  assert.equal(pv.changes[0].fields[0].ok, false, 'amounts are not importable');
  assert.equal(pv.changes[1].financial, true);
  assert.throws(() => applyImport(db, founder, pv.import_id, { changes: [{ id: 'amt' }] }), /not allowed/);
  assert.throws(() => applyImport(db, founder, pv.import_id, { changes: [{ id: 'date' }] }), /I confirm/);
  applyImport(db, founder, pv.import_id, { changes: [{ id: 'date', confirm_financial: true }] });
  const now = listInvoices(db, today(db), { ids: [inv.id] } as any).find((x) => x.id === inv.id)!;
  assert.equal(now.expected_date, '2026-11-30');
  assert.equal(now.total, inv.total, 'invoice amount untouched');
  assert.equal(now.outstanding, inv.outstanding);
  assert.equal(cashPosition(db, today(db)).cash, cashBefore, 'cash is recalculated from stored transactions only');
});

test('stale exports: records changed after export are listed and need acknowledgement', () => {
  const camp = get(db, `SELECT id FROM campaigns WHERE name LIKE '%Diwali%'`)!.id;
  const key = createExport(db, campaignManager, { type: 'campaign_performance', ids: [camp] });
  update(db, 'campaigns', camp, { notes: 'Changed after export' });
  const r = result(key, { proposed_changes: [{ id: 'l', action: 'update', entity: 'campaigns', record: `campaigns:${camp}`, fields: { lessons: 'Brief creators earlier' }, reason: 'Delays' }] });
  const pv = previewImport(db, campaignManager, JSON.stringify(r));
  assert.ok(pv.stale.some((s: Row) => s.ref === `campaigns:${camp}`));
  assert.equal(pv.changes[0].stale, true);
  assert.throws(() => applyImport(db, campaignManager, pv.import_id, { changes: [{ id: 'l' }] }), /changed after the export/);
  applyImport(db, campaignManager, pv.import_id, { changes: [{ id: 'l', acknowledge_stale: true }] });
  assert.equal(get(db, 'SELECT lessons FROM campaigns WHERE id = ?', camp)!.lessons, 'Brief creators earlier');
});

test('permissions are enforced on every imported item', () => {
  const key = createExport(db, campaignManager, { type: 'campaign_performance', ids: [get(db, `SELECT id FROM campaigns WHERE name LIKE '%Diwali%'`)!.id] });
  const r = result(key, { connector_metrics: [connector('influencers:1', 'riyaglows', '2026-10-05', { views: 10 })] });
  const pv = previewImport(db, campaignManager, JSON.stringify(r));
  assert.equal(pv.connector[0].permitted, false);
  assert.throws(() => applyImport(db, campaignManager, pv.import_id, { metrics: [{ index: 0 }] }), /cannot save platform metrics/);
  assert.throws(() => previewImport(db, talent, JSON.stringify(r)), /cannot use/);
});

test('undo restores previous values, archives created records and keeps history', () => {
  const imp = get(db, 'SELECT * FROM ai_imports WHERE id = ?', appliedImport)!;
  assert.throws(() => undoImport(db, founder, appliedImport, ''), /why/);
  const out = undoImport(db, founder, appliedImport, 'Wrong week');
  assert.deepEqual(out.skipped, []);
  assert.equal(get(db, 'SELECT availability_notes FROM influencers WHERE id = 1')!.availability_notes, null);
  const restored = get(db, `SELECT * FROM analytics_snapshots WHERE influencer_id = 1 AND period_start = '2026-09-28'`)!;
  assert.equal(JSON.parse(restored.metrics).profile_visits ?? null, null, 'previous version restored');
  assert.ok(get(db, `SELECT archived_at FROM analytics_snapshots WHERE influencer_id = 2 AND period_start = '2026-10-05'`)!.archived_at, 'created snapshot archived, not deleted');
  assert.ok(get(db, `SELECT archived_at FROM tasks WHERE title = 'Brief Riya on GRWM series'`)!.archived_at);
  assert.equal(get(db, 'SELECT status FROM ai_analyses WHERE import_id = ?', appliedImport)!.status, 'undone');
  assert.equal(dashboard(db, founder).chatgpt!.recommendations.length, 0);
  assert.ok(all(db, `SELECT * FROM audit_log WHERE action = 'undo'`).length === 1);
  assert.throws(() => undoImport(db, founder, appliedImport, 'again'), /not found/);
  // A corrected result (new result_id) can be imported afterwards; the archived week is not resurrected.
  const r = { ...JSON.parse(imp.result), result_id: `${imp.export_key}-r2`, proposed_changes: [], proposed_tasks: [], connector_metrics: [JSON.parse(imp.result).connector_metrics[1]] };
  r.connector_metrics[0].metrics.followers_end = null;
  const pv = previewImport(db, founder, JSON.stringify(r));
  applyImport(db, founder, pv.import_id, { metrics: [{ index: 0 }] });
  const snap = get(db, `SELECT * FROM analytics_snapshots WHERE influencer_id = 2 AND period_start = '2026-10-05'`)!;
  assert.equal(snap.archived_at, null);
  assert.equal(JSON.parse(snap.metrics).followers_end, null, 'values from the undone import are not brought back');
});

test('weekly preparation: package prepared once with a reminder; not done until a result is applied', async () => {
  const a = enqueue(db, 'chatgpt_weekly_prep', { from: '2026-09-28' }, 'chatgpt_prep:2026-09-28');
  assert.equal(enqueue(db, 'chatgpt_weekly_prep', { from: '2026-09-28' }, 'chatgpt_prep:2026-09-28'), a);
  await runDueJobs(db);
  enqueue(db, 'chatgpt_weekly_prep', { from: '2026-09-28' }, 'chatgpt_prep:2026-09-28:retry');
  await runDueJobs(db);
  const weekly = all(db, `SELECT * FROM ai_exports WHERE trigger = 'weekly'`);
  assert.equal(weekly.length, 1, 'one package per week');
  assert.deepEqual([JSON.parse(weekly[0].params).from, JSON.parse(weekly[0].params).to], ['2026-09-28', '2026-10-04']);
  assert.ok(get(db, `SELECT * FROM notifications WHERE kind = 'chatgpt' AND user_id = ?`, founder.id));
  const d = dashboard(db, founder);
  assert.equal(d.chatgpt!.weekly!.status, 'awaiting_import');
  assert.ok(d.attention.some((x: Row) => x.kind === 'chatgpt'));
  // A checked-but-unapplied result is still not "done".
  previewImport(db, founder, JSON.stringify(result(weekly[0].export_key)));
  assert.equal(dashboard(db, founder).chatgpt!.weekly!.status, 'awaiting_apply');
});

test('PDF: imported commentary is labelled and only shareable analyses reach external reports', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-ai-'));
  const key = createExport(db, founder, { type: 'influencer_growth', ids: [1], from: '2026-09-28', to: '2026-10-04' });
  const pv = previewImport(db, founder, JSON.stringify(result(key, { record_ids: ['influencers:1'], summary: 'Riya grew steadily', recommendations: [{ id: 'r', record: 'influencers:1', text: 'Keep GRWM reels', rationale: 'Best format', priority: 'normal', metric_to_watch: null }] })));
  applyImport(db, founder, pv.import_id, { analysis: true });
  const analysis = get(db, 'SELECT id FROM ai_analyses WHERE import_id = ?', pv.import_id)!.id;
  const params = { influencer_ids: [1], from: '2026-09-28', to: '2026-10-04', analysis_id: analysis };
  assert.throws(() => requestReport(db, founder, { report_type: 'influencer_growth', audience: 'external', params }), /shareable/);
  const id = requestReport(db, founder, { report_type: 'influencer_growth', audience: 'internal', params });
  await produce(db, dir, id);
  const run = get(db, 'SELECT * FROM report_runs WHERE id = ?', id)!;
  assert.equal(run.status, 'completed');
  assert.equal(JSON.parse(run.snapshot).chatgpt_analysis.id, analysis);
  assert.ok(readFileSync(join(dir, 'reports', run.file)).length > 1000);
  // Multi-creator report with the editor workload report alongside.
  const multi = requestReport(db, founder, { report_type: 'influencer_growth', audience: 'internal', params: { influencer_ids: [1, 2], from: '2026-09-01', to: '2026-10-04' } });
  await produce(db, dir, multi);
  assert.equal(JSON.parse(get(db, 'SELECT snapshot FROM report_runs WHERE id = ?', multi)!.snapshot).parts.length, 2);
  const ed = requestReport(db, founder, { report_type: 'editor_workload', audience: 'internal', params: {} });
  await produce(db, dir, ed);
  assert.equal(get(db, 'SELECT status FROM report_runs WHERE id = ?', ed)!.status, 'completed');
});
