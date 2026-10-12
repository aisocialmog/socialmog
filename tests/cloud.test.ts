import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get, insert, openDb } from '../src/server/db.ts';

// A stand-in for Supabase Storage: just the endpoints the app uses, held in memory.
const objects = new Map<string, Buffer>();
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  const url = decodeURIComponent(req.url!);
  if (req.headers.apikey !== 'sb_secret_test') return res.writeHead(401).end();
  if (url === '/storage/v1/bucket') return res.writeHead(objects.has('.bucket') ? 409 : (objects.set('.bucket', Buffer.alloc(0)), 200)).end('{"error":"Duplicate"}');
  if (url === '/storage/v1/object/list/hq') {
    const { prefix } = JSON.parse(body.toString());
    const rows = [...objects.keys()].filter((k) => k.startsWith(`${prefix}/`)).map((k) => k.slice(prefix.length + 1));
    const out = [...new Set(rows.map((r) => (r.includes('/') ? r.split('/')[0] : r)))].map((n) => ({ name: n, id: rows.includes(n) ? n : null }));
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  }
  if (url === '/storage/v1/object/hq' && req.method === 'DELETE') {
    for (const p of JSON.parse(body.toString()).prefixes) objects.delete(p);
    return res.writeHead(200).end('[]');
  }
  const path = url.replace('/storage/v1/object/hq/', '');
  if (req.method === 'POST') return objects.set(path, body), res.writeHead(200).end('{}');
  if (!objects.has(path)) return res.writeHead(400).end('{"statusCode":"404","error":"not_found","message":"Object not found"}');
  res.writeHead(200).end(objects.get(path));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
process.env.SUPABASE_SERVICE_KEY = 'sb_secret_test';
process.env.SUPABASE_BUCKET = 'hq';
const cloud = await import('../src/server/cloud.ts');
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
};

test('Supabase saving: first start, save, wiped disk restores data and files, never overwrites the real copy with an empty one', async (t) => {
  t.after(() => server.close());
  // First start: nothing saved yet, so a new database is made and saved.
  const dir1 = mkdtempSync(join(tmpdir(), 'hq-cloud-'));
  await cloud.restoreFromCloud(dir1);
  assert.ok(!existsSync(join(dir1, 'hq.sqlite')));
  const db = openDb(join(dir1, 'hq.sqlite'));
  insert(db, 'tasks', { title: 'Saved to the cloud' });
  await cloud.saveDatabase(db);
  assert.ok(objects.has('db/hq.sqlite.gz'));
  assert.ok(cloud.cloudStatus().last_saved_at);
  // Nothing changed: no second upload.
  objects.delete('db/hq.sqlite.gz');
  await cloud.saveDatabase(db);
  assert.ok(!objects.has('db/hq.sqlite.gz'));
  await cloud.saveDatabase(db, true);

  // Files (including names with spaces) are copied up.
  writeFileSync(join(dir1, 'uploads', '7-1-brief v2.pdf'), 'pdf bytes');
  cloud.mirrorFile('uploads/7-1-brief v2.pdf');
  await until(() => objects.has('uploads/7-1-brief v2.pdf') && cloud.cloudStatus().files_not_copied === 0);
  assert.equal(objects.get('uploads/7-1-brief v2.pdf')!.toString(), 'pdf bytes');
  objects.set('uploads/photos/influencer-1-1.jpg', Buffer.from('jpg'));

  // Host restarted with a wiped disk: everything comes back.
  const dir2 = mkdtempSync(join(tmpdir(), 'hq-cloud-'));
  await cloud.restoreFromCloud(dir2);
  const db2 = openDb(join(dir2, 'hq.sqlite'));
  assert.equal(get(db2, 'SELECT title FROM tasks')!.title, 'Saved to the cloud');
  assert.equal(readFileSync(join(dir2, 'uploads', '7-1-brief v2.pdf'), 'utf8'), 'pdf bytes');
  assert.equal(readFileSync(join(dir2, 'uploads', 'photos', 'influencer-1-1.jpg'), 'utf8'), 'jpg');

  // A server that already has its own (unlinked) database refuses to start rather than pick one silently.
  const dir3 = mkdtempSync(join(tmpdir(), 'hq-cloud-'));
  openDb(join(dir3, 'hq.sqlite')).close();
  await assert.rejects(cloud.restoreFromCloud(dir3), /Both this server and Supabase have a database/);

  // Another copy of the app took over (e.g. during a redeploy): this one stops saving and says so.
  objects.set('db/lease.json', Buffer.from(JSON.stringify({ boot: 'someone-else' })));
  const before = objects.get('db/hq.sqlite.gz');
  insert(db2, 'tasks', { title: 'late write' });
  await cloud.saveDatabase(db2);
  assert.equal(objects.get('db/hq.sqlite.gz'), before);
  assert.ok(cloud.cloudStatus().superseded);
  assert.match(cloud.cloudStatus().last_error!, /newer copy of the app/);
});
