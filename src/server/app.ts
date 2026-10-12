import express, { type NextFunction, type Request, type Response } from 'express';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isIsoDate } from '../shared/dates.ts';
import { paiseToRupeesString } from '../shared/money.ts';
import { can, ENTITIES, ENTITY, fieldLabel, INTERNAL_ROLES, ROLES, type Cap, type Entity, type Role } from '../shared/schema.ts';
import { writeArchive } from './archive.ts';
import { cloudStatus, mirrorFile, refuseWritesWhenSuperseded } from './cloud.ts';
import { all, audit, decode, get, getSetting, HttpError, insert, run, setSetting, tx, update, type Db, type Row, type User } from './db.ts';
import { afterWrite, beforeWrite, domainRoutes } from './domain.ts';
import { financeRoutes } from './finance-routes.ts';
import { analyticsRoutes } from './analytics.ts';
import { reportRoutes } from './reports.ts';
import { portalRoutes } from './portal.ts';
import { chatgptRoutes } from './chatgpt.ts';
import { retryJob } from './jobs.ts';
import { removeDemo } from './seed.ts';

export interface AppOptions {
  dataDir: string;
  production?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      db: Db;
    }
  }
}

// ---------------------------------------------------------------- passwords & sessions

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(pw, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function checkPasswordStrength(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  return pw;
}

const SESSION_DAYS = 14;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function cookie(req: Request, name: string): string | undefined {
  const m = (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name);
  return m ? decodeURIComponent(m.slice(1).join('=')) : undefined;
}

export function userFromSession(db: Db, token: string | undefined): User | undefined {
  if (!token) return undefined;
  const row = get(
    db,
    `SELECT u.id, u.name, u.email, u.role, u.editor_id, u.influencer_id, u.brand_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active' AND u.archived_at IS NULL`,
    sha(token),
    new Date().toISOString(),
  );
  return row as User | undefined;
}

// ---------------------------------------------------------------- access control

/** Fields never sent to any client. */
const NEVER_SEND = new Set(['password_hash', 'token_enc', 'invite_token_hash', 'failed_logins', 'locked_until', 'prefs']);

export function requireCap(req: Request, cap: Cap): User {
  const u = req.user;
  if (!u) throw new HttpError(401, 'Please sign in');
  if (!can(u.role, cap)) throw new HttpError(403, 'You do not have access to this');
  return u;
}

/** Row-level scope for reading an entity, or null when the role has no access at all. */
export function scopeFor(user: User, entity: Entity): { where: string; params: any[] } | null {
  if (!INTERNAL_ROLES.includes(user.role) || !can(user.role, entity.read)) return null;
  if (user.role === 'editor') {
    switch (entity.key) {
      case 'content_tasks':
        return { where: 'x.editor_id = ?', params: [user.editor_id ?? -1] };
      case 'tasks':
        return { where: 'x.owner_id = ?', params: [user.id] };
      case 'editors':
        return { where: 'x.id = ?', params: [user.editor_id ?? -1] };
      case 'users':
        return { where: '1=1', params: [] };
      default:
        return null;
    }
  }
  // Invoices, receipts and documents attached to financial records are finance-only.
  if (entity.key === 'documents' && !can(user.role, 'campaign_finance')) {
    return { where: "x.kind NOT IN ('invoice','receipt') AND COALESCE(x.entity_type,'') NOT IN ('transactions','accounts','invoices','obligations')", params: [] };
  }
  return { where: '1=1', params: [] };
}

export function serialize(entity: Entity, row: Row, user: User): Row {
  const out: Row = decode(entity, row)!;
  for (const f of entity.fields) {
    if (NEVER_SEND.has(f.key) || (f.sensitive && !can(user.role, f.sensitive))) delete out[f.key];
  }
  for (const k of Object.keys(out)) if (NEVER_SEND.has(k)) delete out[k];
  return out;
}

/** Adds `<ref>_label` display names for reference fields. */
export function attachLabels(db: Db, entity: Entity, rows: Row[]): Row[] {
  for (const f of entity.fields) {
    if (f.type !== 'ref' || !f.ref) continue;
    const target = ENTITY[f.ref];
    const titleField = target.fields.find((x) => x.key === target.title);
    if (!titleField || titleField.type === 'ref') continue;
    const ids = [...new Set(rows.map((r) => r[f.key]).filter((v) => Number.isInteger(v)))];
    if (!ids.length) continue;
    const labels = new Map(all(db, `SELECT id, ${target.title} AS label FROM ${target.key} WHERE id IN (${ids.join(',')})`).map((r) => [r.id, r.label]));
    for (const r of rows) if (r[f.key] != null) r[`${f.key}_label`] = labels.get(r[f.key]) ?? `#${r[f.key]}`;
  }
  return rows;
}

// ---------------------------------------------------------------- validation from schema

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function clean(db: Db, entity: Entity, input: Row, user: User, mode: 'create' | 'update'): Row {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Invalid request body');
  const out: Row = {};
  const errors: Record<string, string> = {};
  for (const f of entity.fields) {
    if (f.readonly || NEVER_SEND.has(f.key)) continue;
    if (f.sensitive && !can(user.role, f.sensitive)) continue;
    const present = Object.prototype.hasOwnProperty.call(input, f.key);
    let v = input[f.key];
    if (!present) {
      if (mode === 'create' && f.default !== undefined) out[f.key] = f.default;
      else if (mode === 'create' && f.required) errors[f.key] = `${fieldLabel(f)} is required`;
      continue;
    }
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    if (v === null) {
      if (f.required) errors[f.key] = `${fieldLabel(f)} is required`;
      else out[f.key] = null;
      continue;
    }
    const bad = (msg: string) => (errors[f.key] = `${fieldLabel(f)} ${msg}`);
    switch (f.type) {
      case 'text':
      case 'longtext':
        if (typeof v !== 'string') bad('must be text');
        else if (v.length > (f.type === 'text' ? 500 : 100_000)) bad('is too long');
        else out[f.key] = v;
        break;
      case 'email':
        if (typeof v !== 'string' || !EMAIL.test(v)) bad('must be a valid email address');
        else out[f.key] = v.toLowerCase();
        break;
      case 'url':
        if (typeof v !== 'string' || !/^https?:\/\/\S+$/i.test(v)) bad('must start with http:// or https://');
        else out[f.key] = v;
        break;
      case 'int':
      case 'money':
      case 'percent': {
        const n = typeof v === 'string' ? Number(v) : v;
        if (!Number.isSafeInteger(n)) bad(f.type === 'money' ? 'must be a valid amount' : 'must be a whole number');
        else if (f.type === 'money' && n < 0) bad('cannot be negative');
        else out[f.key] = n;
        break;
      }
      case 'date':
        if (!isIsoDate(v)) bad('must be a valid date');
        else out[f.key] = v;
        break;
      case 'datetime':
        if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) bad('must be a valid date and time');
        else out[f.key] = new Date(v).toISOString();
        break;
      case 'bool':
        out[f.key] = v === true || v === 1 || v === 'true';
        break;
      case 'enum':
        if (!f.options!.includes(v)) bad(`must be one of: ${f.options!.join(', ')}`);
        else out[f.key] = v;
        break;
      case 'ref': {
        const n = Number(v);
        if (!Number.isSafeInteger(n) || !get(db, `SELECT id FROM ${f.ref} WHERE id = ?`, n)) bad('refers to a record that does not exist');
        else out[f.key] = n;
        break;
      }
      case 'tags':
        if (!Array.isArray(v) || v.some((t) => typeof t !== 'string')) bad('must be a list of text');
        else out[f.key] = [...new Set(v.map((t: string) => t.trim()).filter(Boolean))];
        break;
      case 'json':
        if (typeof v !== 'object') bad('must be structured data');
        else if (JSON.stringify(v).length > 200_000) bad('is too large');
        else out[f.key] = v;
        break;
    }
  }
  if (Object.keys(errors).length) throw new HttpError(400, Object.values(errors)[0], { fields: errors });
  return out;
}

// ---------------------------------------------------------------- CSV

export function toCsv(rows: Row[], columns: { key: string; label: string; type?: string }[]): string {
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    // Neutralise spreadsheet formulas in text (not in numbers like -1675.50).
    if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmt = (v: unknown, type?: string) => {
    if (v === null || v === undefined) return '';
    if (type === 'money' && typeof v === 'number') return paiseToRupeesString(v);
    if (type === 'percent' && typeof v === 'number') return (v / 100).toFixed(2);
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? Object.values(x).filter((y) => y !== null && y !== '').join(' ') : x)).join('; ');
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(fmt(r[c.key], c.type))).join(','))].join('\r\n');
}

export function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send(`﻿${csv}`);
}

// ---------------------------------------------------------------- notifications

export function notify(db: Db, userIds: number[], n: { kind: string; title: string; body?: string; link?: string; dedupe?: string }) {
  for (const uid of new Set(userIds)) {
    run(
      db,
      `INSERT OR IGNORE INTO notifications (user_id, kind, title, body, link, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)`,
      uid, n.kind, n.title, n.body ?? null, n.link ?? null, n.dedupe ?? null,
    );
  }
}

export function founders(db: Db): number[] {
  return all(db, `SELECT id FROM users WHERE role = 'founder' AND status = 'active'`).map((r) => r.id);
}

// ---------------------------------------------------------------- app

export function createApp(db: Db, opts: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', refuseWritesWhenSuperseded);
  app.use((req, res, next) => {
    req.db = db;
    req.user = userFromSession(db, cookie(req, 'hq'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // PDF previews are framed by the app itself
    next();
  });
  // CSRF: state-changing API calls must carry a custom header, which cross-site forms cannot set.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-hq'] !== '1') return next(new HttpError(403, 'Missing request header'));
    next();
  });

  // ---- auth
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    const u = get(db, `SELECT * FROM users WHERE lower(email) = lower(?) AND archived_at IS NULL`, String(email ?? ''));
    const now = new Date();
    if (u?.locked_until && u.locked_until > now.toISOString()) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    if (!u || u.status !== 'active' || !verifyPassword(String(password ?? ''), u.password_hash)) {
      if (u) {
        // A lock that has run out starts the count again, so one more slip does not lock the account straight back.
        const fails = (u.locked_until ? 0 : u.failed_logins ?? 0) + 1;
        run(db, 'UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', fails, fails >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : null, u.id);
      }
      throw new HttpError(401, 'Email or password is incorrect');
    }
    const token = randomBytes(32).toString('base64url');
    run(db, 'INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)', sha(token), u.id, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(), req.ip ?? null, String(req.headers['user-agent'] ?? '').slice(0, 200));
    run(db, 'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', now.toISOString(), u.id);
    audit(db, u.id, 'login', 'users', u.id);
    res.setHeader('Set-Cookie', `hq=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${opts.production && process.env.COOKIE_SECURE !== '0' ? '; Secure' : ''}`);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = cookie(req, 'hq');
    if (token) run(db, 'DELETE FROM sessions WHERE id = ?', sha(token));
    res.setHeader('Set-Cookie', 'hq=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    const prefs = get(db, 'SELECT prefs FROM users WHERE id = ?', req.user.id)?.prefs;
    res.json({
      user: req.user,
      prefs: prefs ? JSON.parse(prefs) : {},
      timezone: getSetting(db, 'timezone', 'Asia/Kolkata'),
      demo: getSetting(db, 'demo_loaded', false),
    });
  });

  app.put('/api/auth/prefs', (req, res) => {
    const u = requireUser(req);
    const body = JSON.stringify(req.body ?? {});
    if (body.length > 100_000) throw new HttpError(400, 'Preferences too large');
    run(db, 'UPDATE users SET prefs = ? WHERE id = ?', body, u.id);
    res.json({ ok: true });
  });

  app.post('/api/auth/password', (req, res) => {
    const u = requireUser(req);
    const row = get(db, 'SELECT password_hash FROM users WHERE id = ?', u.id)!;
    if (!verifyPassword(String(req.body?.current ?? ''), row.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(checkPasswordStrength(req.body?.next)), u.id);
    run(db, 'DELETE FROM sessions WHERE user_id = ? AND id <> ?', u.id, sha(cookie(req, 'hq') ?? ''));
    audit(db, u.id, 'password_change', 'users', u.id);
    res.json({ ok: true });
  });

  // ---- users (admin)
  app.post('/api/users', (req, res) => {
    const admin = requireCap(req, 'admin');
    const values = clean(db, ENTITY.users, req.body, admin, 'create');
    if (get(db, 'SELECT id FROM users WHERE lower(email) = lower(?)', values.email)) throw new HttpError(400, 'A user with this email already exists');
    if (values.role === 'brand' && !values.brand_id) throw new HttpError(400, 'Brand users must be linked to a brand');
    if (values.role === 'creator' && !values.influencer_id) throw new HttpError(400, 'Creator users must be linked to an influencer');
    if (values.role === 'editor' && !values.editor_id) throw new HttpError(400, 'Editor users must be linked to an editor profile');
    const id = insert(db, 'users', { ...values, password_hash: hashPassword(checkPasswordStrength(req.body?.password)), created_by: admin.id });
    audit(db, admin.id, 'create', 'users', id, null, { ...values });
    res.json({ id });
  });

  app.post('/api/users/:id/password', (req, res) => {
    const admin = requireCap(req, 'admin');
    const id = Number(req.params.id);
    run(db, 'UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', hashPassword(checkPasswordStrength(req.body?.password)), id);
    run(db, 'DELETE FROM sessions WHERE user_id = ?', id);
    audit(db, admin.id, 'password_reset', 'users', id);
    res.json({ ok: true });
  });

  // ---- generic entity CRUD
  const entityFor = (req: Request): Entity => {
    const e = ENTITY[String(req.params.entity)];
    if (!e || e.internal) throw new HttpError(404, 'Unknown record type');
    return e;
  };
  const scoped = (req: Request, e: Entity) => {
    const u = requireUser(req);
    const s = scopeFor(u, e);
    if (!s) throw new HttpError(403, 'You do not have access to this');
    return { u, s };
  };
  const loadOne = (req: Request, e: Entity, id: number): Row => {
    const { s } = scoped(req, e);
    const row = get(db, `SELECT * FROM ${e.key} x WHERE x.id = ? AND (${s.where})`, id, ...s.params);
    if (!row) throw new HttpError(404, `${e.label} not found`);
    return row;
  };

  app.get('/api/e/:entity', (req, res) => {
    const e = entityFor(req);
    const { u, s } = scoped(req, e);
    const archived = req.query.archived === '1' ? 'x.archived_at IS NOT NULL' : 'x.archived_at IS NULL';
    // ponytail: whole table to the client, filtered/sorted/paginated in the browser; add SQL paging past ~10k rows per table.
    const rows = all(db, `SELECT x.* FROM ${e.key} x WHERE ${archived} AND (${s.where}) ORDER BY x.id DESC LIMIT 10000`, ...s.params);
    res.json({ rows: attachLabels(db, e, rows.map((r) => serialize(e, r, u))) });
  });

  app.get('/api/e/:entity/export.csv', (req, res) => {
    const e = entityFor(req);
    const { u, s } = scoped(req, e);
    const visible = e.fields.filter((f) => !NEVER_SEND.has(f.key) && (!f.sensitive || can(u.role, f.sensitive)));
    const requested = String(req.query.fields ?? '').split(',').filter(Boolean);
    // Default export leaves out sensitive (commission, identity, financial) and internal-note fields.
    const fields = requested.length ? visible.filter((f) => requested.includes(f.key)) : visible.filter((f) => !f.sensitive && !/notes/.test(f.key));
    const ids = String(req.query.ids ?? '').split(',').map(Number).filter(Number.isSafeInteger);
    const rows = all(db, `SELECT x.* FROM ${e.key} x WHERE x.archived_at IS NULL AND (${s.where}) ${ids.length ? `AND x.id IN (${ids.join(',')})` : ''} ORDER BY x.id`, ...s.params);
    const data = attachLabels(db, e, rows.map((r) => serialize(e, r, u)));
    const cols = fields.map((f) => (f.type === 'ref' ? { key: `${f.key}_label`, label: fieldLabel(f) } : { key: f.key, label: fieldLabel(f), type: f.type }));
    audit(db, u.id, 'export', e.key, null, null, { fields: fields.map((f) => f.key), count: data.length });
    sendCsv(res, `${e.key}.csv`, toCsv(data, cols));
  });

  app.get('/api/e/:entity/:id', (req, res) => {
    const e = entityFor(req);
    const row = loadOne(req, e, Number(req.params.id));
    res.json({ row: attachLabels(db, e, [serialize(e, row, req.user!)])[0] });
  });

  const writeOne = (req: Request, e: Entity, id: number | null, input: Row): Row => {
    const u = requireUser(req);
    if (!can(u.role, e.write)) throw new HttpError(403, `You cannot edit ${e.plural.toLowerCase()}`);
    return tx(db, () => {
      const existing = id === null ? null : loadOne(req, e, id);
      if (existing?.archived_at) throw new HttpError(400, 'Restore this record before editing it');
      const values = clean(db, e, input, u, id === null ? 'create' : 'update');
      beforeWrite(db, u, e.key, values, existing ? decode(e, existing)! : null);
      let rowId = id;
      if (id === null) rowId = insert(db, e.key, { ...values, created_by: u.id });
      else update(db, e.key, id, values);
      const after = decode(e, get(db, `SELECT * FROM ${e.key} WHERE id = ?`, rowId))!;
      afterWrite(db, u, e.key, after, existing ? decode(e, existing)! : null);
      audit(db, u.id, id === null ? 'create' : 'update', e.key, rowId, existing ? diffBefore(existing, values) : null, values);
      return after;
    });
  };

  app.post('/api/e/:entity', (req, res) => {
    const e = entityFor(req);
    const row = writeOne(req, e, null, req.body);
    res.status(201).json({ row: serialize(e, row, req.user!) });
  });

  app.patch('/api/e/:entity/:id', (req, res) => {
    const e = entityFor(req);
    const row = writeOne(req, e, Number(req.params.id), req.body);
    res.json({ row: serialize(e, row, req.user!) });
  });

  const archive = (req: Request, e: Entity, id: number, restore: boolean) => {
    const u = requireUser(req);
    if (!can(u.role, e.write)) throw new HttpError(403, `You cannot edit ${e.plural.toLowerCase()}`);
    const row = loadOne(req, e, id);
    if (!restore) {
      if (['invoices', 'obligations'].includes(e.key) && get(db, `SELECT id FROM settlements WHERE ${e.key === 'invoices' ? 'invoice_id' : 'obligation_id'} = ? AND reversed_at IS NULL`, id)) {
        throw new HttpError(400, 'This record has payments against it. Cancel it with a reason instead, after reversing the payments.');
      }
      if (e.key === 'accounts' && get(db, 'SELECT id FROM transactions WHERE account_id = ?', id)) throw new HttpError(400, 'Accounts with transactions cannot be archived. Mark the account inactive instead.');
      if (e.key === 'users' && id === u.id) throw new HttpError(400, 'You cannot archive yourself');
    }
    run(db, `UPDATE ${e.key} SET archived_at = ?, updated_at = ? WHERE id = ?`, restore ? null : new Date().toISOString(), new Date().toISOString(), id);
    audit(db, u.id, restore ? 'restore' : 'archive', e.key, id, row, null, req.body?.reason);
  };

  app.post('/api/e/:entity/:id/archive', (req, res) => {
    archive(req, entityFor(req), Number(req.params.id), false);
    res.json({ ok: true });
  });

  app.post('/api/e/:entity/:id/restore', (req, res) => {
    archive(req, entityFor(req), Number(req.params.id), true);
    res.json({ ok: true });
  });

  app.post('/api/e/:entity/bulk', (req, res) => {
    const e = entityFor(req);
    const { ids, action, values } = req.body ?? {};
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Select at least one record');
    const results = { ok: 0, failed: [] as { id: number; error: string }[] };
    for (const id of ids.map(Number)) {
      try {
        if (action === 'archive' || action === 'restore') archive(req, e, id, action === 'restore');
        else if (action === 'update') writeOne(req, e, id, values ?? {});
        else throw new HttpError(400, 'Unknown bulk action');
        results.ok++;
      } catch (err) {
        results.failed.push({ id, error: (err as Error).message });
      }
    }
    res.json(results);
  });

  // ---- comments, notes, communication timeline, approvals
  const canSee = (req: Request, entityKey: string, id: number) => {
    const e = ENTITY[entityKey];
    if (!e) throw new HttpError(404, 'Unknown record type');
    loadOne(req, e, id);
  };

  app.get('/api/comments', (req, res) => {
    const entity = String(req.query.entity);
    const id = Number(req.query.id);
    canSee(req, entity, id);
    const rows = all(db, `SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.entity_type = ? AND c.entity_id = ? AND c.archived_at IS NULL ORDER BY c.created_at DESC`, entity, id);
    res.json({ rows: rows.map((r) => decode('comments', r)) });
  });

  app.post('/api/comments', (req, res) => {
    const u = requireUser(req);
    const { entity_type, entity_id, kind = 'comment', body, follow_up_date, meta } = req.body ?? {};
    canSee(req, entity_type, Number(entity_id));
    if (!body?.trim()) throw new HttpError(400, 'Write something first');
    if (!['comment', 'note', 'call', 'email', 'meeting', 'whatsapp', 'feedback'].includes(kind)) throw new HttpError(400, 'Invalid entry type');
    if (follow_up_date && !isIsoDate(follow_up_date)) throw new HttpError(400, 'Invalid follow-up date');
    const id = insert(db, 'comments', { entity_type, entity_id: Number(entity_id), kind, body: String(body).slice(0, 20_000), follow_up_date: follow_up_date || null, meta: meta ?? null, user_id: u.id, created_by: u.id });
    // @mentions notify by first name or full name.
    const users = all(db, `SELECT id, name FROM users WHERE status = 'active' AND role IN (${INTERNAL_ROLES.map((r) => `'${r}'`).join(',')})`);
    const mentioned = users.filter((x) => x.id !== u.id && new RegExp(`@${x.name.split(' ')[0]}\\b`, 'i').test(body)).map((x) => x.id);
    if (mentioned.length) notify(db, mentioned, { kind: 'mention', title: `${u.name} mentioned you`, body: String(body).slice(0, 200), link: `/${linkFor(entity_type, Number(entity_id))}` });
    if (follow_up_date && entity_type === 'brands') run(db, 'UPDATE brands SET follow_up_date = ? WHERE id = ?', follow_up_date, Number(entity_id));
    res.status(201).json({ id });
  });

  // ---- activity log for a record (anyone who can read it), full log for admins
  app.get('/api/activity', (req, res) => {
    const entity = String(req.query.entity ?? '');
    const id = Number(req.query.id);
    if (entity) canSee(req, entity, id);
    else requireCap(req, 'admin');
    const rows = all(
      db,
      `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.note, a.after, a.before, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ${entity ? 'WHERE a.entity = ? AND a.entity_id = ?' : ''} ORDER BY a.id DESC LIMIT 500`,
      ...(entity ? [entity, id] : []),
    );
    const showValues = can(req.user!.role, 'admin');
    res.json({ rows: rows.map((r) => (showValues ? decode('audit_log', r) : { ...r, before: undefined, after: undefined })) });
  });

  // ---- notifications
  app.get('/api/notifications', (req, res) => {
    const u = requireUser(req);
    res.json({ rows: all(db, 'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100', u.id) });
  });

  app.post('/api/notifications/read', (req, res) => {
    const u = requireUser(req);
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    run(db, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL ${ids.length ? `AND id IN (${ids.join(',')})` : ''}`, new Date().toISOString(), u.id);
    res.json({ ok: true });
  });

  // ---- global search
  app.get('/api/search', (req, res) => {
    const u = requireUser(req);
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const results: Row[] = [];
    for (const e of ENTITIES.filter((x) => !x.internal && x.search)) {
      const s = scopeFor(u, e);
      if (!s) continue;
      const cols = e.search!.filter((c) => e.fields.some((f) => f.key === c && (!f.sensitive || can(u.role, f.sensitive))));
      const rows = all(db, `SELECT x.id, x.${e.title} AS title FROM ${e.key} x WHERE x.archived_at IS NULL AND (${s.where}) AND (${cols.map((c) => `x.${c} LIKE ?`).join(' OR ')}) LIMIT 6`, ...s.params, ...cols.map(() => `%${q}%`));
      for (const r of rows) results.push({ entity: e.key, label: e.label, id: r.id, title: r.title, link: `/${linkFor(e.key, r.id)}` });
    }
    res.json({ results });
  });

  // ---- documents: raw-body upload (no multipart parser needed) and permission-checked download
  const uploadsDir = join(opts.dataDir, 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  const ALLOWED = /^(application\/pdf|image\/(png|jpeg|webp|gif)|text\/(plain|csv)|application\/(vnd\.openxmlformats-officedocument\.[\w.]+|msword|vnd\.ms-excel|zip)|video\/(mp4|quicktime))$/;
  app.post('/api/documents/:id/file', express.raw({ type: () => true, limit: '50mb' }), (req, res) => {
    const u = requireUser(req);
    if (!can(u.role, 'staff')) throw new HttpError(403, 'Not allowed');
    const doc = loadOne(req, ENTITY.documents, Number(req.params.id));
    const mime = String(req.headers['content-type'] ?? '').split(';')[0];
    if (!ALLOWED.test(mime)) throw new HttpError(400, `File type ${mime || 'unknown'} is not allowed`);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Empty file');
    const name = String(req.headers['x-filename'] ?? 'file').replace(/[^\w.\- ]/g, '_').slice(0, 120);
    const stored = `${doc.id}-${Date.now()}-${name}`;
    writeFileSync(join(uploadsDir, stored), body);
    mirrorFile(`uploads/${stored}`);
    update(db, 'documents', doc.id, { file: stored, mime, size: body.length });
    audit(db, u.id, 'upload', 'documents', doc.id, null, { file: stored, size: body.length, sha256: createHash('sha256').update(body).digest('hex') });
    res.json({ ok: true });
  });

  app.get('/api/documents/:id/file', (req, res) => {
    const doc = loadOne(req, ENTITY.documents, Number(req.params.id));
    if (!doc.file) throw new HttpError(404, 'No file uploaded');
    const path = join(uploadsDir, doc.file);
    if (!existsSync(path)) throw new HttpError(404, 'File missing from storage');
    res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${doc.file.replace(/^\d+-\d+-/, '')}"`);
    res.send(readFileSync(path));
  });

  // ---- settings
  app.get('/api/settings', (req, res) => {
    requireCap(req, 'staff');
    const rows = all(db, 'SELECT key, value FROM settings');
    res.json(Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])));
  });

  const SETTING_KEYS = ['timezone', 'recognition', 'analysis_schedule', 'agency', 'forecast_defaults', 'chatgpt_prep'];
  app.put('/api/settings/:key', (req, res) => {
    const u = requireCap(req, 'admin');
    const key = String(req.params.key);
    if (!SETTING_KEYS.includes(key)) throw new HttpError(400, 'Unknown setting');
    const value = req.body?.value;
    if (key === 'recognition') {
      if (!['invoice', 'cash', 'completion'].includes(value?.basis) || !['capitalise', 'expense'].includes(value?.assets) || typeof value?.creatorPassThrough !== 'boolean') throw new HttpError(400, 'Invalid recognition rules');
    }
    if (key === 'agency') {
      const ok = value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([k, x]) => ['name', 'email', 'phone', 'website', 'kit_note'].includes(k) && (x === null || (typeof x === 'string' && x.length <= (k === 'kit_note' ? 1000 : 200))));
      if (!ok) throw new HttpError(400, 'Invalid agency details');
      if (value.website && !/^https?:\/\//.test(value.website)) throw new HttpError(400, 'Website must start with https://');
    }
    if (key === 'timezone') {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
      } catch {
        throw new HttpError(400, 'Unknown timezone');
      }
    }
    if (key === 'analysis_schedule' && (!(value?.weekday >= 0 && value?.weekday <= 6) || !/^\d{2}:\d{2}$/.test(value?.time ?? ''))) throw new HttpError(400, 'Invalid schedule');
    const before = getSetting(db, key, null);
    setSetting(db, key, value);
    audit(db, u.id, 'update', 'settings', null, { [key]: before }, { [key]: value });
    res.json({ ok: true });
  });

  // ---- backups & full export (admin)
  app.get('/api/admin/backup', (req, res) => {
    const u = requireCap(req, 'admin');
    const dir = join(opts.dataDir, 'backups');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `manual-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    audit(db, u.id, 'backup', 'system', null, null, { file });
    res.setHeader('Content-Disposition', `attachment; filename="socialmog-hq-backup.sqlite"`);
    res.send(readFileSync(file));
  });

  // Database + every stored file in one .tar.gz, for moving to another server (unpack into its data folder).
  app.get('/api/admin/everything.tar.gz', async (req, res) => {
    const u = requireCap(req, 'admin');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="socialmog-hq-everything-${new Date().toISOString().slice(0, 10)}.tar.gz"`);
    try {
      const files = await writeArchive(db, opts.dataDir, res);
      audit(db, u.id, 'export', 'system', null, null, { everything: true, files });
    } catch (err) {
      // Headers are already sent: cut the download so the browser reports it as failed rather than complete.
      console.error('Download everything', err);
      res.destroy(err as Error);
    }
  });

  app.get('/api/admin/cloud', (req, res) => {
    requireCap(req, 'admin');
    res.json(cloudStatus());
  });

  app.get('/api/admin/export.json', (req, res) => {
    const u = requireCap(req, 'admin');
    const out: Row = { exported_at: new Date().toISOString() };
    for (const e of ENTITIES) out[e.key] = all(db, `SELECT * FROM ${e.key}`).map((r) => serialize(e, r, u));
    out.settings = all(db, 'SELECT * FROM settings');
    audit(db, u.id, 'export', 'system', null);
    res.setHeader('Content-Disposition', 'attachment; filename="socialmog-hq-export.json"');
    res.json(out);
  });

  app.get('/api/admin/jobs', (req, res) => {
    requireCap(req, 'admin');
    res.json({ rows: all(db, 'SELECT id, kind, unique_key, status, attempts, run_at, last_error, finished_at, created_at FROM jobs ORDER BY id DESC LIMIT 200') });
  });

  app.post('/api/admin/jobs/:id/retry', (req, res) => {
    const u = requireCap(req, 'admin');
    retryJob(db, Number(req.params.id));
    audit(db, u.id, 'retry', 'jobs', Number(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/admin/demo/remove', (req, res) => {
    const u = requireCap(req, 'admin');
    if (req.body?.confirm !== 'REMOVE DEMO DATA') throw new HttpError(400, 'Type REMOVE DEMO DATA to confirm');
    const counts = removeDemo(db);
    audit(db, u.id, 'remove_demo', 'system', null, null, counts);
    res.json({ ok: true, counts });
  });

  app.get('/api/meta/roles', (_req, res) => res.json({ roles: ROLES }));

  financeRoutes(app);
  domainRoutes(app, opts);
  analyticsRoutes(app);
  reportRoutes(app, opts.dataDir);
  portalRoutes(app, opts.dataDir);
  chatgptRoutes(app);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
  return app;
}

/** "UNIQUE constraint failed: campaign_creators.campaign_id, campaign_creators.influencer_id" → a plain duplicate message. */
function duplicateMessage(err: any): string | null {
  const m = /UNIQUE constraint failed: (\w+)\.(.+)$/.exec(String(err?.message ?? ''));
  const e = m && ENTITY[m[1]];
  if (!e) return null;
  const cols = m[2].split(', ').map((c) => c.split('.').at(-1)!).filter((c) => c !== 'archived_at');
  return `That already exists: another ${e.label.toLowerCase()} has the same ${cols.map((c) => (e.fields.find((f) => f.key === c)?.label ?? c.replace(/_id$/, '').replace(/_/g, ' ')).toLowerCase()).join(' and ')} (archived records count too). Nothing was saved.`;
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const dup = err instanceof HttpError ? null : duplicateMessage(err);
  if (dup) err = new HttpError(409, dup);
  const status = err instanceof HttpError ? err.status : err?.type === 'entity.too.large' ? 413 : err?.type === 'entity.parse.failed' ? 400 : 500;
  if (status === 500) console.error(`[${req.method} ${req.path}]`, err);
  const message = status === 500 ? 'Something went wrong on the server. Nothing was saved.' : err.message;
  if (req.path.startsWith('/api') || req.path.startsWith('/oauth') || status !== 500) {
    res.status(status).json({ error: message, details: err instanceof HttpError ? err.details : undefined });
  } else res.status(status).send(message);
}

export function requireUser(req: Request): User {
  if (!req.user) throw new HttpError(401, 'Please sign in');
  return req.user;
}

export function requireInternal(req: Request): User {
  const u = requireUser(req);
  if (!INTERNAL_ROLES.includes(u.role)) throw new HttpError(403, 'Not available in the portal');
  return u;
}

function diffBefore(existing: Row, values: Row): Row {
  return Object.fromEntries(Object.keys(values).map((k) => [k, existing[k]]));
}

const LINKS: Record<string, string> = {
  influencers: 'influencers', brands: 'brands', deals: 'deals', campaigns: 'campaigns', content_tasks: 'content',
  editors: 'editors', tasks: 'tasks', documents: 'documents', assets: 'assets', invoices: 'finance/receivables',
  obligations: 'finance/payables', accounts: 'finance/accounts', transactions: 'finance/transactions',
};

export function linkFor(entity: string, id: number): string {
  return LINKS[entity] ? `${LINKS[entity]}/${id}` : `r/${entity}/${id}`;
}

export type { Role };
