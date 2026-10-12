/**
 * "Download everything": one .tar.gz with the database and every stored file (uploads, photos, report PDFs),
 * laid out like DATA_DIR so a new server can unpack it straight into its data folder.
 * ponytail: hand-written tar (ustar + pax long names) to avoid a dependency; streamed, so large uploads never sit in memory.
 */
import { createReadStream, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { Db } from './db.ts';

const FOLDERS = ['uploads', 'reports'];

function header(name: string, size: number, type = '0'): Buffer {
  const h = Buffer.alloc(512);
  const put = (s: string, at: number, len: number) => h.write(s, at, len, 'utf8');
  const octal = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name.slice(0, 99), 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(Math.floor(Date.now() / 1000), 12), 136, 12);
  put(' '.repeat(8), 148, 8);
  put(type, 156, 1);
  put('ustar\u000000', 257, 8);
  let sum = 0;
  for (const b of h) sum += b;
  put(octal(sum, 7) + ' ', 148, 8);
  return h;
}

const pad = (size: number) => Buffer.alloc((512 - (size % 512)) % 512);

async function write(out: Writable, chunk: Buffer) {
  if (!out.write(chunk)) await once(out, 'drain');
}

/** One file into the tar stream; names that do not fit the 100-byte field get a pax header first. */
async function addFile(out: Writable, name: string, path: string) {
  if (Buffer.byteLength(name) > 99) {
    const body = (n: number) => `${n} path=${name}\n`;
    let len = Buffer.byteLength(body(0));
    while (Buffer.byteLength(body(len)) !== len) len = Buffer.byteLength(body(len));
    const pax = Buffer.from(body(len));
    await write(out, header('pax-header', pax.length, 'x'));
    await write(out, Buffer.concat([pax, pad(pax.length)]));
  }
  const size = statSync(path).size;
  await write(out, header(name, size));
  for await (const chunk of createReadStream(path)) await write(out, chunk as Buffer);
  await write(out, pad(size));
}

function walk(dir: string, rel: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), `${rel}/${e.name}`) : e.isFile() ? [`${rel}/${e.name}`] : [],
  );
}

/** Streams the archive into `res` (gzip). Returns how many stored files went in, besides the database. */
export async function writeArchive(db: Db, dataDir: string, res: Writable): Promise<number> {
  const snap = join(dataDir, `.export-${process.pid}-${Date.now()}.sqlite`);
  const gz = createGzip();
  gz.pipe(res);
  try {
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
    await addFile(gz, 'hq.sqlite', snap);
    const files = FOLDERS.flatMap((f) => walk(join(dataDir, f), f));
    for (const f of files) await addFile(gz, f, join(dataDir, f));
    await write(gz, Buffer.alloc(1024));
    gz.end();
    await once(res, 'finish');
    return files.length;
  } finally {
    rmSync(snap, { force: true });
  }
}
