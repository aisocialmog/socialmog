// The Ops Board API.  Base: /functions/v1/ops
//   GET  /presence   GET /today   GET /summary?range=…&from=&to=   GET /activity?limit=   POST /status
// Auth: the Ops Board's own key in "x-api-key" (or "Authorization: Bearer <key>").
// Only a SHA-256 of the key is stored; it is checked, rate-limited and logged in the database.
// Browsers: only the Ops Board's domain (Settings → Integrations) may call this.
import { service } from '../_shared/server.ts'

const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('')
const DATE = /^\d{4}-\d{2}-\d{2}$/

Deno.serve(async req => {
  const url = new URL(req.url), origin = req.headers.get('origin')
  const path = '/' + url.pathname.split('/ops/')[1]?.replace(/\/+$/, '')
  const admin = service()
  const cors = (allowed: string | null): Record<string, string> => ({
    'Access-Control-Allow-Origin': allowed ?? 'null', Vary: 'Origin',
    'Access-Control-Allow-Headers': 'x-api-key, authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store' })
  const send = (body: unknown, status: number, allowed: string | null, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(allowed), 'Content-Type': 'application/json', ...extra } })

  if (req.method === 'OPTIONS') {
    const { data } = await admin.from('org_settings').select('ops_allowed_origin').limit(1).maybeSingle()
    return new Response(null, { status: 204, headers: cors(data?.ops_allowed_origin ?? null) })
  }
  const key = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!key.startsWith('smog_ops_')) return send({ error: 'Send your API key in the x-api-key header' }, 401, null)
  const { data: auth, error: authErr } = await admin.rpc('ops_authenticate', { p_key_hash: await sha(key), p_method: req.method, p_path: path })
  if (authErr || !auth) return send({ error: 'Could not check the API key' }, 500, null)
  const allowed: string | null = auth.allowed_origin
  // a browser on any other site is refused (server-to-server calls send no Origin)
  if (origin && (!allowed || origin.replace(/\/$/, '') !== allowed.replace(/\/$/, ''))) return send({ error: 'This origin is not allowed' }, 403, allowed)
  if (!auth.ok) return send({ error: auth.error }, auth.status, allowed, auth.status === 429 ? { 'Retry-After': '60' } : {})
  const ok = (data: unknown) => send(data, 200, allowed, { 'X-RateLimit-Limit': String(auth.limit), 'X-RateLimit-Remaining': String(auth.remaining) })
  const run = async (fn: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc(fn, args)
    return error ? send({ error: error.message }, 400, allowed) : ok(data)
  }

  if (req.method === 'GET') {
    if (path === '/presence') return run('ops_presence')
    if (path === '/today') return run('ops_today')
    if (path === '/activity') return run('ops_activity', { p_limit: Number(url.searchParams.get('limit')) || 20 })
    if (path === '/summary') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to')
      if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return send({ error: 'from and to must be YYYY-MM-DD' }, 400, allowed)
      return run('ops_summary', { p_range: url.searchParams.get('range') ?? 'this_week', p_from: from, p_to: to })
    }
  }
  if (req.method === 'POST' && path === '/status') {
    let b: Record<string, unknown>
    try { b = await req.json() } catch { return send({ error: 'Invalid JSON' }, 400, allowed) }
    // only these four fields are read; nothing else can be written through this API
    return run('ops_set_status', { p_founder: String(b.founder ?? ''), p_status: String(b.status ?? ''), p_message: b.message == null ? null : String(b.message),
      p_expected_back: typeof b.expected_back === 'string' && !Number.isNaN(Date.parse(b.expected_back)) ? b.expected_back : null })
  }
  return send({ error: 'Not found. Endpoints: GET /presence, /today, /summary, /activity · POST /status' }, 404, allowed)
})
