import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, insert, openDb, run, tx } from '../src/server/db.ts';
import { errorHandler, hashPassword } from '../src/server/app.ts';
import { removeDemo, seedDemo } from '../src/server/seed.ts';

process.env.HQ_TODAY = '2026-10-12';

test('remove demo data: TDS register included; a real record on demo data blocks it with a reason and the database stays usable', () => {
  const db = openDb(':memory:');
  insert(db, 'users', { name: 'Founder', email: 'f@test.in', role: 'founder', status: 'active', password_hash: hashPassword('founder-password') });
  seedDemo(db);
  assert.ok(get(db, 'SELECT COUNT(*) n FROM tds_credits')!.n > 0, 'demo has a TDS register entry');
  const camp = get(db, 'SELECT id FROM campaigns WHERE is_demo = 1 LIMIT 1')!.id;
  const inf = get(db, 'SELECT id FROM influencers WHERE is_demo = 1 LIMIT 1')!.id;
  const real = insert(db, 'deliverables', { campaign_id: camp, influencer_id: inf, title: 'Real reel', type: 'reel', platform: 'instagram' });
  assert.throws(() => removeDemo(db), /real records still point at demo data \(deliverables → /);
  assert.ok(get(db, 'SELECT COUNT(*) n FROM campaigns WHERE is_demo = 1')!.n > 0, 'nothing removed');
  const after = tx(db, () => insert(db, 'tasks', { title: 'Still works' }));
  assert.ok(get(db, 'SELECT id FROM tasks WHERE id = ?', after), 'later saves still work');
  run(db, 'DELETE FROM deliverables WHERE id = ?', real);
  // The scheduler's weekly report for a demo creator, made after seeding (not flagged as demo), goes too.
  insert(db, 'weekly_reports', { influencer_id: inf, period_start: '2026-10-05', version: 9, content: {} });
  const counts = removeDemo(db);
  assert.ok(counts.tds_credits > 0);
  for (const t of ['campaigns', 'influencers', 'invoices', 'transactions', 'settlements', 'accounts', 'tds_credits', 'weekly_reports']) assert.equal(get(db, `SELECT COUNT(*) n FROM ${t} WHERE is_demo = 1`)!.n, 0, t);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM weekly_reports')!.n, 0, 'generated weekly reports removed');
  assert.equal(get(db, 'SELECT COUNT(*) n FROM users')!.n, 1, 'only the founder is left');
});

test('a duplicate record gets a plain message instead of a server error', () => {
  const db = openDb(':memory:');
  const camp = insert(db, 'campaigns', { name: 'C' });
  const inf = insert(db, 'influencers', { name: 'I' });
  insert(db, 'campaign_creators', { campaign_id: camp, influencer_id: inf });
  let err: unknown;
  try {
    insert(db, 'campaign_creators', { campaign_id: camp, influencer_id: inf });
  } catch (e) {
    err = e;
  }
  const out: Record<string, any> = {};
  const res = { status: (c: number) => ((out.status = c), res), json: (b: unknown) => (out.body = b) };
  errorHandler(err, { path: '/api/campaign_creators', method: 'POST' } as any, res as any, () => {});
  assert.equal(out.status, 409);
  assert.match(out.body.error, /^That already exists: another campaign creator has the same .+\. Nothing was saved\.$/);
});
