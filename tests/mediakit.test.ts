import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createApp, errorHandler, hashPassword } from '../src/server/app.ts';
import { get, insert, openDb, update, type User } from '../src/server/db.ts';
import { DEMO_PASSWORD, seedDemo } from '../src/server/seed.ts';
import { creatorStats } from '../src/server/domain.ts';
import { produce, requestReport } from '../src/server/reports.ts';

process.env.HQ_TODAY = '2026-10-11';
const db = openDb(':memory:');
const dataDir = mkdtempSync(join(tmpdir(), 'hq-kit-'));
let server: Server;
let base = '';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  insert(db, 'users', { name: 'Founder', email: 'founder@test.in', role: 'founder', status: 'active', password_hash: hashPassword('founder-password') });
  seedDemo(db);
  const app = createApp(db, { dataDir });
  app.use(errorHandler);
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

const founder = () => get(db, `SELECT id, name, email, role, editor_id, influencer_id, brand_id FROM users WHERE email = 'founder@test.in'`) as User;
async function login(email: string, password = DEMO_PASSWORD) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hq': '1' }, body: JSON.stringify({ email, password }) });
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  return (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: { cookie, 'x-hq': '1', ...(init.headers ?? {}) } });
}

test('previous average views: latest organic posts, else the profile figure with its source; never invented', () => {
  const inf = insert(db, 'influencers', {
    name: 'Kit Test', handle: '@kittest', relationship: 'exclusive', niches: ['Food'],
    platforms: [{ platform: 'instagram', handle: '@kittest', followers: 50000, avg_views: 9999, source: 'Insights screenshot', updated_at: '2026-10-01' }, { platform: 'youtube', handle: '@kittest', followers: 1000 }],
    rate_card: [{ deliverable: 'reel', platform: 'instagram', rate: 2000000, brand_rate: 2500000, negotiated_rate: 1500000 }, { deliverable: 'story', rate: 500000 }],
  });
  let s = creatorStats(db, [inf], { commercials: true }).get(inf)!;
  const ig = s.platforms.find((p: any) => p.platform === 'instagram');
  assert.equal(ig.avg_views, 9999, 'fewer than 3 posts: profile figure');
  assert.match(ig.views_basis, /Insights screenshot, as of 1 Oct 2026/);
  assert.equal(ig.url, 'https://www.instagram.com/kittest/');
  const yt = s.platforms.find((p: any) => p.platform === 'youtube');
  assert.equal(yt.avg_views, null, 'nothing recorded stays unavailable');
  assert.equal(yt.views_basis, null);
  assert.equal(yt.url, 'https://www.youtube.com/@kittest');
  [1000, 2000, 3000, 4000].forEach((views, i) => insert(db, 'posts', { influencer_id: inf, platform: 'instagram', external_id: `k${i}`, permalink: `https://instagram.com/p/k${i}`, published_at: `2026-10-0${i + 2}T10:00:00Z`, promotion: 'organic', metrics: { views, reach: views, likes: views / 10 } }));
  insert(db, 'posts', { influencer_id: inf, platform: 'instagram', external_id: 'paid', permalink: 'https://instagram.com/p/paid', published_at: '2026-10-08T10:00:00Z', promotion: 'paid', metrics: { views: 1_000_000 } });
  s = creatorStats(db, [inf], { commercials: true }).get(inf)!;
  const ig2 = s.platforms.find((p: any) => p.platform === 'instagram');
  assert.equal(ig2.avg_views, 2500, 'boosted posts are left out');
  assert.equal(ig2.median_views, 2500);
  assert.match(ig2.views_basis, /Last 4 organic posts, 2 Oct 2026 – 5 Oct 2026/);
  assert.equal(ig2.engagement_rate, 10);
  assert.deepEqual(s.commercials.map((c: any) => c.price), [2500000, 500000], 'brand price first, else rate card');
  assert.equal(s.starting_price, 500000);
  assert.ok(!JSON.stringify(s).includes('1500000'), 'negotiated rate never exposed');
  assert.equal(s.top_content[0].views, 4000);
  assert.equal(creatorStats(db, [inf], { commercials: false }).get(inf)!.commercials, null);
});

test('media kits: whole roster grouped by primary category; category kits filter by any category; brand-safe content', async () => {
  const f = founder();
  const whole = requestReport(db, f, { report_type: 'roster', audience: 'external', params: { recipient: 'Glow Co' } });
  await produce(db, dataDir, whole);
  const w = get(db, 'SELECT * FROM report_runs WHERE id = ?', whole)!;
  assert.equal(w.status, 'completed', w.error);
  const snap = JSON.parse(w.snapshot);
  const all = snap.categories.flatMap((c: any) => c.creators);
  assert.equal(new Set(all).size, all.length, 'each creator appears once in the whole kit');
  assert.ok(!snap.categories.some((c: any) => c.creators.includes(get(db, `SELECT id FROM influencers WHERE relationship = 'prospect' LIMIT 1`)!.id)), 'prospects left out unless selected');
  const text = JSON.stringify(snap) + readFileSync(join(dataDir, 'reports', w.csv_file), 'utf8');
  for (const internal of ['negotiated', 'commission', 'pan', 'bank_details', 'conflicts', 'internal_notes']) assert.ok(!text.includes(internal), `kit must not include ${internal}`);
  assert.ok(readFileSync(join(dataDir, 'reports', w.file)).length > 5000);

  const food = requestReport(db, f, { report_type: 'roster', audience: 'external', params: { category: 'FOOD' } });
  await produce(db, dataDir, food);
  const fs = JSON.parse(get(db, 'SELECT snapshot FROM report_runs WHERE id = ?', food)!.snapshot);
  assert.equal(fs.categories.length, 1);
  assert.equal(fs.category, 'food');
  for (const id of fs.categories[0].creators) assert.ok(JSON.parse(get(db, 'SELECT niches FROM influencers WHERE id = ?', id)!.niches).some((n: string) => n.toLowerCase() === 'food'));

  const none = requestReport(db, f, { report_type: 'roster', audience: 'external', params: { category: 'no-such-category' } });
  await assert.rejects(produce(db, dataDir, none), /No active creators/);

  const noPrices = requestReport(db, f, { report_type: 'roster', audience: 'external', params: { sections: ['overview', 'comparison', 'profiles'] } });
  await produce(db, dataDir, noPrices);
  const np = JSON.parse(get(db, 'SELECT snapshot FROM report_runs WHERE id = ?', noPrices)!.snapshot);
  assert.equal(np.commercials, false);
  assert.ok(np.kit.every((k: any) => k.commercials === null));
});

test('creator photos: PNG/JPEG only, talent managers upload, editors cannot view; photo goes into the kit', async () => {
  const riya = get(db, `SELECT id FROM influencers WHERE handle = '@riyaglows'`)!.id;
  const tm = await login('sana@demo.socialmog.in');
  const bad = await tm(`/api/influencers/${riya}/photo`, { method: 'POST', body: Buffer.from('<svg onload="alert(1)"/>'), headers: { 'content-type': 'image/png' } });
  assert.equal(bad.status, 400, 'declared type is not trusted');
  const ok = await tm(`/api/influencers/${riya}/photo`, { method: 'POST', body: PNG, headers: { 'content-type': 'image/png' } });
  assert.equal(ok.status, 200);
  const img = await tm(`/api/influencers/${riya}/photo`);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
  const cm = await login('aditya@demo.socialmog.in');
  assert.equal((await cm(`/api/influencers/${riya}/photo`, { method: 'POST', body: PNG })).status, 403, 'campaign managers cannot change creator profiles');
  const ed = await login('ishaan@demo.socialmog.in');
  assert.equal((await ed(`/api/influencers/${riya}/photo`)).status, 403);
  assert.equal((await ed('/api/influencers/stats')).status, 403);
  const stats = await (await tm('/api/influencers/stats')).json();
  assert.ok(stats.rows.find((r: any) => r.id === riya).commercials.length > 0, 'talent managers see commercials');
  const kit = requestReport(db, founder(), { report_type: 'roster', audience: 'external', params: { influencer_ids: [riya] } });
  await produce(db, dataDir, kit);
  assert.equal(get(db, 'SELECT status FROM report_runs WHERE id = ?', kit)!.status, 'completed');
  assert.equal((await tm(`/api/influencers/${riya}/photo`, { method: 'DELETE' })).status, 200);
  assert.equal((await tm(`/api/influencers/${riya}/photo`)).status, 404);
  update(db, 'influencers', riya, {});
});
