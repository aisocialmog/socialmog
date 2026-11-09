// Money overview for the date range in the top bar.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { moneyApi } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { usePeriod } from '../../lib/prefs'
import { formatDate, formatINR, formatRange, istToday } from '../../lib/format'
import { ACCOUNT_KIND_LABEL } from '../../lib/money'
import { Card, PreviewBadge, SectionTitle } from '../../components/ui/kit'
import { Andon, Hanko } from '../../components/art/Ink'
import { supabase } from '../../lib/supabase'
import { FormError } from '../auth/AuthLayout'
import { BasisToggle, Loading, MoneyHeader, MoneyTabs, Stat, rupees, useBasis, useIsFounder } from './MoneyBits'

export function MoneyOverview() {
  const { range } = usePeriod()
  const [basis, setBasis] = useBasis()
  const founder = useIsFounder()
  const ov = useAsync(() => moneyApi.overview(range.from, range.to, basis), [range.from, range.to, basis])
  const accts = useAsync(() => moneyApi.accounts(), [])
  const capital = useAsync(() => founder ? moneyApi.capitalAccounts() : Promise.resolve([]), [founder])
  const check = useAsync(() => founder ? moneyApi.balanceCheck() : Promise.resolve(null), [founder])
  const month = istToday().slice(0, 8) + '01'
  const retainers = useAsync(() => moneyApi.retainersToInvoice(month), [month])
  const o = ov.data
  const cashLabel = basis === 'cash'
  return (
    <div className="space-y-6">
      <MoneyHeader title="Money" sub={<>{formatRange(range)} · {cashLabel ? 'profit on payments basis' : 'profit on invoice basis'}</>}
        actions={<>{!supabase && <PreviewBadge />}<BasisToggle basis={basis} onChange={setBasis} /></>} />
      <MoneyTabs />
      {ov.error && <FormError>{ov.error}</FormError>}
      {!o ? <Loading label="Adding up the books" /> : <>
        <RetainerNudge rows={retainers.data ?? []} onDone={retainers.reload} />
        <section aria-label="Profit for the range" className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat label="Revenue invoiced" value={rupees(o.revenue_invoiced)} hint="Sent invoices, before GST" to="/money/invoices" />
          <Stat label="Cash received" value={rupees(o.cash_received)} hint={o.other_income ? `incl. ${formatINR(o.other_income)} other income` : 'Into all accounts'} to="/money/payments" />
          <Stat label="Expenses" value={rupees(o.expenses)} hint={`${formatINR(o.direct_expenses)} direct · ${formatINR(o.overhead_expenses)} overhead`} to="/money/expenses" />
          <Stat label="Creator payouts" value={rupees(o.creator_payouts)} hint={cashLabel ? 'Paid in the range' : 'Agreed in the range'} to="/money/payouts" />
          <Stat label="Gross profit" value={rupees(o.gross_profit)} tone={o.gross_profit < 0 ? 'alert' : undefined} hint={o.gross_margin_pct != null ? `${o.gross_margin_pct}% margin` : 'No revenue yet'} />
          <Stat label="Net profit" value={rupees(o.net_profit)} tone={o.net_profit < 0 ? 'alert' : undefined} hint={o.net_margin_pct != null ? `${o.net_margin_pct}% margin` : 'No revenue yet'} />
        </section>
        <p className="text-xs text-muted -mt-2">
          Gross profit = {cashLabel ? 'revenue received (before GST)' : 'revenue invoiced'} − creator payouts − direct expenses. Net profit = gross profit − overheads + other income.
          {cashLabel ? ' Payments basis counts money when it moves.' : ' Invoice basis counts revenue on the invoice date and costs when they’re incurred.'}
        </p>

        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="shoji-pad">
            <SectionTitle kanji="債" aside={<Link className="text-sm text-muted hover:text-ink" to="/money/invoices?status=open">Open invoices</Link>}>Owed to us today</SectionTitle>
            <p className="font-mincho text-3xl text-ink num">{rupees(o.outstanding)}</p>
            <p className="text-sm text-muted mt-1">{o.outstanding_invoices} unpaid invoice{o.outstanding_invoices === 1 ? '' : 's'}
              {o.overdue > 0 && <> · <span className="text-ink inline-flex items-center gap-1"><Andon size={13} lit /> {formatINR(o.overdue)} overdue</span></>}</p>
            <Ageing rows={[['0–30 days', o.age_0_30], ['31–60 days', o.age_31_60], ['60+ days', o.age_61_plus]]} total={o.outstanding} />
          </Card>
          <Card className="shoji-pad">
            <SectionTitle kanji="払" aside={<Link className="text-sm text-muted hover:text-ink" to="/money/payouts/due">Payouts due</Link>}>We owe</SectionTitle>
            <p className="font-mincho text-3xl text-ink num">{rupees(o.payouts_pending)}</p>
            <p className="text-sm text-muted mt-1">{o.payouts_pending_count} payout{o.payouts_pending_count === 1 ? '' : 's'} pending or approved (net of TDS)
              {o.payouts_overdue_count > 0 && <> · <span className="text-ink">{o.payouts_overdue_count} past due</span></>}</p>
            {o.unpaid_expenses > 0 && <p className="text-sm text-ink mt-3">{formatINR(o.unpaid_expenses)} in unpaid expenses · <Link className="underline underline-offset-4" to="/money/expenses?status=unpaid">see them</Link></p>}
            <p className="text-sm text-muted mt-3">GST in the range: {formatINR(o.gst_output)} on invoices − {formatINR(o.gst_input)} input = <span className="text-ink num">{formatINR(o.gst_output - o.gst_input)}</span> · <Link className="underline underline-offset-4" to="/money/reports?tab=gst">GST summary</Link></p>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="shoji-pad">
            <SectionTitle kanji="口" aside={<Link className="text-sm text-muted hover:text-ink" to="/money/accounts">All accounts</Link>}>Account balances</SectionTitle>
            <ul className="divide-y divide-line/15">
              {(accts.data ?? []).map(a => (
                <li key={a.account_id}><Link to={`/money/accounts/${a.account_id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-ink">
                  <span className="min-w-0"><span className="text-ink">{a.name}</span><span className="text-xs text-muted ml-2">{ACCOUNT_KIND_LABEL[a.kind]}</span></span>
                  <span className={`num ${a.balance < 0 ? 'text-ink underline decoration-akane decoration-2 underline-offset-4' : 'text-ink'}`}>{formatINR(a.balance)}</span>
                </Link></li>
              ))}
            </ul>
            <p className="flex justify-between text-sm mt-2 pt-2 border-t border-line/25"><span className="text-muted">Total in all accounts</span>
              <span className="text-ink num">{formatINR((accts.data ?? []).reduce((s, a) => s + a.balance, 0))}</span></p>
          </Card>
          {founder ? (
            <Card className="shoji-pad">
              <SectionTitle kanji="資" aside={<Link className="text-sm text-muted hover:text-ink" to="/money/capital">Capital</Link>}>Capital per founder</SectionTitle>
              <ul className="divide-y divide-line/15">
                {(capital.data ?? []).map(c => (
                  <li key={c.founder_id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-ink">{c.name}<span className="text-xs text-muted ml-2">{c.profit_share_pct}% share</span></span>
                    <span className="num text-ink">{formatINR(c.balance)}</span>
                  </li>
                ))}
              </ul>
              {check.data && <BalanceBadge ok={check.data.is_balanced} diff={check.data.difference} />}
            </Card>
          ) : (
            <Card className="shoji-pad"><SectionTitle kanji="資">Capital</SectionTitle><p className="text-sm text-muted">Capital and founder withdrawals are visible to founders only.</p></Card>
          )}
        </div>
      </>}
    </div>
  )
}

function Ageing({ rows, total }: { rows: [string, number][]; total: number }) {
  return (
    <figure className="mt-5">
      <figcaption className="eyebrow mb-2">Ageing — days since the invoice date</figcaption>
      <ul className="space-y-2.5">
        {rows.map(([label, v]) => (
          <li key={label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm" title={`${label}: ${formatINR(v)}`}>
            <span className="text-muted">{label}</span>
            <span className="h-2 rounded-full bg-raised overflow-hidden" aria-hidden>
              <span className="block h-full rounded-full bg-kaki" style={{ width: total > 0 ? `${Math.max(v > 0 ? 3 : 0, (v / total) * 100)}%` : 0 }} />
            </span>
            <span className="text-ink num">{formatINR(v)}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function BalanceBadge({ ok, diff }: { ok: boolean; diff: number }) {
  return ok ? (
    <p className="mt-4 flex items-center gap-3 text-sm text-ink"><Hanko kind="completed" size={34} animate={false} /> The books balance: capital + retained profit matches what we hold, are owed and owe.
      <Link to="/money/capital#check" className="underline underline-offset-4 shrink-0">Details</Link></p>
  ) : (
    <p className="mt-4 rounded-shoji border border-akane/70 p-3 text-sm text-ink flex gap-2.5"><Andon size={18} lit />
      <span>The books are off by <span className="num font-medium">{formatINR(Math.abs(diff))}</span> — usually a missing entry (an opening balance without opening capital, an unrecorded payment). <Link to="/money/capital#check" className="underline underline-offset-4">See the check</Link></span></p>
  )
}

function RetainerNudge({ rows, onDone }: { rows: { retainer_id: string; brand_name: string; title: string; monthly_fee: number; invoice_id: string | null }[]; onDone: () => void }) {
  const nav = useNavigate()
  const due = rows.filter(r => !r.invoice_id)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  if (!due.length) return null
  const month = istToday().slice(0, 8) + '01'
  return (
    <div className="shoji p-4 flex flex-col gap-3">
      <p className="text-sm text-ink">{due.length} retainer{due.length > 1 ? 's' : ''} without an invoice for {formatDate(month).slice(3)}:</p>
      <ul className="flex flex-wrap gap-2">
        {due.map(r => (
          <li key={r.retainer_id}>
            <button className="btn-ghost h-9 text-sm" disabled={!!busy} onClick={async () => {
              setBusy(r.retainer_id); setErr(null)
              try { const id = await moneyApi.createRetainerInvoice(r.retainer_id, month); nav(`/money/invoices/${id}`) } catch (e) { setErr(e instanceof Error ? e.message : String(e)); onDone() } finally { setBusy(null) }
            }}>{busy === r.retainer_id ? 'Creating…' : `Create ${r.brand_name} — ${formatINR(r.monthly_fee)}`}</button>
          </li>
        ))}
      </ul>
      {err && <FormError>{err}</FormError>}
    </div>
  )
}
