/**
 * Supabase Storage as the app's persistent copy, for hosts whose disk is wiped on restart (Render free, Hugging Face).
 * On start the database and files are downloaded; afterwards every database change and file write is copied up.
 * ponytail: whole-database snapshots (gzipped) every 15s when something changed; fine for a small team's database.
 * Turned on by SUPABASE_URL + SUPABASE_SERVICE_KEY. Without them nothing here runs.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Db } from './db.ts';

// Read when first needed (after index.ts has loaded .env), not when this module is imported.
const conf = () => ({ url: process.env.SUPABASE_URL?.replace(/\/+$/, ''), key: process.env.SUPABASE_SERVICE_KEY ?? '', bucket: process.env.SUPABASE_BUCKET || 'socialmoghq' });
export const cloudEnabled = () => Boolean(conf().url && conf().key);
const DB_OBJECT = 'db/hq.sqlite.gz';
const LEASE_OBJECT = 'db/lease.json';
/** Folders under DATA_DIR that are mirrored file by file. */
const FOLDERS = ['uploads', 'uploads/photos', 'reports'];

/** How long a new copy of the app waits for the old one to hand over (save its last changes) before downloading. */
const HANDOVER_MS = Number(process.env.SUPABASE_HANDOVER_MS ?? 25_000);

let dataDir = '';
let lastChanges = -1;
let saving: Promise<void> | null = null;
const boot = randomUUID();
const state = { last_saved_at: null as string | null, last_error: null as string | null, pending: new Set<string>(), superseded: false, handed_over: false };
const inflight = new Set<string>();

function headers(extra: Record<string, string> = {}): Record<string, string> {
  // New-style secret keys (sb_secret_…) go in apikey only; legacy service_role JWTs also as the bearer token.
  const { key } = conf();
  return { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }), ...extra };
}
const objectUrl = (path: string) => `${conf().url}/storage/v1/object/${conf().bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

async function fail(res: Response, what: string): Promise<never> {
  throw new Error(`Supabase ${what} failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

/** Bytes of an object, or null when it does not exist. */
async function download(path: string): Promise<Buffer | null> {
  const res = await fetch(objectUrl(path), { headers: headers() });
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  const body = await res.text().catch(() => '');
  // Storage answers a missing object with 404, or 400 + {"statusCode":"404"} on older versions.
  if (res.status === 404 || (res.status === 400 && /not.?found|"404"/i.test(body))) return null;
  throw new Error(`Supabase download of ${path} failed: ${res.status} ${body.slice(0, 200)}`);
}

async function upload(path: string, body: Buffer, type = 'application/octet-stream') {
  const res = await fetch(objectUrl(path), { method: 'POST', headers: headers({ 'content-type': type, 'x-upsert': 'true' }), body: new Uint8Array(body) });
  if (!res.ok) await fail(res, `upload of ${path}`);
}

async function remove(paths: string[]) {
  if (!paths.length) return;
  const res = await fetch(`${conf().url}/storage/v1/object/${conf().bucket}`, { method: 'DELETE', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefixes: paths }) });
  if (!res.ok) await fail(res, 'delete');
}

/** File names directly inside a folder (sub-folders are left out). */
async function list(folder: string): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${conf().url}/storage/v1/object/list/${conf().bucket}`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefix: folder, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) await fail(res, `listing of ${folder}`);
    const rows = (await res.json()) as { name: string; id: string | null }[];
    names.push(...rows.filter((r) => r.id).map((r) => r.name));
    if (rows.length < 1000) return names;
  }
}

async function ensureBucket() {
  const { url, bucket } = conf();
  const res = await fetch(`${url}/storage/v1/bucket`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ id: bucket, name: bucket, public: false }) });
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  if (!/already exists|Duplicate|409/i.test(body) && res.status !== 409) throw new Error(`Supabase bucket "${bucket}" could not be created: ${res.status} ${body.slice(0, 200)}`);
}

async function inBatches<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/**
 * Before the database opens: bring down the saved database and files.
 * Refuses to start (throws) when it cannot tell what is saved, so an empty database never replaces the real one.
 */
export async function restoreFromCloud(dir: string): Promise<void> {
  if (!cloudEnabled()) return;
  dataDir = dir;
  lastChanges = -1;
  await ensureBucket();
  const local = join(dir, 'hq.sqlite');
  const marker = join(dir, '.supabase-linked');
  const link = `${conf().url}/${conf().bucket}\n`;
  const linked = existsSync(marker) && readFileSync(marker, 'utf8') === link;
  if (existsSync(local) && !linked && process.env.SUPABASE_OVERWRITE !== '1' && (await download(DB_OBJECT))) {
    throw new Error(
      `Both this server and Supabase have a database. Nothing was changed.\n` +
        `To use the one in Supabase: stop the app, delete ${local} (and hq.sqlite-wal / -shm), start again.\n` +
        `To replace the one in Supabase with this server's: start once with SUPABASE_OVERWRITE=1.`,
    );
  }
  // Take over. A copy that is still running (a redeploy) sees this within 15s, saves its last changes and
  // then refuses new ones; give it time to do that unless it said it stopped cleanly.
  const lease = await readLease();
  await writeLease({});
  if (lease && !lease.released && lease.boot !== boot) {
    console.log(`Waiting ${HANDOVER_MS / 1000}s for the previous copy of the app to save its last changes…`);
    await new Promise((r) => setTimeout(r, HANDOVER_MS));
  }
  const saved = existsSync(local) ? null : await download(DB_OBJECT);
  if (saved) {
    for (const f of ['hq.sqlite-wal', 'hq.sqlite-shm']) rmSync(join(dir, f), { force: true });
    writeFileSync(local, gunzipSync(saved));
    console.log(`Restored the database from Supabase (${(saved.length / 1024).toFixed(0)} KB compressed).`);
  }
  let fetched = 0;
  for (const folder of FOLDERS) {
    const missing = (await list(folder)).filter((n) => !existsSync(join(dir, folder, n)));
    mkdirSync(join(dir, folder), { recursive: true });
    await inBatches(missing, 8, async (n) => {
      const bytes = await download(`${folder}/${n}`);
      if (bytes) writeFileSync(join(dir, folder, n), bytes), fetched++;
    });
  }
  if (fetched) console.log(`Restored ${fetched} file(s) from Supabase.`);
  writeFileSync(marker, link);
}

type Lease = { boot: string; at: string; released?: boolean };
async function readLease(): Promise<Lease | null> {
  const b = await download(LEASE_OBJECT);
  return b ? JSON.parse(b.toString()) : null;
}
const writeLease = (extra: Partial<Lease>) => upload(LEASE_OBJECT, Buffer.from(JSON.stringify({ boot, at: new Date().toISOString(), ...extra })), 'application/json');

function snapshot(db: Db): Buffer {
  const tmp = join(dataDir, `.snapshot-${boot}.sqlite`);
  try {
    rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    return gzipSync(readFileSync(tmp));
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * Upload the database if anything changed since the last upload. If a newer copy of the app has taken over,
 * hand over instead: upload the last changes once, then stop saving (and refuseWritesWhenSuperseded blocks new ones).
 */
export function saveDatabase(db: Db, force = false): Promise<void> {
  if (!cloudEnabled() || state.handed_over) return Promise.resolve();
  if (saving) return saving;
  saving = (async () => {
    try {
      const changes = Number((db.prepare('SELECT total_changes() n').get() as { n: number }).n);
      const owner = (await readLease())?.boot === boot;
      if (!owner) state.superseded = true;
      if (owner && !force && changes === lastChanges) return;
      if (!owner && changes === lastChanges) return void (state.handed_over = true);
      await upload(DB_OBJECT, snapshot(db), 'application/gzip');
      lastChanges = changes;
      state.last_saved_at = new Date().toISOString();
      state.last_error = null;
      if (!owner) state.handed_over = true;
    } catch (err) {
      state.last_error = (err as Error).message;
      console.error('Supabase save', err);
    } finally {
      if (state.superseded) state.last_error = 'A newer copy of the app has taken over. Reload the page.';
      saving = null;
    }
  })();
  return saving;
}

/** Express middleware: a copy that has been taken over refuses changes, so nothing typed into it is silently lost. */
export function refuseWritesWhenSuperseded(req: { method: string }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) {
  if (state.superseded && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return res.status(503).json({ error: 'The app was just updated or restarted. Reload the page and try again; nothing was saved.' });
  next();
}

/** Copy a file written under DATA_DIR (path relative to it) to Supabase. Failures stay pending and are retried. */
export function mirrorFile(rel: string, after?: () => Promise<void>) {
  if (!cloudEnabled()) return;
  state.pending.add(rel);
  if (inflight.has(rel)) return;
  inflight.add(rel);
  void upload(rel, readFileSync(join(dataDir, rel)))
    .then(async () => {
      state.pending.delete(rel);
      await after?.();
    })
    .catch((err) => console.error('Supabase file copy', err))
    .finally(() => inflight.delete(rel));
}

export function unmirrorFile(rel: string) {
  if (!cloudEnabled()) return;
  state.pending.delete(rel);
  void remove([rel]).catch((err) => console.error('Supabase file delete', err));
}

/** Daily backup copy: kept in Supabase under backups/, newest 14 only (the server's own disk may not keep them). */
export function mirrorBackup(rel: string) {
  mirrorFile(rel, async () => {
    const daily = (await list('backups')).filter((n) => n.startsWith('daily-')).sort();
    await remove(daily.slice(0, Math.max(0, daily.length - 14)).map((n) => `backups/${n}`));
  });
}

/** Saves every 15s when something changed (and notices a takeover), retries file copies, and saves once more on stop. */
export function startCloudSync(db: Db) {
  if (!cloudEnabled()) return;
  setInterval(() => {
    void saveDatabase(db);
    for (const rel of state.pending) if (existsSync(join(dataDir, rel))) mirrorFile(rel);
    else state.pending.delete(rel);
  }, 15_000).unref();
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, async () => {
      console.log(`${sig}: saving to Supabase before stopping…`);
      try {
        for (let i = 0; i < 40 && inflight.size; i++) await new Promise((r) => setTimeout(r, 250));
        // A save already running may predate the last change, so wait for it and save again.
        await saving;
        await saveDatabase(db);
        // Stopped cleanly: the next start need not wait for a handover.
        if (!state.superseded && !state.last_error) await writeLease({ released: true });
      } catch (err) {
        console.error('Supabase save on stop', err);
      }
      process.exit(0);
    });
  }
}

export function cloudStatus() {
  return {
    enabled: cloudEnabled(),
    bucket: cloudEnabled() ? conf().bucket : null,
    last_saved_at: state.last_saved_at,
    last_error: state.last_error,
    files_not_copied: state.pending.size,
    superseded: state.superseded,
  };
}
