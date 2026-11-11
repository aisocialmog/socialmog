// Shared by the server-only functions (digest, month-end, weekly insight).
// Secrets live here on the server: SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, RESEND_API_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1'

export const service = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

/** Only the database scheduler may call these functions (it sends the shared secret). */
export function isCron(req: Request): boolean {
  const want = Deno.env.get('CRON_SECRET'), got = req.headers.get('x-cron-secret') ?? ''
  if (!want || want.length !== got.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** Send one email through Resend (free tier). Returns an error message, or null when sent. */
export async function sendEmail(to: string[], subject: string, html: string, attachments?: { filename: string; content: string }[]): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return 'RESEND_API_KEY is not set'
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('EMAIL_FROM') ?? 'Social Mog OS <onboarding@resend.dev>', to, subject, html, attachments }),
  })
  return r.ok ? null : `Resend ${r.status}: ${(await r.text()).slice(0, 200)}`
}

/** The email frame, in our colours. */
export const emailFrame = (title: string, body: string) => `<div style="background:#F7F1E6;padding:24px;font-family:Georgia,serif;color:#1E1C1A">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5dccb;border-radius:6px;padding:24px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:2px;color:#8F877F">SOCIAL MOG OS</p>
<h1 style="margin:0 0 16px;font-size:22px">${esc(title)}</h1>${body}
<p style="margin:24px 0 0;font-size:12px;color:#8F877F"><a href="${esc(Deno.env.get('APP_ORIGIN') ?? '#')}" style="color:#B7282E">Open Social Mog OS</a></p></div></div>`
