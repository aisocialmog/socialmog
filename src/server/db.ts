import { DatabaseSync } from 'node:sqlite';
import { ENTITIES, ENTITY, type Entity, type Field } from '../shared/schema.ts';

// Dynamic SQL rows; values are validated at the API boundary.
export type Row = any;
export type Db = DatabaseSync;

function sqlType(field: Field): string {
  switch (field.type) {
    case 'int':
    case 'money':
    case 'percent':
    case 'bool':
      return 'INTEGER';
    case 'ref':
      return `INTEGER REFERENCES ${field.ref}(id)`;
    default:
      return 'TEXT';
  }
}

const COMMON = [
  'created_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'))',
  'updated_at TEXT',
  'archived_at TEXT',
  'created_by INTEGER',
  'is_demo INTEGER NOT NULL DEFAULT 0',
];

/**
 * Creates missing tables and adds missing columns.
 * ponytail: additive-only migrations; renames/type changes need a hand-written step.
 */
export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, user_agent TEXT
    );
  `);
  for (const e of ENTITIES) {
    const cols = ['id INTEGER PRIMARY KEY', ...e.fields.map((fl) => `${fl.key} ${sqlType(fl)}`), ...COMMON];
    db.exec(`CREATE TABLE IF NOT EXISTS ${e.key} (${cols.join(', ')})`);
    const existing = new Set((db.prepare(`PRAGMA table_info(${e.key})`).all() as Row[]).map((r) => r.name));
    for (const fl of e.fields) {
      if (!existing.has(fl.key)) db.exec(`ALTER TABLE ${e.key} ADD COLUMN ${fl.key} ${sqlType(fl)}`);
    }
    for (const c of COMMON) {
      const name = c.split(' ')[0];
      if (!existing.has(name)) db.exec(`ALTER TABLE ${e.key} ADD COLUMN ${c.replace(' NOT NULL', '').replace(/ DEFAULT \(.*\)$/, '')}`);
    }
    for (const fl of e.fields) {
      if (fl.type === 'ref') db.exec(`CREATE INDEX IF NOT EXISTS ix_${e.key}_${fl.key} ON ${e.key}(${fl.key})`);
    }
    for (const s of e.sql ?? []) db.exec(s);
  }
}

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function all<T = Row>(db: Db, sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = Row>(db: Db, sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(db: Db, sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}

let depth = 0;
/** Run fn in a transaction (nested calls use savepoints). */
export function tx<T>(db: Db, fn: () => T): T {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const out = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return out;
  } catch (err) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  }
}

const JSON_TYPES = new Set(['json', 'tags']);

/** Decode JSON/bool columns of a raw row using the entity definition. */
export function decode(entity: Entity | string, row: Row | undefined): Row | undefined {
  if (!row) return row;
  const e = typeof entity === 'string' ? ENTITY[entity] : entity;
  const out: Row = { ...row };
  for (const fl of e.fields) {
    const v = out[fl.key];
    if (JSON_TYPES.has(fl.type) && typeof v === 'string') {
      try {
        out[fl.key] = JSON.parse(v);
      } catch {
        out[fl.key] = null;
      }
    } else if (fl.type === 'bool' && v !== null && v !== undefined) {
      out[fl.key] = !!v;
    }
  }
  return out;
}

/** Encode values for SQLite (JSON -> text, bool -> 0/1). */
export function encode(entity: Entity | string, values: Row): Row {
  const e = typeof entity === 'string' ? ENTITY[entity] : entity;
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    const fl = e.fields.find((x) => x.key === k);
    if (fl && JSON_TYPES.has(fl.type)) out[k] = v === null || v === undefined ? null : JSON.stringify(v);
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else out[k] = v === undefined ? null : v;
  }
  return out;
}

export function insert(db: Db, table: string, values: Row): number {
  const enc = encode(table, values);
  const keys = Object.keys(enc);
  const res = run(db, `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => enc[k]));
  return Number(res.lastInsertRowid);
}

export function update(db: Db, table: string, id: number, values: Row): void {
  const enc = encode(table, values);
  const keys = Object.keys(enc);
  if (!keys.length) return;
  run(db, `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => enc[k]), new Date().toISOString(), id);
}

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const r = get(db, 'SELECT value FROM settings WHERE key = ?', key);
  return r ? (JSON.parse(r.value) as T) : fallback;
}

export function setSetting(db: Db, key: string, value: unknown): void {
  run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function audit(db: Db, userId: number | null, action: string, entity: string, entityId: number | null, before?: unknown, after?: unknown, note?: string): void {
  insert(db, 'audit_log', { user_id: userId, action, entity, entity_id: entityId, before: before ?? null, after: after ?? null, note: note ?? null });
}

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: import('../shared/schema.ts').Role;
  editor_id: number | null;
  influencer_id: number | null;
  brand_id: number | null;
}
