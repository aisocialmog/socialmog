// POST /functions/v1/invite-member
// Body: { name, email, role, phone?, title?, monthly_cost?, joined_date?, resend? }
// Only an active founder may call this. Uses the service-role key, which
// exists only here on the server (Edge Function secret), never in the app.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1'
import { corsHeaders, json } from '../_shared/cors.ts'

const ROLES = ['founder', 'manager', 'team_member', 'freelancer'] as const
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const appOrigin = Deno.env.get('APP_ORIGIN') ?? req.headers.get('origin') ?? ''

  // 1. Who is calling? Use their own token so RLS + role helpers apply.
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: role, error: roleErr } = await asCaller.rpc('current_app_role')
  if (roleErr) return json({ error: 'Could not check your access' }, 401)
  if (role !== 'founder') return json({ error: 'Only a founder can invite people' }, 403)

  // 2. Validate input
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const memberRole = String(body.role ?? 'team_member')
  if (!name) return json({ error: 'Name is required' }, 400)
  if (!EMAIL.test(email)) return json({ error: 'A valid email is required' }, 400)
  if (!ROLES.includes(memberRole as typeof ROLES[number])) return json({ error: 'Unknown role' }, 400)
  const monthlyCost = body.monthly_cost === '' || body.monthly_cost == null ? null : Number(body.monthly_cost)
  if (monthlyCost !== null && (!Number.isFinite(monthlyCost) || monthlyCost < 0)) return json({ error: 'Monthly cost must be a positive number' }, 400)

  // 3. Create (or reuse) the team member row as the founder, so created_by and
  //    the activity log record who invited whom.
  const { data: existing } = await asCaller.from('team_members').select('id, user_id').ilike('email', email).maybeSingle()
  let memberId = existing?.id as string | undefined
  if (existing?.user_id && !body.resend) return json({ error: 'This person already has a login' }, 409)
  if (!memberId) {
    const { data, error } = await asCaller.from('team_members').insert({
      name, email, role: memberRole,
      phone: body.phone || null, title: body.title || null,
      monthly_cost: monthlyCost, joined_date: body.joined_date || undefined,
      invited_at: new Date().toISOString(),
    }).select('id').single()
    if (error) return json({ error: error.message }, 400)
    memberId = data.id
  }

  // 4. Send the invite email. The login links to the row by email (DB trigger).
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appOrigin}/reset-password?invite=1`,
    data: { full_name: name },
  })
  if (inviteErr) return json({ error: `Saved ${name}, but the email failed: ${inviteErr.message}`, member_id: memberId }, 502)

  await asCaller.from('team_members').update({ invited_at: new Date().toISOString() }).eq('id', memberId)
  return json({ ok: true, member_id: memberId })
})
