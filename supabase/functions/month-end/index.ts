// POST /functions/v1/month-end  { from, to } — called by the month-end automation.
// Builds the monthly P&L and capital statement as one PDF and emails it to the founders.
import { emailFrame, esc, isCron, sendEmail, service } from '../_shared/server.ts'
import { inr, makePdf, row, type PdfLine } from '../_shared/pdf.ts'

type R = Record<string, string | number | null>
const b64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }

Deno.serve(async req => {
  if (!isCron(req)) return new Response('Forbidden', { status: 403 })
  const { from, to } = await req.json().catch(() => ({}))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) return Response.json({ error: 'from and to are required' }, { status: 400 })
  const { data, error } = await service().rpc('month_end_data', { p_from: from, p_to: to })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const month = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(from + 'T00:00:00Z'))
  const pnl = data.pnl.sections[0].rows as R[], cap = data.capital.sections[0].rows as R[]

  const lines: PdfLine[] = [
    { text: String(data.company ?? 'Social Mog'), bold: true, size: 16 }, { text: `Month-end statements - ${month}`, size: 11 }, { text: `${from} to ${to} - invoice basis`, size: 9 },
    { text: 'PROFIT & LOSS', bold: true, size: 12, gap: 18 }, { text: row(['', 'This month', 'Previous'], [34, 18, 18]), bold: true },
    ...pnl.map(r => ({ text: row([String(r.line), inr(Number(r.amount)), inr(Number(r.prev))], [34, 18, 18]), bold: !!r.bold })),
    { text: 'CAPITAL STATEMENT', bold: true, size: 12, gap: 22 }, { text: row(['Founder', 'Opening', 'Added', 'Withdrawn', 'Profit', 'Closing'], [20, 13, 12, 12, 12, 13]), bold: true },
    ...cap.map(r => ({ text: row([String(r.name), inr(Number(r.opening)), inr(Number(r.added)), inr(Number(r.withdrawn)), inr(Number(r.profit_share)), inr(Number(r.closing))], [20, 13, 12, 12, 12, 13]) })),
    { text: 'Closing = opening + added - withdrawn + profit share credited.', size: 8, gap: 10 },
    { text: `The books are closed through ${to}. Changes to that month need a founder and a reason.`, size: 8 },
  ]
  const net = pnl.find(r => r.line === 'Net profit')
  const html = emailFrame(`${month} is closed`, `<p style="font-size:15px;line-height:1.6">Net profit for the month: <strong>${esc(inr(Number(net?.amount ?? 0)).replace('Rs ', '₹'))}</strong>.<br>The P&amp;L and each founder’s capital statement are attached.</p>
    <p style="font-size:13px;color:#5c5752">Money records dated up to ${esc(to)} are now locked: an edit needs a founder and a reason, and is logged.</p>`)
  const err = await sendEmail(data.founders, `Social Mog — ${month} P&L and capital statement`, html, [{ filename: `social-mog-${from.slice(0, 7)}.pdf`, content: b64(makePdf(lines)) }])
  return Response.json(err ? { error: err } : { sent: data.founders.length }, { status: err ? 502 : 200 })
})
