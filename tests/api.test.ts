import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createApp, errorHandler, hashPassword } from '../src/server/app.ts';
import { get, insert, openDb } from '../src/server/db.ts';
import { DEMO_PASSWORD, seedDemo } from '../src/server/seed.ts';

process.env.HQ_TODAY = '2026-10-07';
let server: Server;
let base = '';
const db = openDb(':memory:');

before(async () => {
  insert(db, 'users', { name: 'Founder', email: 'founder@test.in', role: 'founder', status: 'active', password_hash: hashPassword('founder-password') });
  seedDemo(db);
  const app = createApp(db, { dataDir: mkdtempSync(join(tmpdir(), 'hq-')) });
  app.use(errorHandler);
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

async function login(email: string, password = DEMO_PASSWORD) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hq': '1' }, body: JSON.stringify({ email, password }) });
  assert.equal(res.status, 200, `login ${email}`);
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  return (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { cookie, 'x-hq': '1', 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

test('unauthenticated and cross-site requests are rejected', async () => {
  assert.equal((await fetch(`${base}/api/dashboard`)).status, 401);
  const founder = await login('founder@test.in', 'founder-password');
  const res = await founder('/api/e/tasks', { method: 'POST', body: JSON.stringify({ title: 'x' }), headers: { 'x-hq': '' } });
  assert.equal(res.status, 403, 'missing CSRF header');
});

test('founder sees finance; dashboard figures come from stored records', async () => {
  const f = await login('founder@test.in', 'founder-password');
  const dash = await (await f('/api/dashboard')).json();
  const pos = await (await f('/api/finance/position?horizon=30')).json();
  assert.equal(dash.finance.cash, pos.cash);
  assert.equal(pos.cash, pos.accounts.filter((a: any) => a.active).reduce((s: number, a: any) => s + a.balance, 0));
  assert.ok(dash.attention.length > 0);
  assert.ok(dash.attention.every((a: any) => a.link.startsWith('/')));
});

test('editor sees only assigned work and own payments', async () => {
  const ed = await login('ishaan@demo.socialmog.in');
  const me = get(db, `SELECT editor_id FROM users WHERE email = 'ishaan@demo.socialmog.in'`)!.editor_id;
  assert.equal((await ed('/api/finance/position')).status, 403);
  assert.equal((await ed('/api/e/campaigns')).status, 403);
  assert.equal((await ed('/api/e/influencers')).status, 403);
  assert.equal((await ed('/api/dashboard')).status, 403);
  const tasks = (await (await ed('/api/e/content_tasks')).json()).rows;
  assert.ok(tasks.length > 0 && tasks.every((t: any) => t.editor_id === me));
  assert.ok(tasks.every((t: any) => t.editor_fee === undefined), 'rates are hidden from editors');
  const other = get(db, 'SELECT id FROM content_tasks WHERE editor_id <> ? LIMIT 1', me)!;
  assert.equal((await ed(`/api/e/content_tasks/${other.id}`)).status, 404);
  const mine = tasks.find((t: any) => t.stage === 'internal_review');
  assert.equal((await ed(`/api/e/content_tasks/${mine.id}`, { method: 'PATCH', body: JSON.stringify({ stage: 'approved' }) })).status, 403);
  assert.equal((await ed(`/api/content/${mine.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approve_internal' }) })).status, 403);
  const pay = await (await ed('/api/my/payments')).json();
  assert.ok(pay.obligations.length > 0 && pay.obligations.every((o: any) => o.editor_id === me));
});

test('field-level redaction by role', async () => {
  const tm = await login('sana@demo.socialmog.in');
  const infs = (await (await tm('/api/e/influencers')).json()).rows;
  assert.ok(infs.length > 0);
  assert.ok(infs.every((i: any) => !('pan' in i) && !('bank_details' in i)), 'identity hidden from talent manager');
  assert.ok(infs.some((i: any) => 'commission_rate' in i), 'talent manager sees commissions');
  assert.equal((await tm('/api/finance/receivables')).status, 403);
  const cm = await login('aditya@demo.socialmog.in');
  assert.equal((await cm('/api/finance/receivables')).status, 200);
  assert.equal((await cm('/api/finance/position')).status, 403, 'bank cash is finance-only');
  const fin = await login('meera@demo.socialmog.in');
  assert.equal((await fin('/api/finance/position')).status, 200);
  assert.equal((await fin('/api/e/campaigns', { method: 'POST', body: JSON.stringify({ name: 'x', brand_id: 1 }) })).status, 403, 'finance cannot create campaigns');
});

test('external users cannot use internal APIs', async () => {
  for (const email of ['neha@demo.socialmog.in', 'riya@demo.socialmog.in']) {
    const ext = await login(email);
    for (const path of ['/api/e/campaigns', '/api/e/influencers', '/api/finance/receivables', '/api/dashboard', '/api/search?q=glow']) {
      const res = await ext(path);
      assert.ok([403].includes(res.status) || (path.startsWith('/api/search') && (await res.json()).results.length === 0), `${email} ${path}`);
    }
  }
});

test('validation messages and duplicate payment protection over HTTP', async () => {
  const f = await login('founder@test.in', 'founder-password');
  let res = await f('/api/e/influencers', { method: 'POST', body: JSON.stringify({ handle: '@x', email: 'not-an-email' }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /required|valid email/);
  const acct = get(db, `SELECT id FROM accounts WHERE name = 'HDFC Current'`)!.id;
  const body = { account_id: acct, txn_date: '2026-10-06', direction: 'in', amount: 100000, category: 'other_income', description: 'Test', idempotency_key: 'k-1' };
  const a = await (await f('/api/finance/transactions', { method: 'POST', body: JSON.stringify(body) })).json();
  const b = await (await f('/api/finance/transactions', { method: 'POST', body: JSON.stringify(body) })).json();
  assert.equal(a.id, b.id, 'double submit returns the same transaction');
  res = await f('/api/finance/transactions', { method: 'POST', body: JSON.stringify({ ...body, idempotency_key: 'k-2' }) });
  assert.equal(res.status, 409, 'same amount/date/account without reference needs confirmation');
});

test('login lockout after repeated failures', async () => {
  for (let i = 0; i < 5; i++) {
    await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hq': '1' }, body: JSON.stringify({ email: 'meera@demo.socialmog.in', password: 'wrong' }) });
  }
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hq': '1' }, body: JSON.stringify({ email: 'meera@demo.socialmog.in', password: DEMO_PASSWORD }) });
  assert.equal(res.status, 429);
});
