// POST /functions/v1/daily-digest — called by the database scheduler at 9:00 am IST.
// Emails each active person their tasks for the day (and what's overdue).
import { emailFrame, esc, isCron, sendEmail, service } from '../_shared/server.ts'

interface Person { name: string; email: string; today: { title: string; due_time: string | null; priority: string }[]; overdue: { title: string; due_date: string }[] }
const time = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return ` · ${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}` }
const list = (items: string[]) => `<ul style="padding-left:18px;margin:8px 0 16px;font-size:15px;line-height:1.6">${items.map(i => `<li>${i}</li>`).join('')}</ul>`

Deno.serve(async req => {
  if (!isCron(req)) return new Response('Forbidden', { status: 403 })
  const { data, error } = await service().rpc('daily_digest_data')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const results: Record<string, string> = {}
  for (const p of (data ?? []) as Person[]) {
    if (!p.today.length && !p.overdue.length) continue          // nothing to say: no email
    const html = emailFrame(`Ohayō, ${p.name.split(' ')[0]}`,
      (p.today.length ? `<p style="margin:0;font-weight:bold">Today</p>` + list(p.today.map(t => `${esc(t.title)}${time(t.due_time)}${t.priority === 'urgent' || t.priority === 'high' ? ` <span style="color:#B7282E">(${t.priority})</span>` : ''}`)) : '<p>Nothing due today.</p>') +
      (p.overdue.length ? `<p style="margin:0;font-weight:bold;color:#B7282E">Overdue</p>` + list(p.overdue.map(t => `${esc(t.title)} · was due ${esc(t.due_date)}`)) : ''))
    results[p.email] = (await sendEmail([p.email], `Your day: ${p.today.length} task${p.today.length === 1 ? '' : 's'}${p.overdue.length ? `, ${p.overdue.length} overdue` : ''}`, html)) ?? 'sent'
  }
  return Response.json({ sent: Object.values(results).filter(r => r === 'sent').length, results })
})
