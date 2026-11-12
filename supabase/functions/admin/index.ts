// POST /functions/v1/admin  { action, ... }
//   From the app (a signed-in person):
//     ai_status                    founders & managers — which AI provider keys are set (never the key)
//     backup_now                   founders — back up everything now
//     backup_link { id }           founders — a 1-hour download link for a stored backup
//     export                       founders, right after re-entering the password — ZIP of every table
//   From the database scheduler (x-cron-secret):
//     nightly                      back up everything, keep 30 days
//     weekly_email                 email both founders a link to the latest backup
// The service-role key and the AI keys exist only here, on the server.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1'
import { corsHeaders, json } from '../_shared/cors.ts'
import { emailFrame, esc, isCron, sendEmail, service } from '../_shared/server.ts'
import { makeZip, toBackupCsv, type ZipFile } from '../_shared/zip.ts'

type Admin = ReturnType<typeof service>
const BUCKET = 'backups', KEEP_DAYS = 30, PAGE = 1000

/** Every table as CSV and JSON, a list of uploaded files, and a note — in one ZIP. */
async function buildBackup(admin: Admin) {
  const { data: tables, error } = await admin.rpc('backup_tables')
  if (error) throw new Error(error.message)
  const now = new Date(), files: ZipFile[] = []
  let total = 0
  for (const t of tables as string[]) {
    const rows: Record<string, unknown>[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error: e } = await admin.from(t).select('*').order('id', { ascending: true }).range(from, from + PAGE - 1)
      if (e) throw new Error(`${t}: ${e.message}`)
      rows.push(...(data ?? [])); if ((data ?? []).length < PAGE) break
    }
    total += rows.length
    files.push({ name: `tables/${t}.csv`, data: toBackupCsv(rows), date: now }, { name: `tables/${t}.json`, data: JSON.stringify(rows), date: now })
    if (t === 'files') {
      files.push({ name: 'uploaded-files.csv', date: now, data: toBackupCsv(rows.filter(r => !r.is_archived).map(r => ({ bucket: r.bucket, storage_path: r.storage_path, file_name: r.file_name, size_bytes: r.size_bytes, kind: r.kind, uploaded_at: r.created_at })),
        ['bucket', 'storage_path', 'file_name', 'size_bytes', 'kind', 'uploaded_at']) })
    }
  }
  files.unshift({ name: 'README.txt', date: now, data: `Social Mog OS backup\nMade: ${now.toISOString()}\nTables: ${(tables as string[]).length}  Rows: ${total}\n\ntables/<name>.csv and .json hold every record, archived ones included.\nuploaded-files.csv lists the files in storage; the files themselves are not inside this ZIP.\nThis archive contains bank details, payouts and capital. Keep it private.\n` })
  return { zip: makeZip(files), tables: (tables as string[]).length, rows: total, at: now }
}

async function backupAndStore(admin: Admin, trigger: 'manual' | 'scheduled', by: string | null) {
  const { data: rec, error } = await admin.from('backups').insert({ kind: 'full', trigger, status: 'running', created_by: by }).select('id').single()
  if (error) throw new Error(error.message)
  try {
    const b = await buildBackup(admin)
    const path = `${b.at.toISOString().slice(0, 10)}/social-mog-backup-${b.at.toISOString().replace(/[:.]/g, '-')}.zip`
    const up = await admin.storage.from(BUCKET).upload(path, b.zip, { contentType: 'application/zip', upsert: false })
    if (up.error) throw new Error(up.error.message)
    await admin.from('backups').update({ status: 'succeeded', storage_path: path, size_bytes: b.zip.length, finished_at: new Date().toISOString() }).eq('id', rec.id)
    return { id: rec.id as string, path, size_bytes: b.zip.length, tables: b.tables, rows: b.rows }
  } catch (e) {
    await admin.from('backups').update({ status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 400), finished_at: new Date().toISOString() }).eq('id', rec.id)
    throw e
  }
}

/** Keep the last 30 days; older files are removed from storage and their rows archived (never deleted). */
async function prune(admin: Admin) {
  const { data } = await admin.from('backups').select('id, storage_path').eq('is_archived', false).not('storage_path', 'is', null)
    .lt('created_at', new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString())
  const old = (data ?? []) as { id: string; storage_path: string }[]
  if (old.length) { await admin.storage.from(BUCKET).remove(old.map(o => o.storage_path)); await admin.from('backups').update({ is_archived: true }).in('id', old.map(o => o.id)) }
  return old.length
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const action = String(body.action ?? ''), admin = service()

  try {
    if (isCron(req)) {
      if (action === 'nightly') { const r = await backupAndStore(admin, 'scheduled', null); return json({ ...r, pruned: await prune(admin) }) }
      if (action === 'weekly_email') {
        let { data: last } = await admin.from('backups').select('id, storage_path, created_at, size_bytes').eq('status', 'succeeded').eq('is_archived', false).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (!last) { await backupAndStore(admin, 'scheduled', null); ({ data: last } = await admin.from('backups').select('id, storage_path, created_at, size_bytes').eq('status', 'succeeded').order('created_at', { ascending: false }).limit(1).maybeSingle()) }
        const { data: link } = await admin.storage.from(BUCKET).createSignedUrl(last!.storage_path, 7 * 86400)
        const { data: founders } = await admin.from('team_members').select('email').eq('role', 'founder').eq('status', 'active').eq('is_archived', false)
        const to = (founders ?? []).map(f => f.email as string)
        const html = emailFrame('Your weekly backup', `<p style="font-size:15px;line-height:1.6">Everything in Social Mog OS as of ${esc(new Date(last!.created_at).toDateString())}: every table as CSV and JSON.</p>
          <p><a href="${esc(link?.signedUrl)}" style="background:#B7282E;color:#F2E8D5;padding:10px 18px;border-radius:4px;text-decoration:none">Download the backup</a></p>
          <p style="font-size:13px;color:#5c5752">The link works for 7 days. The file holds bank details and capital — keep it private and delete it when you’re done.</p>`)
        const err = await sendEmail(to, 'Social Mog — weekly backup', html)
        return json(err ? { error: err } : { sent: to.length }, err ? 502 : 200)
      }
      return json({ error: 'Unknown scheduler action' }, 400)
    }

    // a person: who are they, with their own token (a founder who hasn't passed 2FA reads as a team member)
    const me = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const [{ data: role }, { data: memberId }] = await Promise.all([me.rpc('current_app_role'), me.rpc('current_member_id')])

    if (action === 'ai_status') {
      if (role !== 'founder' && role !== 'manager') return json({ error: 'Not allowed' }, 403)
      const { data } = await admin.from('ai_providers').select('secret_name')
      return json({ keys: Object.fromEntries((data ?? []).map(p => [p.secret_name, Boolean(Deno.env.get(p.secret_name as string))])) })
    }
    if (role !== 'founder') return json({ error: 'Founders only — and sign in with your authenticator code' }, 403)

    if (action === 'backup_now') return json(await backupAndStore(admin, 'manual', memberId))
    if (action === 'backup_link') {
      const { data: b } = await admin.from('backups').select('storage_path').eq('id', String(body.id ?? '')).eq('status', 'succeeded').maybeSingle()
      if (!b?.storage_path) return json({ error: 'That backup isn’t available' }, 404)
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(b.storage_path, 3600)
      return json({ url: data?.signedUrl })
    }
    if (action === 'export') {
      const { data: fresh } = await me.rpc('password_is_recent')
      if (!fresh) return json({ error: 'Re-enter your password to export everything' }, 403)
      const b = await buildBackup(admin)
      await admin.from('backups').insert({ kind: 'export_csv', trigger: 'manual', status: 'succeeded', size_bytes: b.zip.length, finished_at: new Date().toISOString(), created_by: memberId })   // logged in the activity feed
      return new Response(b.zip, { headers: { ...corsHeaders, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="social-mog-export-${b.at.toISOString().slice(0, 10)}.zip"`, 'Cache-Control': 'no-store' } })
    }
    return json({ error: `Unknown action “${action}”` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
