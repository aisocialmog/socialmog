// Invoices: list, editor (drafts free; sent invoices need a reason), detail
// with the printable invoice (logo, GSTIN, bank details, UPI QR) — "Download
// PDF" prints only the paper.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { moneyApi, type BrandBilling, type InvoiceDetail, type InvoiceInput, type InvoiceItem, type OrgSettings } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { amountInWords, GST_STATE_LIST, GST_STATES, gstSplit, isInterstate, PAY_STATUS_LABEL, PAY_STATUS_TONE, PAY_STATUSES, round2, upiLink, type InvoiceTotals, type PayStatus } from '../../lib/money'
import { Icon } from '../../components/ui/Icon'
import { Card, MoreMenu, Pill, SectionTitle } from '../../components/ui/kit'
import { Modal } from '../../components/ui/Modal'
import { Andon, Hanko } from '../../components/art/Ink'
import { FormError } from '../auth/AuthLayout'
import { DataTable, Facts, Loading, MoneyHeader, MoneyHistory, MoneyTabs, NotFound, ReasonModal, Select, dateCell, money, useAsyncAction } from './MoneyBits'

export const statusPill = (s: PayStatus) => <Pill tone={PAY_STATUS_TONE[s]}>{s === 'overdue' && <Andon size={12} lit />}{PAY_STATUS_LABEL[s]}</Pill>

// ─── List ───────────────────────────────────────────────────
export function InvoicesPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { data, error } = useAsync(() => moneyApi.invoices(), [])
  const [status, setStatus] = useState<'all' | 'open' | PayStatus>((params.get('status') as 'open') ?? 'all')
  const [brand, setBrand] = useState('all')
  const brands = useMemo(() => [...new Map((data ?? []).map(i => [i.brand_id, i.brand_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data])
  const rows = (data ?? []).filter(i => status === 'all' || (status === 'open' ? i.outstanding > 0 : i.payment_status === status)).filter(i => brand === 'all' || i.brand_id === brand)
  return (
    <div className="space-y-6">
      <MoneyHeader title="Invoices" kanji="請" sub={`${rows.length} invoices`} actions={<button className="btn-primary" onClick={() => nav('/money/invoices/new')}><Icon name="plus" /> New invoice</button>} />
      <MoneyTabs />
      {error && <FormError>{error}</FormError>}
      {!data ? <Loading label="Loading invoices" /> : (
        <DataTable rows={rows} rowKey={i => i.invoice_id} rowLink={i => `/money/invoices/${i.invoice_id}`} csvName="invoices" empty="No invoices yet."
          search={i => `${i.invoice_number ?? 'draft'} ${i.brand_name} ${i.campaign_name ?? ''}`} searchPlaceholder="Search number, brand, campaign"
          dateOf={i => i.issue_date ?? i.created_at.slice(0, 10)} defaultSort={{ key: 'date', dir: -1 }}
          filters={<>
            <Select id="inv-status" label="Status" value={status} onChange={setStatus} options={[['all', 'Any status'], ['open', 'Unpaid (owed)'], ...PAY_STATUSES.map(s => [s, PAY_STATUS_LABEL[s]] as [PayStatus, string])]} />
            <Select id="inv-brand" label="Brand" value={brand} onChange={setBrand} options={[['all', 'Any brand'], ...brands]} />
          </>}
          cols={[
            { key: 'number', header: 'Invoice', cell: i => <span className="num">{i.invoice_number ?? 'Draft'}</span>, sort: i => i.invoice_number ?? '', csv: i => i.invoice_number ?? 'Draft' },
            { key: 'brand', header: 'Brand', cell: i => <><span className="text-ink">{i.brand_name}</span>{i.campaign_name && <span className="block text-xs text-muted">{i.campaign_name}</span>}</>, sort: i => i.brand_name, csv: i => i.brand_name },
            { key: 'date', header: 'Date', cell: i => dateCell(i.issue_date), sort: i => i.issue_date ?? i.created_at, csv: i => i.issue_date ? formatDate(i.issue_date) : '' },
            { key: 'due', header: 'Due', hideSm: true, cell: i => dateCell(i.due_date), sort: i => i.due_date, csv: i => i.due_date ? formatDate(i.due_date) : '' },
            { key: 'status', header: 'Status', cell: i => <>{statusPill(i.payment_status)}{i.days_overdue > 0 && <span className="block text-xs text-muted mt-1">{i.days_overdue} days late</span>}</>, sort: i => i.payment_status, csv: i => PAY_STATUS_LABEL[i.payment_status] },
            { key: 'total', header: 'Total', align: 'right', cell: i => formatINR(i.total), sort: i => i.total, csv: i => i.total },
            { key: 'outstanding', header: 'Owed', align: 'right', cell: i => i.outstanding ? formatINR(i.outstanding) : '—', sort: i => i.outstanding, csv: i => i.outstanding },
          ]}
          extraCsv={[{ header: 'Campaign', value: i => i.campaign_name }, { header: 'Taxable value (INR)', value: i => i.subtotal }, { header: 'CGST', value: i => i.cgst },
            { header: 'SGST', value: i => i.sgst }, { header: 'IGST', value: i => i.igst }, { header: 'TDS expected', value: i => i.tds_expected }, { header: 'Paid', value: i => i.paid }]}
          footer={shown => <span className="text-muted">Total {formatINR(round2(shown.reduce((s, i) => s + i.total, 0)))} · owed <span className="text-ink num">{formatINR(round2(shown.reduce((s, i) => s + i.outstanding, 0)))}</span></span>} />
      )}
    </div>
  )
}

// ─── Editor ─────────────────────────────────────────────────
const blankLine = (): InvoiceItem => ({ position: 1, description: '', hsn_sac: '998361', quantity: 1, rate: 0 })
export function InvoiceEditor() {
  const { id } = useParams()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const org = useAsync(() => moneyApi.settings(), [])
  const brands = useAsync(() => moneyApi.brandOptions(), [])
  const camps = useAsync(() => moneyApi.campaignOptions(), [])
  const existing = useAsync(() => id ? moneyApi.invoice(id) : Promise.resolve(null), [id])
  const [h, setH] = useState<InvoiceInput | null>(null)
  const [lines, setLines] = useState<InvoiceItem[]>([blankLine()])
  const [ask, setAsk] = useState<null | 'save'>(null)
  const act = useAsyncAction()

  useEffect(() => {
    if (id && existing.data) {
      const t = existing.data.totals
      setH({ brand_id: t.brand_id, campaign_id: t.campaign_id, due_date: t.due_date, issue_date: t.issue_date, gst_enabled: t.gst_enabled, gst_rate: t.gst_rate, tds_rate: t.tds_rate,
        place_of_supply_code: t.place_of_supply_code, service_period_start: t.service_period_start, service_period_end: t.service_period_end, notes: t.notes })
      setLines(existing.data.items.map(i => ({ id: i.id, position: i.position, description: i.description, hsn_sac: i.hsn_sac, quantity: Number(i.quantity), rate: Number(i.rate) })))
    } else if (!id && org.data && !h) {
      const b = params.get('brand') ?? ''
      setH({ brand_id: b, campaign_id: params.get('campaign'), due_date: null, issue_date: null, gst_enabled: true, gst_rate: Number(org.data.default_gst_rate), tds_rate: 0,
        place_of_supply_code: brands.data?.find(x => x.id === b)?.state_code ?? null, service_period_start: null, service_period_end: null, notes: null })
    }
  }, [id, existing.data, org.data, brands.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!h || !org.data) return <Loading label="Opening the invoice" />
  const t = existing.data?.totals
  if (t?.document_status === 'cancelled') return <NotFound what="invoice (it is cancelled)" />
  const sent = t?.document_status === 'sent'
  const sub = round2(lines.reduce((s, l) => s + round2((Number(l.quantity) || 0) * (Number(l.rate) || 0)), 0))
  const inter = isInterstate(h.place_of_supply_code, org.data.state_code)
  const g = gstSplit(sub, h.gst_enabled, Number(h.gst_rate) || 0, inter)
  const set = (p: Partial<InvoiceInput>) => setH({ ...h, ...p })
  const setLine = (i: number, p: Partial<InvoiceItem>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...p } : l))
  const valid = h.brand_id && lines.length > 0 && lines.every(l => l.description.trim() && Number(l.quantity) > 0 && Number(l.rate) >= 0)
  const save = async (reason?: string, andSend = false) => {
    const clean = lines.map(l => ({ ...l, description: l.description.trim(), quantity: Number(l.quantity), rate: Number(l.rate) }))
    const doIt = async () => { const nid = await moneyApi.saveInvoice(h, clean, id, reason); if (andSend) await moneyApi.sendInvoice(nid, h.issue_date); return nid }
    if (reason) { nav(`/money/invoices/${await doIt()}`); return }   // errors show in the reason dialog
    let nid = ''
    if (await act.run(async () => { nid = await doIt() })) nav(`/money/invoices/${nid}`)
  }
  return (
    <div className="space-y-6 max-w-4xl">
      <MoneyHeader title={id ? `Edit ${t?.invoice_number ?? 'draft invoice'}` : 'New invoice'} kanji="請"
        sub={sent ? 'This invoice has been sent — saving asks for a reason, and the number stays the same.' : 'Drafts have no number yet. The number (SM/26-27/001…) is given when you send it.'} />
      <form className="space-y-5" onSubmit={e => { e.preventDefault(); if (sent) setAsk('save'); else save() }}>
        <Card className="shoji-pad grid sm:grid-cols-2 gap-4">
          <label className="block"><span className="text-sm text-ink">Brand</span>
            <select className="field mt-1.5" required value={h.brand_id} disabled={sent} onChange={e => { const b = brands.data?.find(x => x.id === e.target.value); set({ brand_id: e.target.value, campaign_id: null, place_of_supply_code: b?.state_code ?? null }) }}>
              <option value="">Choose a brand</option>{(brands.data ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
          <label className="block"><span className="text-sm text-ink">Campaign <span className="text-muted">(optional)</span></span>
            <select className="field mt-1.5" value={h.campaign_id ?? ''} onChange={e => set({ campaign_id: e.target.value || null })}>
              <option value="">Not linked</option>{(camps.data ?? []).filter(c => c.brand_id === h.brand_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label className="block"><span className="text-sm text-ink">Invoice date</span>
            <input type="date" className="field mt-1.5" value={h.issue_date ?? ''} onChange={e => set({ issue_date: e.target.value || null })} />
            <span className="text-xs text-muted">{sent ? 'Changing it doesn’t change the number.' : 'Leave empty to use the day you send it.'}</span></label>
          <label className="block"><span className="text-sm text-ink">Due date</span>
            <input type="date" className="field mt-1.5" value={h.due_date ?? ''} onChange={e => set({ due_date: e.target.value || null })} />
            <span className="text-xs text-muted">Empty = the brand’s payment terms ({brands.data?.find(b => b.id === h.brand_id)?.payment_terms_days ?? org.data.default_payment_terms_days} days).</span></label>
          <label className="block"><span className="text-sm text-ink">Service period from</span><input type="date" className="field mt-1.5" value={h.service_period_start ?? ''} onChange={e => set({ service_period_start: e.target.value || null })} /></label>
          <label className="block"><span className="text-sm text-ink">to</span><input type="date" className="field mt-1.5" value={h.service_period_end ?? ''} onChange={e => set({ service_period_end: e.target.value || null })} /></label>
        </Card>

        <Card className="shoji-pad">
          <SectionTitle kanji="品">Line items</SectionTitle>
          <div className="space-y-3">
            <div className="hidden md:grid grid-cols-[1fr_7rem_5rem_8rem_8rem_2.5rem] gap-2 text-xs text-muted"><span>Description</span><span>SAC</span><span>Qty</span><span>Rate (₹)</span><span className="text-right">Amount</span><span /></div>
            {lines.map((l, i) => (
              <div key={l.id ?? i} className="grid grid-cols-2 md:grid-cols-[1fr_7rem_5rem_8rem_8rem_2.5rem] gap-2 items-center border-b border-line/15 pb-3 md:border-0 md:pb-0">
                <label className="col-span-2 md:col-span-1"><span className="sr-only">Description, line {i + 1}</span>
                  <input className="field" required placeholder="e.g. 4 Instagram reels — Diwali campaign" value={l.description} onChange={e => setLine(i, { description: e.target.value })} /></label>
                <label><span className="sr-only">SAC code, line {i + 1}</span><input className="field" value={l.hsn_sac ?? ''} onChange={e => setLine(i, { hsn_sac: e.target.value || null })} /></label>
                <label><span className="sr-only">Quantity, line {i + 1}</span><input type="number" min="0.01" step="0.01" className="field num" required value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value as unknown as number })} /></label>
                <label><span className="sr-only">Rate, line {i + 1}</span><input type="number" min="0" step="0.01" className="field num" required value={l.rate} onChange={e => setLine(i, { rate: e.target.value as unknown as number })} /></label>
                <output className="text-right num text-ink" aria-label={`Amount, line ${i + 1}`}>{formatINR(round2((Number(l.quantity) || 0) * (Number(l.rate) || 0)))}</output>
                <button type="button" className="icon-btn justify-self-end" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><Icon name="close" /></button>
              </div>
            ))}
            <button type="button" className="btn-ghost" onClick={() => setLines(ls => [...ls, blankLine()])}><Icon name="plus" /> Add a line</button>
          </div>
        </Card>

        <div className="grid md:grid-cols-2 gap-4">
          <Card className="shoji-pad space-y-4">
            <label className="flex items-center gap-3"><input type="checkbox" className="w-4 h-4 accent-[var(--accent)]" checked={h.gst_enabled} onChange={e => set({ gst_enabled: e.target.checked })} /><span className="text-sm text-ink">Charge GST</span></label>
            {h.gst_enabled && <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-sm text-ink">GST rate %</span><input type="number" min="0" max="28" step="0.01" className="field mt-1.5 num" value={h.gst_rate} onChange={e => set({ gst_rate: e.target.value as unknown as number })} /></label>
              <label className="block"><span className="text-sm text-ink">Place of supply</span>
                <select className="field mt-1.5" value={h.place_of_supply_code ?? ''} onChange={e => set({ place_of_supply_code: e.target.value || null })}>
                  <option value="">Not set</option>{GST_STATE_LIST.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
                </select></label>
            </div>}
            {h.gst_enabled && <p className="text-xs text-muted">{!org.data.state_code ? 'Set our GST state in Money → Settings to choose CGST + SGST or IGST correctly.' : inter ? `Brand is outside ${GST_STATES[org.data.state_code] ?? 'our state'} → IGST.` : `Same state as us → CGST + SGST.`}</p>}
            <label className="block"><span className="text-sm text-ink">TDS the brand will deduct %</span>
              <input type="number" min="0" max="30" step="0.01" className="field mt-1.5 num" value={h.tds_rate} onChange={e => set({ tds_rate: e.target.value as unknown as number })} />
              <span className="text-xs text-muted">Usually 2% (194C) or 10% (194J). Shown on the invoice as “net payable”.</span></label>
            <label className="block"><span className="text-sm text-ink">Notes on the invoice</span><textarea className="field h-20 py-2 mt-1.5" value={h.notes ?? ''} onChange={e => set({ notes: e.target.value || null })} placeholder="PO number, campaign reference…" /></label>
          </Card>
          <Card className="shoji-pad">
            <SectionTitle kanji="計">Totals</SectionTitle>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="num text-ink">{formatINR(sub)}</dd></div>
              {h.gst_enabled && (inter ? <div className="flex justify-between"><dt className="text-muted">IGST {h.gst_rate}%</dt><dd className="num text-ink">{formatINR(g.igst)}</dd></div> : <>
                <div className="flex justify-between"><dt className="text-muted">CGST {round2(Number(h.gst_rate) / 2)}%</dt><dd className="num text-ink">{formatINR(g.cgst)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">SGST {round2(Number(h.gst_rate) / 2)}%</dt><dd className="num text-ink">{formatINR(g.sgst)}</dd></div></>)}
              <div className="flex justify-between border-t border-line/25 pt-2 font-medium"><dt className="text-ink">Total</dt><dd className="num text-ink">{formatINR(sub + g.gst)}</dd></div>
              {Number(h.tds_rate) > 0 && <div className="flex justify-between text-muted"><dt>Less TDS {h.tds_rate}% (on subtotal)</dt><dd className="num">{formatINR(round2(sub * Number(h.tds_rate) / 100))}</dd></div>}
            </dl>
            <p className="text-xs text-muted mt-4">Totals are calculated from the lines — they can’t be typed in.</p>
          </Card>
        </div>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => nav(-1)}>Cancel</button>
          <button className={sent ? 'btn-primary' : 'btn-ghost'} disabled={!valid || act.busy}>{act.busy ? 'Saving…' : sent ? 'Save changes' : 'Save draft'}</button>
          {!sent && <button type="button" className="btn-primary" disabled={!valid || act.busy} onClick={() => save(undefined, true)}>Save &amp; send</button>}
        </div>
      </form>
      {ask && <ReasonModal title={`Change ${t?.invoice_number}`} note="This invoice has already gone to the brand. If the brand needs a fresh copy, download the PDF again after saving." onClose={() => setAsk(null)} onConfirm={r => save(r)} />}
    </div>
  )
}

// ─── Detail ─────────────────────────────────────────────────
export function InvoiceDetailPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const inv = useAsync(() => moneyApi.invoice(id), [id])
  const org = useAsync(() => moneyApi.settings(), [])
  const t = inv.data?.totals
  const brand = useAsync(() => t ? moneyApi.brandBilling(t.brand_id) : Promise.resolve(null), [t?.brand_id])
  const pays = useAsync(() => moneyApi.invoicePayments(id), [id, t?.updated_at, t?.paid])
  const [modal, setModal] = useState<null | 'cancel' | 'send'>(null)
  const act = useAsyncAction()
  useEffect(() => { if (t) document.title = `${t.invoice_number ?? 'Draft invoice'} — ${t.brand_name}`; return () => { document.title = 'Social Mog OS' } }, [t])
  if (inv.loading && !inv.data) return <Loading label="Opening the invoice" />
  if (!t || !inv.data) return <NotFound what="invoice" />
  const reload = () => { inv.reload(); pays.reload() }
  const menu = [
    ...(t.document_status !== 'cancelled' ? [{ label: t.document_status === 'draft' ? 'Edit draft' : 'Edit (needs a reason)', onSelect: () => nav(`/money/invoices/${id}/edit`) }] : []),
    { label: 'Download PDF', onSelect: () => window.print() },
    ...(t.document_status === 'sent' ? [{ label: 'Cancel invoice…', onSelect: () => setModal('cancel'), danger: true }] : []),
    ...(t.document_status === 'draft' ? [{ label: 'Delete draft', onSelect: () => act.run(async () => { await moneyApi.archiveDraft(id); nav('/money/invoices') }), danger: true }] : []),
  ]
  return (
    <div className="space-y-6">
      <MoneyHeader title={t.invoice_number ?? 'Draft invoice'} kanji="請" sub={<>{t.brand_name}{t.campaign_name && <> · <Link className="underline underline-offset-4" to={`/campaigns/${t.campaign_id}`}>{t.campaign_name}</Link></>}</>}
        actions={<>
          {statusPill(t.payment_status)}
          {t.document_status === 'draft' && <button className="btn-primary" onClick={() => setModal('send')}>Mark as sent</button>}
          {t.document_status === 'sent' && t.outstanding > 0 && <button className="btn-primary" onClick={() => nav(`/money/payments?record=1&brand=${t.brand_id}&invoice=${id}`)}>Record payment</button>}
          <button className="btn-ghost" onClick={() => window.print()}><Icon name="download" /> PDF</button>
          <MoreMenu items={menu} />
        </>} />
      <div className="no-print"><MoneyTabs /></div>
      {act.error && <FormError>{act.error}</FormError>}
      {t.document_status === 'cancelled' && <p className="no-print shoji p-4 text-sm text-ink">Cancelled{t.cancel_reason ? `: “${t.cancel_reason}”` : ''}. The number stays used so the series has no gaps.</p>}
      <div className="grid xl:grid-cols-[1fr_22rem] gap-6 items-start">
        {org.data && <InvoicePaper d={inv.data} org={org.data} brand={brand.data} />}
        <div className="no-print space-y-4">
          <Card className="shoji-pad">
            <SectionTitle kanji="計">Money</SectionTitle>
            <Facts rows={[
              ['Total', money(t.total)], ['Paid (incl. client TDS)', money(t.paid)], ['Still owed', <span className="num font-medium">{formatINR(t.outstanding)}</span>],
              ['TDS expected', t.tds_rate ? <>{formatINR(t.tds_expected)} <span className="text-muted">({t.tds_rate}%)</span></> : null],
              ['Due', t.due_date ? <>{formatDate(t.due_date)}{t.days_overdue > 0 && <span className="text-muted"> · {t.days_overdue} days late</span>}</> : null],
              ['GST', t.gst_enabled ? (t.is_interstate ? `IGST ${t.gst_rate}%` : `CGST + SGST ${t.gst_rate}%`) : 'Not charged'],
            ]} />
          </Card>
          <Card className="shoji-pad">
            <SectionTitle kanji="入">Payments</SectionTitle>
            {!(pays.data ?? []).length ? <p className="text-sm text-muted">Nothing received yet.</p> : (
              <ul className="divide-y divide-line/15 text-sm">
                {(pays.data ?? []).map(p => (
                  <li key={p.receipt_id}><Link to={`/money/payments/${p.receipt_id}`} className="flex justify-between gap-3 py-2 hover:text-ink">
                    <span>{formatDate(p.received_on)}<span className="block text-xs text-muted">{p.reference ?? p.mode?.toUpperCase() ?? ''}{p.account_name ? ` · ${p.account_name}` : ''}</span></span>
                    <span className="num text-ink">{formatINR(p.amount)}</span></Link></li>
                ))}
              </ul>
            )}
          </Card>
          <MoneyHistory table="invoices" id={id} version={t.updated_at} />
        </div>
      </div>
      {modal === 'cancel' && <ReasonModal title={`Cancel ${t.invoice_number}`} action="Cancel invoice" danger note="The invoice stays on record with its number, marked Cancelled. It no longer counts as revenue or money owed."
        onClose={() => setModal(null)} onConfirm={async r => { await moneyApi.cancelInvoice(id, r); reload() }} />}
      {modal === 'send' && <SendModal t={t} onClose={() => setModal(null)} onSent={reload} />}
    </div>
  )
}

function SendModal({ t, onClose, onSent }: { t: InvoiceTotals; onClose: () => void; onSent: () => void }) {
  const [date, setDate] = useState(t.issue_date ?? istToday())
  const act = useAsyncAction()
  return (
    <Modal title="Mark as sent" onClose={onClose}>
      <form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (await act.run(() => moneyApi.sendInvoice(t.invoice_id, date))) { onSent(); onClose() } }}>
        <p className="text-sm text-muted">This gives the invoice its number for the financial year of the invoice date, and it starts counting as revenue and money owed. After this, changes need a reason.</p>
        <label className="block"><span className="text-sm text-ink">Invoice date</span><input type="date" required className="field mt-1.5" value={date} onChange={e => setDate(e.target.value)} /></label>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Not yet</button><button className="btn-primary" disabled={act.busy}>Give it a number</button></div>
      </form>
    </Modal>
  )
}

// ─── The paper (what the brand receives) ────────────────────
function Enso() {
  return <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden><path d="M50 14c-8-7-22-8-31 0-10 8-11 24-3 33 8 10 24 11 33 3 6-5 8-12 7-19" fill="none" stroke="#1E1C1A" strokeWidth="5" strokeLinecap="round" /></svg>
}
export function InvoicePaper({ d, org, brand }: { d: InvoiceDetail; org: OrgSettings; brand: BrandBilling | null }) {
  const t = d.totals
  const [qr, setQr] = useState<string | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const due = Math.max(round2(t.net_expected - t.paid), 0)
  useEffect(() => { moneyApi.logoUrl(org.logo_path).then(setLogo) }, [org.logo_path])
  useEffect(() => {
    if (!org.upi_id || t.document_status !== 'sent' || due <= 0) { setQr(null); return }
    QRCode.toDataURL(upiLink(org.upi_id, org.legal_name || org.company_name, due, t.invoice_number ?? ''), { margin: 1, width: 240, color: { dark: '#1E1C1A', light: '#F7F1E6' } }).then(setQr).catch(() => setQr(null))
  }, [org.upi_id, org.legal_name, org.company_name, due, t.invoice_number, t.document_status])
  const ink = 'text-[#1E1C1A]', soft = 'text-[#5c5752]'
  const half = round2(t.gst_rate / 2)
  return (
    <article className={`report-paper print-color relative bg-[#F7F1E6] ${ink} rounded-shoji shadow-2xl shadow-black/30 p-6 sm:p-10 max-w-[52rem] w-full overflow-hidden`} aria-label="Invoice">
      {t.document_status === 'draft' && <p aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center font-mincho text-[7rem] text-[#B7282E]/10 -rotate-12 select-none">DRAFT</p>}
      {t.payment_status === 'paid' && <div className="absolute right-8 top-28 sm:right-14"><Hanko kind="paid" size={84} /></div>}
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#1E1C1A]/20 pb-6">
        <div className="flex items-start gap-3">
          {logo ? <img src={logo} alt={`${org.company_name} logo`} className="h-12 w-auto" /> : <Enso />}
          <div>
            <p className="font-mincho text-2xl leading-tight">{org.legal_name || org.company_name}</p>
            {org.address && <p className={`text-xs ${soft} whitespace-pre-line mt-1 max-w-xs`}>{org.address}</p>}
            <p className={`text-xs ${soft} mt-1`}>{[org.gstin && `GSTIN ${org.gstin}`, org.pan && `PAN ${org.pan}`, org.state && `${org.state}${org.state_code ? ` (${org.state_code})` : ''}`].filter(Boolean).join(' · ')}</p>
            {(org.email || org.phone) && <p className={`text-xs ${soft}`}>{[org.email, org.phone].filter(Boolean).join(' · ')}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="font-mincho text-xl tracking-wide">{t.gst_enabled && org.gstin ? 'TAX INVOICE' : 'INVOICE'}</p>
          <dl className="text-sm mt-2 space-y-0.5 tabular-nums">
            <div><dt className={`inline ${soft}`}>No. </dt><dd className="inline font-medium">{t.invoice_number ?? 'Draft'}</dd></div>
            <div><dt className={`inline ${soft}`}>Date </dt><dd className="inline">{formatDate(t.issue_date)}</dd></div>
            <div><dt className={`inline ${soft}`}>Due </dt><dd className="inline">{formatDate(t.due_date)}</dd></div>
            {t.service_period_start && <div><dt className={`inline ${soft}`}>Period </dt><dd className="inline">{formatDate(t.service_period_start)}{t.service_period_end ? ` – ${formatDate(t.service_period_end)}` : ''}</dd></div>}
          </dl>
        </div>
      </header>
      <section className="grid sm:grid-cols-2 gap-6 py-6">
        <div>
          <p className={`text-[11px] uppercase tracking-[0.18em] ${soft}`}>Bill to</p>
          <p className="font-medium mt-1">{brand?.billing_name || brand?.name || t.brand_name}</p>
          {brand?.billing_address && <p className={`text-sm ${soft} whitespace-pre-line`}>{brand.billing_address}</p>}
          <p className={`text-sm ${soft}`}>{[brand?.city, brand?.state].filter(Boolean).join(', ')}</p>
          {brand?.gstin && <p className="text-sm">GSTIN {brand.gstin}</p>}
          {brand?.billing_contact && <p className={`text-sm ${soft}`}>Attn: {brand.billing_contact}{brand.billing_email ? ` · ${brand.billing_email}` : ''}</p>}
        </div>
        <div className="sm:text-right text-sm">
          {t.gst_enabled && <p><span className={soft}>Place of supply </span>{t.place_of_supply_code ? `${GST_STATES[t.place_of_supply_code] ?? ''} (${t.place_of_supply_code})` : '—'}</p>}
          {t.campaign_name && <p><span className={soft}>For </span>{t.campaign_name}</p>}
          {t.notes && <p className={`${soft} whitespace-pre-line mt-1`}>{t.notes}</p>}
        </div>
      </section>
      <table className="w-full text-sm tabular-nums">
        <thead><tr className={`text-left text-xs ${soft} border-b border-[#1E1C1A]/30`}><th className="py-2 pr-2 font-normal w-8">#</th><th className="py-2 pr-2 font-normal">Description</th><th className="py-2 pr-2 font-normal hidden sm:table-cell">SAC</th><th className="py-2 pr-2 font-normal text-right">Qty</th><th className="py-2 pr-2 font-normal text-right">Rate</th><th className="py-2 font-normal text-right">Amount</th></tr></thead>
        <tbody>
          {d.items.map((i, n) => (
            <tr key={i.id} className="border-b border-[#1E1C1A]/10 align-top">
              <td className="py-2.5 pr-2">{n + 1}</td><td className="py-2.5 pr-2">{i.description}</td><td className="py-2.5 pr-2 hidden sm:table-cell">{i.hsn_sac}</td>
              <td className="py-2.5 pr-2 text-right">{Number(i.quantity)}</td><td className="py-2.5 pr-2 text-right">{formatINR(i.rate)}</td><td className="py-2.5 text-right">{formatINR(i.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="grid sm:grid-cols-[1fr_17rem] gap-6 mt-5">
        <p className={`text-sm ${soft} italic self-end`}>{amountInWords(t.total)}</p>
        <dl className="text-sm space-y-1.5 tabular-nums">
          <div className="flex justify-between"><dt className={soft}>Subtotal</dt><dd>{formatINR(t.subtotal)}</dd></div>
          {t.gst_enabled && (t.is_interstate ? <div className="flex justify-between"><dt className={soft}>IGST @ {t.gst_rate}%</dt><dd>{formatINR(t.igst)}</dd></div> : <>
            <div className="flex justify-between"><dt className={soft}>CGST @ {half}%</dt><dd>{formatINR(t.cgst)}</dd></div>
            <div className="flex justify-between"><dt className={soft}>SGST @ {half}%</dt><dd>{formatINR(t.sgst)}</dd></div></>)}
          <div className="flex justify-between border-t border-[#1E1C1A]/30 pt-1.5 font-medium text-base"><dt>Total</dt><dd>{formatINR(t.total)}</dd></div>
          {t.tds_rate > 0 && <>
            <div className="flex justify-between"><dt className={soft}>Less TDS @ {t.tds_rate}%</dt><dd>−{formatINR(t.tds_expected)}</dd></div>
            <div className="flex justify-between font-medium"><dt>Net payable</dt><dd>{formatINR(t.net_expected)}</dd></div></>}
          {t.paid > 0 && <div className="flex justify-between"><dt className={soft}>Received</dt><dd>−{formatINR(t.paid)}</dd></div>}
        </dl>
      </section>
      <footer className="grid sm:grid-cols-[1fr_auto] gap-6 mt-8 pt-6 border-t border-[#1E1C1A]/20 break-inside-avoid">
        <div className="text-sm">
          <p className={`text-[11px] uppercase tracking-[0.18em] ${soft}`}>Pay by bank transfer</p>
          <dl className="mt-1.5 grid grid-cols-[7.5rem_1fr] gap-y-0.5">
            {([['Account name', org.bank_account_name], ['Bank', org.bank_name], ['Account no.', org.bank_account_number], ['IFSC', org.bank_ifsc], ['Branch', org.bank_branch], ['UPI', org.upi_id]] as [string, string | null][])
              .filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt className={soft}>{k}</dt><dd className="tabular-nums">{v}</dd></Fragment>)}
          </dl>
          {org.invoice_terms && <p className={`text-xs ${soft} mt-4 max-w-md`}>{org.invoice_terms}</p>}
          {t.gst_enabled && !org.gstin && <p className={`text-xs ${soft} mt-2`}>GSTIN not added yet.</p>}
        </div>
        {qr && <figure className="text-center"><img src={qr} alt={`UPI QR code to pay ${formatINR(due)}`} className="w-32 h-32 mx-auto" /><figcaption className={`text-xs ${soft} mt-1`}>Scan to pay {formatINR(due)} by UPI</figcaption></figure>}
      </footer>
      <p className={`text-[10px] ${soft} mt-6 text-center`}>This is a computer-generated invoice.</p>
    </article>
  )
}
