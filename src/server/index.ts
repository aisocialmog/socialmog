import express from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp, errorHandler, hashPassword } from './app.ts';
import { get, getSetting, insert, openDb } from './db.ts';
import { cloudEnabled, restoreFromCloud, startCloudSync } from './cloud.ts';
import { backfillTdsCredits } from './finance.ts';
import { startScheduler } from './jobs.ts';
import { seedDemo } from './seed.ts';
import { ENTITIES } from '../shared/schema.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const production = process.env.NODE_ENV === 'production';
// On Railway with a volume attached, data lives on the volume.
const dataDir = resolve(process.env.DATA_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? './data');
mkdirSync(dataDir, { recursive: true });
// Render (and Railway without a volume) wipe the disk on every restart: without Supabase everything typed in would be lost.
const wiped = process.env.RENDER || (process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR);
if (wiped && !cloudEnabled()) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or attach a volume on Railway): this host wipes its disk on every restart, so nothing would be kept.');
// With Supabase set up, the saved database and files come down before anything opens them.
await restoreFromCloud(dataDir);
const db = openDb(join(dataDir, 'hq.sqlite'));

if (!get(db, 'SELECT id FROM users LIMIT 1')) {
  const email = process.env.FOUNDER_EMAIL || 'founder@socialmog.in';
  const password = process.env.FOUNDER_PASSWORD || randomBytes(9).toString('base64url');
  insert(db, 'users', { name: process.env.FOUNDER_NAME || 'Founder', email, role: 'founder', status: 'active', password_hash: hashPassword(password) });
  console.log(`\nCreated founder account: ${email}${process.env.FOUNDER_PASSWORD ? '' : `  password: ${password}  (change it in Settings)`}\n`);
}
// Demo data only ever goes into a brand-new database (the founder login at most), never one holding real records.
if (process.env.SEED_DEMO !== '0' && !getSetting(db, 'demo_seeded', false)) {
  const fresh = get(db, 'SELECT COUNT(*) n FROM users')!.n <= 1 && ENTITIES.every((e) => e.key === 'users' || !get(db, `SELECT 1 FROM ${e.key} LIMIT 1`));
  if (fresh) seedDemo(db);
  else console.log('Demo data not loaded: this database already has records. Set SEED_DEMO=0 to hide this message.');
}
backfillTdsCredits(db);

const app = createApp(db, { dataDir, production });
if (production) {
  const web = resolve('dist/web');
  app.use(express.static(web, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|oauth\/).*/, (_req, res) => res.sendFile(join(web, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: resolve('vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use(errorHandler);

startScheduler(db, { dataDir });
startCloudSync(db);
if (cloudEnabled()) console.log('Saving to Supabase Storage is on.');
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Socialmog HQ running on http://localhost:${port}`));
