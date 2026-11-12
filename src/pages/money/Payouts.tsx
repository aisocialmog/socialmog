// Creator & freelancer payouts: Pending → Approved → Paid. Paying one makes
// its matching expense in the database. "Payouts due" groups what's owed by
// person, with UPI IDs for founders.
import { useEffect, useMemo, useState } from 'react'
import { useReauth } from '../../lib/reauth'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { moneyApi, type PayoutInput, type PayoutRow } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { payoutAmounts, PAYOUT_STATUS_LABEL, PAYOUT_STATUS_TONE, PAYOUT_STATUSES, round2, type PayoutStatus } from '../../lib/money'
import { Icon } from '../../components/ui/Icon'
import { Card, EmptyState, MoreMenu, Pill } from '../../components/ui/kit'
import { Modal } from '../../components/ui/Modal'
import { Andon, Hanko } from '../../components/art/Ink'
import { FormError } from '../auth/AuthLayout'
import { DataTable, Facts, Loading, MoneyHeader, MoneyHistory, MoneyTabs, NotFound, ReasonModal, Select, dateCell, money, useAsyncAction, useIsFounder } from './MoneyBits'

const pill = (p: PayoutRow) => <><Pill tone={PAYOUT_STATUS_TONE[p.status]}>{PAYOUT_STATUS_LABEL[p.status]}</Pill>{p.is_overdue && <span className="ml-1.5 inline-flex align-middle"><Andon size={13} lit /></span>}</>

function PayoutSubtabs({ due }: { due: boolean }) {
  return (
    <div role="tablist" aria-label="View" className="inline-flex rounded-shoji border border-line/30 p-0.5 bg-card">
      <Link role="tab" aria-selected={!due} to="/money/payouts" className={`px-3.5 h-9 inline-flex items-center rounded-[5px] text-sm ${!due ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>All payouts</Link>
      <Link role="tab" aria-selected={due} to="/money/payouts/due" className={`px-3.5 h-9 inline-flex items-center rounded-[5px] text-sm ${due ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>Payouts due</Link>
    </div>
  )
}

export function PayoutsPage() {
  const { data, error, reload } = useAsync(() => moneyApi.payouts(), [])
  const [status, setStatus] = useState<'all' | 'open' | PayoutStatus>('all')
  const [kind, setKind] = useState<'all' | 'creator' | 'freelancer'>('all')
  const [adding, setAdding] = useState(false)
  const nav = useNavigate()
  const rows = (data ?? []).filter(p => status === 'all' || (status === 'open' ? p.status === 'pending' || p.status === 'approved' : p.status === status)).filter(p => kind === 'all' || p.payee_kind === kind)
  return (
    <div className="space-y-6">
      <MoneyHeader title="Payouts" kanji="払" sub={`${rows.length} payouts`} actions={<button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> New payout</button>} />
      <MoneyTabs />
      <PayoutSubtabs due={false} />
      {error && <FormError>{error}</FormError>}
      {!data ? <Loading label="Loading payouts" /> : (
        <DataTable rows={rows} rowKey={p => p.id} rowLink={p => `/money/payouts/${p.id}`} csvName="payouts" empty="No payouts yet."
          search={p => `${p.payee_name} ${p.description ?? ''} ${p.campaign_name ?? ''} ${p.deliverable_title ?? ''} ${p.brand_name ?? ''} ${p.reference ?? ''}`}
          searchPlaceholder="Search person, campaign, item, UTR" dateOf={p => p.paid_on ?? p.due_date ?? p.created_at.slice(0, 10)} defaultSort={{ key: 'due', dir: 1 }}
          filters={<>
            <Select id="po-status" label="Status" value={status} onChange={setStatus} options={[['all', 'Any status'], ['open', 'Not paid yet'], ...PAYOUT_STATUSES.map(s => [s, PAYOUT_STATUS_LABEL[s]] as [PayoutStatus, string])]} />
            <Select id="po-kind" label="Who" value={kind} onChange={setKind} options={[['all', 'Creators & freelancers'], ['creator', 'Creators'], ['freelancer', 'Freelancers']]} />
          </>}
          cols={[
            { key: 'who', header: 'Payee', cell: p => <><span className="text-ink">{p.payee_name}</span><span className="block text-xs text-muted">{[p.description, p.deliverable_title ?? p.campaign_name].filter(Boolean).join(' · ')}</span></>, sort: p => p.payee_name, csv: p => p.payee_name },
            { key: 'status', header: 'Status', cell: pill, sort: p => PAYOUT_STATUSES.indexOf(p.status), csv: p => PAYOUT_STATUS_LABEL[p.status] },
            { key: 'due', header: 'Due / paid', cell: p => dateCell(p.paid_on ?? p.due_date), sort: p => p.paid_on ?? p.due_date, csv: p => formatDate(p.paid_on ?? p.due_date) },
            { key: 'gross', header: 'Agreed', align: 'right', hideSm: true, cell: p => formatINR(p.gross), sort: p => p.gross, csv: p => p.gross },
            { key: 'tds', header: 'TDS', align: 'right', hideSm: true, cell: p => p.tds ? `${formatINR(p.tds)} (${p.tds_rate}%)` : '—', sort: p => p.tds, csv: p => p.tds },
            { key: 'net', header: 'Net payable', align: 'right', cell: p => formatINR(p.net_payable), sort: p => p.net_payable, csv: p => p.net_payable },
          ]}
          extraCsv={[{ header: 'Kind', value: p => p.payee_kind }, { header: 'Campaign', value: p => p.campaign_name }, { header: 'Production item', value: p => p.deliverable_title },
            { header: 'Brand', value: p => p.brand_name }, { header: 'Account', value: p => p.account_name }, { header: 'UTR / reference', value: p => p.reference }]}
          footer={shown => <span className="text-muted">Agreed {formatINR(round2(shown.reduce((s, p) => s + p.gross, 0)))} · still to pay <span className="text-ink num">{formatINR(round2(shown.filter(p => p.status === 'pending' || p.status === 'approved').reduce((s, p) => s + p.net_payable, 0)))}</span></span>} />
      )}
      {adding && <PayoutForm onClose={() => setAdding(false)} onSaved={id => { setAdding(false); reload(); nav(`/money/payouts/${id}`) }} />}
    </div>
  )
}

export function PayoutsDue() {
  const founder = useIsFounder()
  const { data, reload } = useAsync(() => moneyApi.payouts(), [])
  const reauth = useReauth()
  const upi = useAsync(async () => founder && await reauth('Creator UPI details are protected.') ? moneyApi.payeeUpi() : ({} as Record<string, string>), [founder])
  const [paying, setPaying] = useState<PayoutRow | null>(null)
  const groups = useMemo(() => {
    const m = new Map<string, PayoutRow[]>()
    for (const p of (data ?? []).filter(p => p.status === 'pending' || p.status === 'approved')) { const k = p.creator_id ?? p.vendor_id!; m.set(k, [...(m.get(k) ?? []), p]) }
    return [...m.entries()].map(([id, list]) => ({ id, name: list[0].payee_name, kind: list[0].payee_kind, list: list.sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9')), total: round2(list.reduce((s, p) => s + p.net_payable, 0)) }))
      .sort((a, b) => (a.list[0].due_date ?? '9').localeCompare(b.list[0].due_date ?? '9'))
  }, [data])
  const total = round2(groups.reduce((s, g) => s + g.total, 0))
  return (
    <div className="space-y-6">
      <MoneyHeader title="Payouts due" kanji="払" sub={`${formatINR(total)} to ${groups.length} ${groups.length === 1 ? 'person' : 'people'}, net of TDS`} />
      <MoneyTabs />
      <PayoutSubtabs due />
      {!data ? <Loading label="Loading payouts" /> : !groups.length ? <div className="shoji"><EmptyState line="Everyone is paid. A quiet pond." /></div> : (
        <div className="grid lg:grid-cols-2 gap-4">
          {groups.map(g => (
            <Card key={g.id} className="shoji-pad">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0"><p className="font-mincho text-lg text-ink">{g.name}</p>
                  <p className="text-xs text-muted">{g.kind === 'creator' ? 'Creator' : 'Freelancer'}{founder ? <> · UPI <span className="text-ink num select-all">{upi.data?.[g.id] ?? 'not on file'}</span></> : ' · UPI visible to founders'}</p></div>
                <p className="text-right"><span className="font-mincho text-xl text-ink num">{formatINR(g.total)}</span><span className="block text-xs text-muted">net payable</span></p>
              </div>
              <ul className="divide-y divide-line/15">
                {g.list.map(p => (
                  <li key={p.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/money/payouts/${p.id}`} className="min-w-0 hover:underline underline-offset-4">
                      <span className="text-sm text-ink">{p.description ?? p.deliverable_title ?? p.campaign_name ?? 'Payout'}</span>
                      <span className="block text-xs text-muted">{p.due_date ? `Due ${formatDate(p.due_date)}` : 'No due date'}{p.is_overdue ? ' · late' : ''} · {formatINR(p.gross)}{p.tds ? ` − TDS ${formatINR(p.tds)}` : ''}</span>
                    </Link>
                    <span className="flex items-center gap-2">{pill(p)}
                      {p.status === 'pending' ? <button className="btn-ghost h-9 text-sm" onClick={async () => { await moneyApi.approvePayout(p.id); reload() }}>Approve</button>
                        : <button className="btn-primary h-9 text-sm" onClick={() => setPaying(p)}>Pay {formatINR(p.net_payable)}</button>}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {paying && <PayModal p={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); reload() }} />}
    </div>
  )
}

function PayModal({ p, onClose, onPaid }: { p: PayoutRow; onClose: () => void; onPaid: () => void }) {
  const accounts = useAsync(() => moneyApi.accountRecords(), [])
  const [x, setX] = useState({ paid_on: istToday(), account_id: '', reference: '' })
  const act = useAsyncAction()
  useEffect(() => { if (!x.account_id && accounts.data?.length) setX(v => ({ ...v, account_id: (accounts.data!.find(a => a.is_default) ?? accounts.data![0]).id })) }, [accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={`Pay ${p.payee_name}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (await act.run(() => moneyApi.payPayout(p.id, { ...x, reference: x.reference || null }))) onPaid() }}>
        <p className="text-sm text-ink">Transfer <span className="num font-medium">{formatINR(p.net_payable)}</span>{p.tds ? <> (agreed {formatINR(p.gross)} − TDS {formatINR(p.tds)})</> : ''}. Marking it paid also records the expense.</p>
        <label className="block"><span className="text-sm text-ink">Paid from</span><select className="field mt-1.5" required value={x.account_id} onChange={e => setX({ ...x, account_id: e.target.value })}>{(accounts.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="block"><span className="text-sm text-ink">Paid on</span><input type="date" required className="field mt-1.5" value={x.paid_on} onChange={e => setX({ ...x, paid_on: e.target.value })} /></label>
        <label className="block"><span className="text-sm text-ink">UTR / reference</span><input className="field mt-1.5" value={x.reference} onChange={e => setX({ ...x, reference: e.target.value })} placeholder="From the bank or UPI app" /></label>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>Mark paid</button></div>
      </form>
    </Modal>
  )
}

export function PayoutForm({ row, onClose, onSaved }: { row?: PayoutRow; onClose: () => void; onSaved: (id: string) => void }) {
  const payees = useAsync(() => moneyApi.payeeOptions(), [])
  const ccs = useAsync(() => moneyApi.campaignCreatorOptions(), [])
  const items = useAsync(() => moneyApi.deliverableOptions(), [])
  const org = useAsync(() => moneyApi.settings(), [])
  const [p, setP] = useState<PayoutInput>(() => row ? { creator_id: row.creator_id, vendor_id: row.vendor_id, campaign_creator_id: row.campaign_creator_id, deliverable_id: row.deliverable_id, campaign_id: row.campaign_id, brand_id: row.brand_id,
    description: row.description, amount: row.gross, tds_rate: row.tds_rate, gst_rate: row.gst_rate, due_date: row.due_date, creator_invoice_no: row.creator_invoice_no, notes: row.notes }
    : { creator_id: null, vendor_id: null, campaign_creator_id: null, deliverable_id: null, campaign_id: null, brand_id: null, description: null, amount: 0, tds_rate: 10, gst_rate: 0, due_date: null, creator_invoice_no: null, notes: null })
  const [reason, setReason] = useState('')
  const act = useAsyncAction()
  useEffect(() => { if (!row && org.data) setP(x => ({ ...x, tds_rate: Number(org.data!.default_creator_tds_rate) })) }, [org.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const payeeKey = p.creator_id ? `creator:${p.creator_id}` : p.vendor_id ? `vendor:${p.vendor_id}` : ''
  const a = payoutAmounts(Number(p.amount) || 0, Number(p.tds_rate) || 0, Number(p.gst_rate) || 0)
  const set = (x: Partial<PayoutInput>) => setP({ ...p, ...x })
  const myCCs = (ccs.data ?? []).filter(c => c.creator_id === p.creator_id)
  return (
    <Modal title={row ? 'Edit payout' : 'New payout'} onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); let id = row?.id ?? ''; if (await act.run(async () => { id = await moneyApi.savePayout({ ...p, amount: Number(p.amount), tds_rate: Number(p.tds_rate) || 0, gst_rate: Number(p.gst_rate) || 0 }, row?.id, row ? reason : undefined) })) onSaved(id) }}>
        <label className="block"><span className="text-sm text-ink">Pay who</span>
          <select className="field mt-1.5" required value={payeeKey} onChange={e => { const [k, id] = e.target.value.split(':'); set(k === 'creator' ? { creator_id: id, vendor_id: null, campaign_creator_id: null } : { vendor_id: id || null, creator_id: null, campaign_creator_id: null }) }}>
            <option value="">Choose a creator or freelancer</option>
            <optgroup label="Creators">{(payees.data ?? []).filter(x => x.kind === 'creator').map(x => <option key={x.id} value={`creator:${x.id}`}>{x.name}</option>)}</optgroup>
            <optgroup label="Freelancers & vendors">{(payees.data ?? []).filter(x => x.kind === 'vendor').map(x => <option key={x.id} value={`vendor:${x.id}`}>{x.name} — {x.hint.replace('Freelancer · ', '')}</option>)}</optgroup>
          </select></label>
        {p.creator_id && <label className="block"><span className="text-sm text-ink">For which campaign</span>
          <select className="field mt-1.5" value={p.campaign_creator_id ?? ''} onChange={e => { const c = myCCs.find(x => x.id === e.target.value); set({ campaign_creator_id: e.target.value || null, campaign_id: c?.campaign_id ?? null, amount: c?.agreed_fee && !p.amount ? c.agreed_fee : p.amount }) }}>
            <option value="">Not linked to a campaign</option>{myCCs.map(c => <option key={c.id} value={c.id}>{c.campaign_name}{c.agreed_fee ? ` — fee ${formatINR(c.agreed_fee)}` : ''}</option>)}
          </select></label>}
        <label className="block"><span className="text-sm text-ink">Production item <span className="text-muted">(optional)</span></span>
          <select className="field mt-1.5" value={p.deliverable_id ?? ''} onChange={e => set({ deliverable_id: e.target.value || null })}><option value="">None</option>{(items.data ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="block"><span className="text-sm text-ink">What it’s for</span><input className="field mt-1.5" value={p.description ?? ''} onChange={e => set({ description: e.target.value || null })} placeholder="e.g. 2 reels + 1 story" /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block col-span-3 sm:col-span-1"><span className="text-sm text-ink">Amount agreed (₹)</span><input type="number" min="0" step="0.01" required className="field mt-1.5 num" value={p.amount || ''} onChange={e => set({ amount: e.target.value as unknown as number })} /></label>
          <label className="block"><span className="text-sm text-ink">TDS %</span><input type="number" min="0" max="30" step="0.01" className="field mt-1.5 num" value={p.tds_rate} onChange={e => set({ tds_rate: e.target.value as unknown as number })} /></label>
          <label className="block"><span className="text-sm text-ink">GST % <span className="text-muted">(if they charge)</span></span><input type="number" min="0" max="28" step="0.01" className="field mt-1.5 num" value={p.gst_rate} onChange={e => set({ gst_rate: e.target.value as unknown as number })} /></label>
        </div>
        <p className="text-sm text-muted num">Net payable: <span className="text-ink">{formatINR(a.net)}</span>{a.tds ? ` (TDS ${formatINR(a.tds)} to deposit)` : ''}{a.gst ? ` incl. GST ${formatINR(a.gst)}` : ''}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-sm text-ink">Due date</span><input type="date" className="field mt-1.5" value={p.due_date ?? ''} onChange={e => set({ due_date: e.target.value || null })} /></label>
          <label className="block"><span className="text-sm text-ink">Their invoice no.</span><input className="field mt-1.5" value={p.creator_invoice_no ?? ''} onChange={e => set({ creator_invoice_no: e.target.value || null })} /></label>
        </div>
        {row && <label className="block"><span className="text-sm text-ink">Reason for the change</span><input className="field mt-1.5" required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></label>}
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>{row ? 'Save changes' : 'Add payout'}</button></div>
      </form>
    </Modal>
  )
}

export function PayoutDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { data: p, loading, reload } = useAsync(() => moneyApi.payout(id), [id])
  const [modal, setModal] = useState<null | 'edit' | 'pay' | 'cancel' | 'unpay' | 'archive'>(null)
  if (loading && !p) return <Loading label="Opening the payout" />
  if (!p) return <NotFound what="payout" />
  const open = p.status === 'pending' || p.status === 'approved'
  return (
    <div className="space-y-6">
      <MoneyHeader title={`${p.payee_name} — ${formatINR(p.net_payable)}`} kanji="払" sub={[p.description, p.deliverable_title ?? p.campaign_name].filter(Boolean).join(' · ') || 'Payout'}
        actions={<>
          {pill(p)}
          {p.status === 'pending' && <button className="btn-ghost" onClick={async () => { await moneyApi.approvePayout(id); reload() }}>Approve</button>}
          {open && <button className="btn-primary" onClick={() => setModal('pay')}>Mark paid</button>}
          <button className="btn-ghost" onClick={() => setModal('edit')}><Icon name="edit" /> Edit</button>
          <MoreMenu items={[...(p.status === 'paid' ? [{ label: 'Undo payment…', onSelect: () => setModal('unpay') }] : []),
            ...(p.status !== 'cancelled' ? [{ label: 'Cancel payout…', onSelect: () => setModal('cancel'), danger: true }] : []), { label: 'Archive…', onSelect: () => setModal('archive'), danger: true }]} />
        </>} />
      <MoneyTabs />
      <div className="grid lg:grid-cols-[1fr_24rem] gap-6 items-start">
        <Card className="shoji-pad relative">
          {p.status === 'approved' && <div className="absolute right-6 top-6"><Hanko kind="approved" size={56} /></div>}
          {p.status === 'paid' && <div className="absolute right-6 top-6"><Hanko kind="completed" size={56} /></div>}
          <Facts rows={[
            ['Payee', p.creator_id ? <Link className="underline underline-offset-4" to={`/creators/${p.creator_id}`}>{p.payee_name}</Link> : `${p.payee_name} (freelancer)`],
            ['Amount agreed', money(p.gross)], ['TDS to deduct', p.tds ? <>{formatINR(p.tds)} <span className="text-muted">({p.tds_rate}%)</span></> : 'None'], ['GST they charge', p.gst ? money(p.gst) : null],
            ['Net payable', <span className="num font-medium">{formatINR(p.net_payable)}</span>], ['Due', p.due_date ? <>{formatDate(p.due_date)}{p.is_overdue && ' · late'}</> : null],
            ['Approved', p.approved_at ? `${formatDate(p.approved_at)}${p.approved_by_name ? ` by ${p.approved_by_name}` : ''}` : null],
            ['Paid', p.paid_on ? `${formatDate(p.paid_on)} from ${p.account_name}` : null], ['UTR / reference', p.reference], ['Their invoice no.', p.creator_invoice_no],
            ['Campaign', p.campaign_id ? <Link className="underline underline-offset-4" to={`/campaigns/${p.campaign_id}`}>{p.campaign_name}</Link> : null],
            ['Production item', p.deliverable_id ? <Link className="underline underline-offset-4" to={`/production/${p.deliverable_id}`}>{p.deliverable_title}</Link> : null],
            ['Brand', p.brand_name], ['Expense', p.expense_id ? <Link className="underline underline-offset-4" to={`/money/expenses/${p.expense_id}`}>Created on payment</Link> : null],
          ]} />
        </Card>
        <MoneyHistory table="creator_payouts" id={id} version={p.updated_at} />
      </div>
      {modal === 'edit' && <PayoutForm row={p} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} />}
      {modal === 'pay' && <PayModal p={p} onClose={() => setModal(null)} onPaid={() => { setModal(null); reload() }} />}
      {modal === 'cancel' && <ReasonModal title="Cancel this payout" action="Cancel payout" danger note={p.status === 'paid' ? 'Its expense is archived too.' : undefined} onClose={() => setModal(null)} onConfirm={async r => { await moneyApi.setPayoutStatus(id, 'cancelled', r); reload() }} />}
      {modal === 'unpay' && <ReasonModal title="Undo this payment" action="Move back to Approved" note="The matching expense is archived; the payout goes back to Approved." onClose={() => setModal(null)} onConfirm={async r => { await moneyApi.setPayoutStatus(id, 'approved', r); reload() }} />}
      {modal === 'archive' && <ReasonModal title="Archive this payout" action="Archive" danger onClose={() => setModal(null)} onConfirm={async r => { await moneyApi.archivePayout(id, r); nav('/money/payouts') }} />}
    </div>
  )
}

