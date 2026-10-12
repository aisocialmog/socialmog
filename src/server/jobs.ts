/**
 * Background jobs: a SQLite-backed queue with unique keys (no duplicate scheduled runs),
 * retries with backoff, and founder notifications when a job finally fails.
 * ponytail: in-process polling every 30s; move to a worker process if jobs ever block requests.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { partsInTz, weekStart } from '../shared/dates.ts';
import { mirrorBackup } from './cloud.ts';
import { all, get, getSetting, insert, run, type Db, type Row } from './db.ts';
import { founders, notify } from './app.ts';
import { dashboard } from './domain.ts';
import { today } from './finance.ts';

type Handler = (db: Db, payload: Row) => Promise<unknown> | unknown;
const handlers: Record<string, Handler> = {};
const MAX_ATTEMPTS = 3;

export function registerJob(kind: string, handler: Handler) {
  handlers[kind] = handler;
}

/** Queue a job. With a unique key, a second request for the same key returns the existing job. */
export function enqueue(db: Db, kind: string, payload: Row = {}, uniqueKey?: string, runAt = new Date()): number {
  if (uniqueKey) {
    const existing = get(db, 'SELECT id, status FROM jobs WHERE unique_key = ?', uniqueKey);
    if (existing) return existing.id;
  }
  return insert(db, 'jobs', { kind, payload, unique_key: uniqueKey ?? null, status: 'queued', attempts: 0, run_at: runAt.toISOString() });
}

/** Re-run a failed job now (e.g. "retry" button). */
export function retryJob(db: Db, id: number) {
  run(db, `UPDATE jobs SET status = 'queued', attempts = 0, run_at = ?, last_error = NULL WHERE id = ? AND status = 'failed'`, new Date().toISOString(), id);
}

let running = false;
export async function runDueJobs(db: Db): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const job of all(db, `SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT 20`, new Date().toISOString())) {
      const handler = handlers[job.kind];
      run(db, `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`, new Date().toISOString(), job.id);
      try {
        if (!handler) throw new Error(`No handler for job type ${job.kind}`);
        await handler(db, JSON.parse(job.payload ?? '{}'));
        run(db, `UPDATE jobs SET status = 'completed', finished_at = ?, last_error = NULL WHERE id = ?`, new Date().toISOString(), job.id);
      } catch (err) {
        const attempts = job.attempts + 1;
        const message = (err as Error).message?.slice(0, 1000) ?? String(err);
        if (attempts < MAX_ATTEMPTS) {
          const retryAt = new Date(Date.now() + 2 ** attempts * 60_000).toISOString();
          run(db, `UPDATE jobs SET status = 'queued', run_at = ?, last_error = ? WHERE id = ?`, retryAt, message, job.id);
        } else {
          run(db, `UPDATE jobs SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?`, new Date().toISOString(), message, job.id);
          notify(db, founders(db), { kind: 'job_failed', title: `Automation failed: ${job.kind.replace(/_/g, ' ')}`, body: message, link: '/settings/automation', dedupe: `job:${job.id}` });
        }
      }
    }
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------- built-in jobs

registerJob('reminders', (db) => {
  // In-app reminders only; nothing is sent outside the app.
  for (const uid of founders(db)) {
    const user = get(db, 'SELECT id, name, email, role, editor_id, influencer_id, brand_id FROM users WHERE id = ?', uid) as any;
    const week = weekStart(today(db));
    for (const a of dashboard(db, user).attention.filter((x: Row) => x.severity === 'high')) {
      notify(db, [uid], { kind: 'reminder', title: a.title, body: a.detail, link: a.link, dedupe: `att:${a.kind}:${a.link}:${week}` });
    }
  }
});

registerJob('backup', (db, payload) => {
  const dir = join(payload.dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `daily-${new Date().toISOString().slice(0, 10)}.sqlite`);
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  mirrorBackup(`backups/${file.split('/').at(-1)}`);
  const daily = readdirSync(dir).filter((f) => f.startsWith('daily-')).sort();
  for (const old of daily.slice(0, Math.max(0, daily.length - 14))) rmSync(join(dir, old));
});

/** Scheduled hooks registered by other modules (weekly analysis, scheduled reports). */
const schedules: ((db: Db, now: Date, tz: string) => void)[] = [];
export function onTick(fn: (db: Db, now: Date, tz: string) => void) {
  schedules.push(fn);
}

export function tick(db: Db, opts: { dataDir: string }, now = new Date()) {
  const tz = getSetting(db, 'timezone', 'Asia/Kolkata');
  const p = partsInTz(now, tz);
  if (p.hour >= 8) enqueue(db, 'reminders', {}, `reminders:${p.date}`);
  if (p.hour >= 2) enqueue(db, 'backup', { dataDir: opts.dataDir }, `backup:${p.date}`);
  for (const fn of schedules) fn(db, now, tz);
}

export function startScheduler(db: Db, opts: { dataDir: string }) {
  // Jobs interrupted by a restart go back to the queue.
  run(db, `UPDATE jobs SET status = 'queued' WHERE status = 'running'`);
  const loop = async () => {
    try {
      tick(db, opts);
      await runDueJobs(db);
    } catch (err) {
      console.error('scheduler', err);
    }
  };
  setTimeout(loop, 5_000);
  setInterval(loop, 30_000).unref();
}
