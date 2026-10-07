import express from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp, errorHandler, hashPassword } from './app.ts';
import { get, getSetting, insert, openDb } from './db.ts';
import { startScheduler } from './jobs.ts';
import { seedDemo } from './seed.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const production = process.env.NODE_ENV === 'production';
const dataDir = resolve(process.env.DATA_DIR ?? './data');
mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'hq.sqlite'));

if (!get(db, 'SELECT id FROM users LIMIT 1')) {
  const email = process.env.FOUNDER_EMAIL || 'founder@socialmog.in';
  const password = process.env.FOUNDER_PASSWORD || randomBytes(9).toString('base64url');
  insert(db, 'users', { name: process.env.FOUNDER_NAME || 'Founder', email, role: 'founder', status: 'active', password_hash: hashPassword(password) });
  console.log(`\nCreated founder account: ${email}${process.env.FOUNDER_PASSWORD ? '' : `  password: ${password}  (change it in Settings)`}\n`);
}
if (process.env.SEED_DEMO !== '0' && !getSetting(db, 'demo_seeded', false)) seedDemo(db);

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
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Socialmog HQ running on http://localhost:${port}`));
