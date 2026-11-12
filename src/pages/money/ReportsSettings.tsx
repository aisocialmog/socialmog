// Money reports (profit by brand / campaign, GST and TDS for the CA) and
// Money settings (company, bank & UPI for invoices, profit shares, categories).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { moneyApi, type OrgSettings } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { usePeriod } from '../../lib/prefs'
import { formatDate, formatINR, formatRange } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'
import { GST_STATE_LIST, GST_STATES, round2, TREATMENT_LABEL, type ProfitRow, type Treatment } from '../../lib/money'
import { Icon } from '../../components/ui/Icon'
import { Card, SectionTitle } from '../../components/ui/kit'
import { FormError, FormNote } from '../auth/AuthLayout'
import { BasisToggle, DataTable, Loading, MoneyHeader, MoneyTabs, useAsyncAction, useBasis, useIsFounder } from './MoneyBits'

type Tab = 'brand' | 'campaign' | 'gst' | 'tds'
const monthLabel = (m: string) => formatDate(m).slice(3)

export function MoneyReports() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'brand'
  const { range } = usePeriod()
  const [basis, setBasis] = useBasis()
  return (
    <div className="space-y-6">
      <MoneyHeader title="Money reports" kanji="報" sub={formatRange(range)} actions={(tab === 'brand' || tab === 'campaign') && <BasisToggle basis={basis} onChange={setBasis} />} />
      <MoneyTabs />
      <div role="tablist" aria-label="Report" className="inline-flex flex-wrap rounded-shoji border border-line/30 p-0.5 bg-card">
        {([['brand', 'Profit by brand'], ['campaign', 'Profit by campaign'], ['gst', 'GST summary'], ['tds', 'TDS summary']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { params.set('tab', k); setParams(params, { replace: true }) }}
            className={`px-3.5 h-9 rounded-[5px] text-sm ${tab === k ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>
      {(tab === 'brand' || tab === 'campaign') && <Profit group={tab} from={range.from} to={range.to} basis={basis} />}
      {tab === 'gst' && <Gst from={range.from} to={range.to} />}
      {tab === 'tds' && <Tds from={range.from} to={range.to} />}
    </div>
  )
}

function Profit({ group, from, to, basis }: { group: 'brand' | 'campaign'; from: string; to: string; basis: 'invoice' | 'cash' }) {
  const { data } = useAsync(() => moneyApi.profitBy(group, from, to, basis), [group, from, to, basis])
  if (!data) return <Loading label="Working out profit" />
  return <>
    <DataTable<ProfitRow> rows={data} rowKey={r => r.id ?? 'none'} rowLink={r => r.id ? `/${group === 'brand' ? 'brands' : 'campaigns'}/${r.id}` : ''} csvName={`profit-by-${group}`}
      empty="No revenue or costs in this range." search={r => `${r.name} ${r.brand_name ?? ''}`} searchPlaceholder={`Search ${group}s`} defaultSort={{ key: 'profit', dir: -1 }}
      cols={[
        { key: 'name', header: group === 'brand' ? 'Brand' : 'Campaign', cell: r => <>{r.name}{r.brand_name && <span className="block text-xs text-muted">{r.brand_name}</span>}</>, sort: r => r.name, csv: r => r.name },
        { key: 'rev', header: 'Revenue', align: 'right', cell: r => formatINR(r.revenue), sort: r => r.revenue, csv: r => r.revenue },
        { key: 'po', header: 'Creator payouts', align: 'right', cell: r => formatINR(r.creator_payouts), sort: r => r.creator_payouts, csv: r => r.creator_payouts },
        { key: 'dir', header: 'Direct expenses', align: 'right', hideSm: true, cell: r => formatINR(r.direct_expenses), sort: r => r.direct_expenses, csv: r => r.direct_expenses },
        { key: 'profit', header: 'Profit', align: 'right', cell: r => <span className={r.profit < 0 ? 'underline decoration-akane decoration-2 underline-offset-4' : ''}>{formatINR(r.profit)}</span>, sort: r => r.profit, csv: r => r.profit },
        { key: 'm', header: 'Margin', align: 'right', cell: r => r.margin_pct != null ? `${r.margin_pct}%` : '—', sort: r => r.margin_pct, csv: r => r.margin_pct },
      ]}
      extraCsv={group === 'campaign' ? [{ header: 'Brand', value: r => r.brand_name }] : []}
      footer={rows => { const t = { rev: round2(rows.reduce((s, r) => s + r.revenue, 0)), p: round2(rows.reduce((s, r) => s + r.profit, 0)) }; return <span className="text-muted">Revenue {formatINR(t.rev)} · profit <span className="text-ink num">{formatINR(t.p)}</span></span> }} />
    <p className="text-xs text-muted">Profit here = revenue − creator payouts − direct expenses linked to the {group}. Overheads (rent, software, salaries) aren’t spread across clients — see net profit on the overview.</p>
  </>
}

function Gst({ from, to }: { from: string; to: string }) {
  const months = useAsync(() => moneyApi.gstMonthly(from, to), [from, to])
  const reg = useAsync(() => moneyApi.gstRegister(from, to), [from, to])
  const org = useAsync(() => moneyApi.settings(), [])
  if (!months.data) return <Loading label="Adding up GST" />
  const sum = (k: 'taxable_value' | 'cgst' | 'sgst' | 'igst' | 'output_gst' | 'input_gst' | 'gst_paid' | 'net_gst') => round2(months.data!.reduce((s, m) => s + m[k], 0))
  const exportRegister = () => downloadCSV(`gst-invoices-${from}-to-${to}.csv`, reg.data ?? [], [
    { header: 'Invoice no.', value: r => r.invoice_number }, { header: 'Invoice date', value: r => formatDate(r.issue_date) }, { header: 'Customer', value: r => r.billing_name ?? r.brand_name },
    { header: 'Customer GSTIN', value: r => r.brand_gstin }, { header: 'Place of supply', value: r => r.place_of_supply_code ? `${r.place_of_supply_code}-${GST_STATES[r.place_of_supply_code] ?? ''}` : '' },
    { header: 'Type', value: r => r.brand_gstin ? 'B2B' : 'B2C' }, { header: 'GST rate %', value: r => r.gst_rate }, { header: 'Taxable value', value: r => r.taxable_value },
    { header: 'CGST', value: r => r.cgst }, { header: 'SGST', value: r => r.sgst }, { header: 'IGST', value: r => r.igst }, { header: 'Invoice total', value: r => r.total }])
  return (
    <div className="space-y-4">
      <Card className="shoji-pad">
        <SectionTitle kanji="税" aside={<div className="flex gap-2">
          <button className="btn-ghost h-9" onClick={() => downloadCSV(`gst-summary-${from}-to-${to}.csv`, months.data!, [
            { header: 'Month', value: m => monthLabel(m.month) }, { header: 'Invoices', value: m => m.invoices }, { header: 'Taxable value', value: m => m.taxable_value }, { header: 'CGST', value: m => m.cgst },
            { header: 'SGST', value: m => m.sgst }, { header: 'IGST', value: m => m.igst }, { header: 'Output GST', value: m => m.output_gst }, { header: 'Input GST (expenses)', value: m => m.input_gst },
            { header: 'Net GST (output − input)', value: m => m.net_gst }, { header: 'GST paid to government', value: m => m.gst_paid }])}><Icon name="download" /> Summary CSV</button>
          <button className="btn-ghost h-9" onClick={exportRegister} disabled={!reg.data}><Icon name="download" /> Invoice list CSV</button></div>}>GST by month</SectionTitle>
        {!org.data?.gstin && <FormNote>Our GSTIN isn’t set yet (Money → Settings). Invoices print as “Invoice” until it is.</FormNote>}
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm num">
            <thead><tr className="text-left text-xs text-muted border-b border-line/20">{['Month', 'Invoices', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Output GST', 'Input GST', 'Net GST', 'GST paid'].map((h, i) => <th key={h} scope="col" className={`py-2 px-2 font-normal ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line/15">
              {months.data.map(m => (
                <tr key={m.month}><th scope="row" className="py-2 px-2 text-left font-normal text-ink">{monthLabel(m.month)}</th><td className="py-2 px-2 text-right">{m.invoices}</td>
                  {[m.taxable_value, m.cgst, m.sgst, m.igst, m.output_gst, m.input_gst, m.net_gst, m.gst_paid].map((v, i) => <td key={i} className={`py-2 px-2 text-right ${i === 6 ? 'text-ink' : ''}`}>{formatINR(v)}</td>)}</tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-line/30 text-ink"><th scope="row" className="py-2 px-2 text-left font-medium">Total</th><td />
              {(['taxable_value', 'cgst', 'sgst', 'igst', 'output_gst', 'input_gst', 'net_gst', 'gst_paid'] as const).map(k => <td key={k} className="py-2 px-2 text-right font-medium">{formatINR(sum(k))}</td>)}</tr></tfoot>
          </table>
        </div>
        <p className="text-xs text-muted mt-3">Output GST is on sent invoices by invoice date. Input GST is the GST on expense bills (including creators who charge GST) by bill date — your CA confirms what is claimable. Net GST = output − input; “GST paid” is what you’ve recorded paying the government.</p>
      </Card>
    </div>
  )
}

function Tds({ from, to }: { from: string; to: string }) {
  const months = useAsync(() => moneyApi.tdsMonthly(from, to), [from, to])
  const reg = useAsync(() => moneyApi.tdsRegister(from, to), [from, to])
  if (!months.data) return <Loading label="Adding up TDS" />
  const t = (k: 'tds_by_clients' | 'tds_we_deducted' | 'tds_deposited') => round2(months.data!.reduce((s, m) => s + m[k], 0))
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="shoji p-4"><p className="eyebrow">TDS deducted by clients</p><p className="font-mincho text-2xl text-ink num mt-1">{formatINR(t('tds_by_clients'))}</p><p className="text-xs text-muted">Claim against our income tax (check Form 26AS)</p></div>
        <div className="shoji p-4"><p className="eyebrow">TDS we deducted</p><p className="font-mincho text-2xl text-ink num mt-1">{formatINR(t('tds_we_deducted'))}</p><p className="text-xs text-muted">From creator & freelancer payments</p></div>
        <div className="shoji p-4"><p className="eyebrow">TDS deposited</p><p className="font-mincho text-2xl text-ink num mt-1">{formatINR(t('tds_deposited'))}</p><p className="text-xs text-muted">Recorded under “TDS deposited”</p></div>
      </div>
      <Card className="shoji-pad">
        <SectionTitle kanji="税" aside={<button className="btn-ghost h-9" onClick={() => downloadCSV(`tds-by-month-${from}-to-${to}.csv`, months.data!, [
          { header: 'Month', value: m => monthLabel(m.month) }, { header: 'TDS deducted by clients', value: m => m.tds_by_clients }, { header: 'TDS we deducted', value: m => m.tds_we_deducted }, { header: 'TDS deposited', value: m => m.tds_deposited }])}><Icon name="download" /> CSV</button>}>By month</SectionTitle>
        <table className="w-full text-sm num">
          <thead><tr className="text-left text-xs text-muted border-b border-line/20"><th className="py-2 px-2 font-normal">Month</th><th className="py-2 px-2 font-normal text-right">By clients</th><th className="py-2 px-2 font-normal text-right">We deducted</th><th className="py-2 px-2 font-normal text-right">Deposited</th></tr></thead>
          <tbody className="divide-y divide-line/15">{months.data.map(m => <tr key={m.month}><th scope="row" className="py-2 px-2 text-left font-normal text-ink">{monthLabel(m.month)}</th><td className="py-2 px-2 text-right">{formatINR(m.tds_by_clients)}</td><td className="py-2 px-2 text-right">{formatINR(m.tds_we_deducted)}</td><td className="py-2 px-2 text-right">{formatINR(m.tds_deposited)}</td></tr>)}</tbody>
        </table>
      </Card>
      {reg.data && <DataTable rows={reg.data} rowKey={r => r.source_id} rowLink={r => r.source_table === 'receipts' ? `/money/payments/${r.source_id}` : `/money/expenses/${r.source_id}`} csvName="tds-entries" empty="No TDS in this range."
        search={r => `${r.party} ${r.reference ?? ''}`} searchPlaceholder="Search party or reference"
        cols={[
          { key: 'date', header: 'Date', cell: r => formatDate(r.entry_date), sort: r => r.entry_date, csv: r => formatDate(r.entry_date) },
          { key: 'dir', header: 'Direction', cell: r => r.direction === 'deducted_by_client' ? 'Deducted by client' : 'Deducted by us', sort: r => r.direction, csv: r => r.direction === 'deducted_by_client' ? 'Deducted by client' : 'Deducted by us' },
          { key: 'party', header: 'Party', cell: r => <>{r.party}{r.party_pan && <span className="block text-xs text-muted">PAN {r.party_pan}</span>}</>, sort: r => r.party, csv: r => r.party },
          { key: 'gross', header: 'Gross', align: 'right', cell: r => formatINR(r.gross), sort: r => r.gross, csv: r => r.gross },
          { key: 'tds', header: 'TDS', align: 'right', cell: r => formatINR(r.tds), sort: r => r.tds, csv: r => r.tds },
        ]} extraCsv={[{ header: 'PAN', value: r => r.party_pan }, { header: 'Reference', value: r => r.reference }]} />}
    </div>
  )
}

// ─── Settings ───────────────────────────────────────────────
export function MoneySettings() {
  return (
    <div className="space-y-6">
      <MoneyHeader title="Money settings" kanji="設" />
      <MoneyTabs />
      <CompanySettings />
    </div>
  )
}

/** Company, bank/UPI, invoice defaults, profit shares and expense categories (also shown in Settings → Company). */
export function CompanySettings() {
  const founder = useIsFounder()
  const org = useAsync(() => moneyApi.settings(), [])
  const [s, setS] = useState<OrgSettings | null>(null)
  const act = useAsyncAction()
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (org.data) setS(org.data) }, [org.data])
  if (!s) return <Loading label="Opening settings" />
  const f = (k: keyof OrgSettings, label: string, hint?: string, type = 'text') => (
    <label className="block"><span className="text-sm text-ink">{label}</span>
      <input type={type} className="field mt-1.5" value={(s[k] as string | number | null) ?? ''} onChange={e => { setSaved(false); setS({ ...s, [k]: type === 'number' ? Number(e.target.value) : e.target.value || null }) }} />
      {hint && <span className="text-xs text-muted">{hint}</span>}</label>
  )
  return (
    <div className="space-y-6">
      <form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (await act.run(() => moneyApi.saveSettings({ ...s, gstin: s.gstin?.toUpperCase() ?? null, state: s.state_code ? GST_STATES[s.state_code] ?? s.state : s.state }))) setSaved(true) }}>
        <Card className="shoji-pad grid sm:grid-cols-2 gap-4">
          <SectionTitle kanji="社">On every invoice</SectionTitle><span className="hidden sm:block" />
          {f('legal_name', 'Legal name', 'As registered for GST')}
          {f('gstin', 'Our GSTIN', 'Leave blank if not registered — invoices then print as “Invoice”.')}
          {f('pan', 'PAN')}
          <label className="block"><span className="text-sm text-ink">Our GST state</span>
            <select className="field mt-1.5" value={s.state_code ?? ''} onChange={e => { setSaved(false); setS({ ...s, state_code: e.target.value || null }) }}>
              <option value="">Not set</option>{GST_STATE_LIST.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select>
            <span className="text-xs text-muted">Same state as the brand → CGST + SGST; other state → IGST.</span></label>
          <label className="block sm:col-span-2"><span className="text-sm text-ink">Address</span><textarea className="field h-20 py-2 mt-1.5" value={s.address ?? ''} onChange={e => { setSaved(false); setS({ ...s, address: e.target.value || null }) }} /></label>
          {f('email', 'Billing email', undefined, 'email')}
          {f('phone', 'Phone')}
          <div className="sm:col-span-2">
            <span className="text-sm text-ink">Logo</span>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="block mt-1.5 text-sm text-muted" onChange={async e => { const file = e.target.files?.[0]; if (file) { if (await act.run(() => moneyApi.uploadLogo(file))) org.reload() } }} />
            <span className="text-xs text-muted">{s.logo_path ? 'A logo is set.' : 'Until you add one, the invoice shows an ensō mark.'}</span>
          </div>
        </Card>
        <Card className="shoji-pad grid sm:grid-cols-2 gap-4">
          <SectionTitle kanji="銀">Bank & UPI (printed for payment)</SectionTitle><span className="hidden sm:block" />
          {f('bank_account_name', 'Account name')}{f('bank_name', 'Bank')}{f('bank_account_number', 'Account number')}{f('bank_ifsc', 'IFSC')}{f('bank_branch', 'Branch')}
          {f('upi_id', 'UPI ID', 'The invoice QR code pays this UPI ID the amount still due.')}
          <label className="block sm:col-span-2"><span className="text-sm text-ink">Terms printed at the bottom</span><textarea className="field h-16 py-2 mt-1.5" value={s.invoice_terms ?? ''} onChange={e => { setSaved(false); setS({ ...s, invoice_terms: e.target.value || null }) }} /></label>
        </Card>
        <Card className="shoji-pad grid sm:grid-cols-3 gap-4">
          <SectionTitle kanji="既">Defaults</SectionTitle><span className="hidden sm:block" /><span className="hidden sm:block" />
          {f('invoice_prefix', 'Invoice prefix', 'SM → SM/26-27/001')}
          <label className="block"><span className="text-sm text-ink">Number digits</span>
            <select className="field mt-1.5" value={s.invoice_number_digits ?? 3} onChange={e => { setSaved(false); setS({ ...s, invoice_number_digits: Number(e.target.value) }) }}>{[3, 4, 5, 6].map(n => <option key={n} value={n}>{n} digits ({String(1).padStart(n, '0')})</option>)}</select>
            <span className="text-xs text-muted">Numbers restart each financial year. The financial year runs 1 April – 31 March (India’s statutory year).</span></label>
          {f('default_gst_rate', 'GST rate %', undefined, 'number')}
          {f('default_payment_terms_days', 'Payment terms (days)', 'Used when a brand has none', 'number')}
          {f('default_creator_tds_rate', 'Creator TDS %', 'Pre-filled on new payouts', 'number')}
        </Card>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex items-center justify-end gap-3">{saved && <span className="text-sm text-muted">Saved.</span>}<button className="btn-primary" disabled={act.busy}>Save settings</button></div>
      </form>
      {founder && <Shares />}
      <Categories />
    </div>
  )
}

function Shares() {
  const { data, reload } = useAsync(() => moneyApi.founders(), [])
  const [v, setV] = useState<Record<string, number>>({})
  const act = useAsyncAction()
  useEffect(() => { if (data) setV(Object.fromEntries(data.map(f => [f.id, Number(f.profit_share_pct ?? 0)]))) }, [data])
  const total = round2(Object.values(v).reduce((s, x) => s + (Number(x) || 0), 0))
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="分">Profit share (founders only)</SectionTitle>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (total !== 100) { act.setError('The shares must add up to 100%.'); return } if (await act.run(() => moneyApi.saveShares(Object.entries(v).map(([id, p]) => ({ id, profit_share_pct: Number(p) }))))) reload() }}>
        <div className="grid sm:grid-cols-3 gap-3">
          {(data ?? []).map(f => <label key={f.id} className="block"><span className="text-sm text-ink">{f.name} %</span><input type="number" min="0" max="100" step="0.01" className="field mt-1.5 num" value={v[f.id] ?? 0} onChange={e => setV({ ...v, [f.id]: e.target.value as unknown as number })} /></label>)}
        </div>
        <p className={`text-sm ${total === 100 ? 'text-muted' : 'text-ink'}`}>Total {total}% — company capital entries and profit transfers are split this way.</p>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end"><button className="btn-ghost" disabled={act.busy}>Save shares</button></div>
      </form>
    </Card>
  )
}

export function Categories() {
  const { data, reload } = useAsync(() => moneyApi.categories(true), [])
  const [name, setName] = useState('')
  const [treatment, setTreatment] = useState<Treatment>('direct')
  const act = useAsyncAction()
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="類">Expense categories</SectionTitle>
      <ul className="divide-y divide-line/15">
        {(data ?? []).map(c => (
          <li key={c.id} className={`py-2.5 flex flex-wrap items-center justify-between gap-3 ${c.is_archived ? 'opacity-60' : ''}`}>
            <span className="text-ink">{c.name}{c.system_key && <span className="text-xs text-muted ml-2">used by the app</span>}{c.is_archived && <span className="text-xs text-muted ml-2">hidden</span>}</span>
            <span className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`cat-${c.id}`}>How {c.name} counts</label>
              <select id={`cat-${c.id}`} className="field h-9 w-56" value={c.treatment} disabled={!!c.system_key} onChange={async e => { await act.run(() => moneyApi.saveCategory({ name: c.name, treatment: e.target.value as Treatment }, c.id)); reload() }}>
                {(Object.keys(TREATMENT_LABEL) as Treatment[]).map(t => <option key={t} value={t}>{TREATMENT_LABEL[t]}</option>)}</select>
              {!c.system_key && <button className="btn-ghost h-9 text-sm" onClick={async () => { await act.run(() => moneyApi.saveCategory({ name: c.name, treatment: c.treatment, is_archived: !c.is_archived }, c.id)); reload() }}>{c.is_archived ? 'Show' : 'Hide'}</button>}
            </span>
          </li>
        ))}
      </ul>
      <form className="mt-4 flex flex-col sm:flex-row gap-2" onSubmit={async e => { e.preventDefault(); if (await act.run(() => moneyApi.saveCategory({ name: name.trim(), treatment }))) { setName(''); reload() } }}>
        <label className="flex-1"><span className="sr-only">New category name</span><input className="field" required placeholder="New category, e.g. Studio rent" value={name} onChange={e => setName(e.target.value)} /></label>
        <label><span className="sr-only">How it counts</span><select className="field sm:w-56" value={treatment} onChange={e => setTreatment(e.target.value as Treatment)}>{(Object.keys(TREATMENT_LABEL) as Treatment[]).map(t => <option key={t} value={t}>{TREATMENT_LABEL[t]}</option>)}</select></label>
        <button className="btn-ghost"><Icon name="plus" /> Add</button>
      </form>
      {act.error && <FormError>{act.error}</FormError>}
      <p className="text-xs text-muted mt-3">Direct costs reduce gross profit; overheads reduce net profit; tax payments reduce GST / TDS owed and aren’t costs. Hidden categories stay on old expenses.</p>
    </Card>
  )
}
