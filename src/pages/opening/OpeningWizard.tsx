// Opening balances & import (feature 7): the founders-only, one-time setup.
// Five steps and a finish screen; once locked the page is a read-only summary.
// Every total shown comes from openingApi.state() — the only sums done here
// are the live "as you type" previews inside the forms.
import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { openingApi, type OpeningState } from '../../data/opening'
import { moneyApi } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { formatDate, formatINR, istToday } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'
import { ACCOUNT_KIND_LABEL, ACCOUNT_KINDS, round2, type AccountKind } from '../../lib/money'
import { splitByShare } from '../../lib/opening'
import { Icon } from '../../components/ui/Icon'
import { Card, EmptyState, Pill, SectionTitle } from '../../components/ui/kit'
import { Modal } from '../../components/ui/Modal'
import { Andon, Hanko } from '../../components/art/Ink'
import { FormError } from '../auth/AuthLayout'
import { Loading, useAsyncAction, useIsFounder } from '../money/MoneyBits'
import { HistoryImport } from './HistoryImport'

type StepKey = '1' | '2' | '3' | '4' | '5' | 'finish'
const STEPS: { key: StepKey; badge: string; label: string }[] = [
  { key: '1', badge: '1', label: 'Go-live date' },
  { key: '2', badge: '2', label: 'Opening capital' },
  { key: '3', badge: '3', label: 'Account balances' },
  { key: '4', badge: '4', label: 'Open items' },
  { key: '5', badge: '5', label: 'History import' },
  { key: 'finish', badge: '✓', label: 'Finish' },
]

const toNum = (s: string | undefined) => round2(Number(s) || 0)
const toStr = (n: number) => (n ? String(n) : '')
function dayBefore(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

type StepProps = { state: OpeningState; reload: () => Promise<void> }

export function OpeningWizard() {
  const founder = useIsFounder()
  const { data: state, error, reload } = useAsync(() => (founder ? openingApi.state() : Promise.resolve(null)), [founder])
  const [params, setParams] = useSearchParams()

  if (!founder) return <Shell><div className="shoji"><EmptyState line="Opening balances and the import are for founders only." /></div></Shell>
  if (!state) return <Shell>{error ? <FormError>{error}</FormError> : <Loading label="Loading opening balances" />}</Shell>
  if (state.locked_at) return <Shell><LockedView state={state} reload={reload} /></Shell>

  const asked = params.get('step')
  const step: StepKey = state.go_live_date && STEPS.some(s => s.key === asked) ? (asked as StepKey) : '1'
  const go = (s: StepKey) => { setParams({ step: s }); window.scrollTo({ top: 0 }) }
  const at = STEPS.findIndex(s => s.key === step)
  const prev = STEPS[at - 1], next = STEPS[at + 1]

  return (
    <Shell sub="One-time setup. Do it once, check it balances, then lock it.">
      <nav aria-label="Setup steps" className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto border-b border-line/25">
        <ol className="flex gap-0.5 min-w-max">
          {STEPS.map(s => (
            <li key={s.key}>
              <button type="button" onClick={() => go(s.key)} disabled={!state.go_live_date && s.key !== '1'} aria-current={step === s.key ? 'step' : undefined}
                className={`relative px-3 h-12 inline-flex items-center gap-2 text-sm whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${step === s.key ? 'text-ink' : 'text-muted hover:text-ink'}`}>
                <span aria-hidden className={`num grid place-items-center w-6 h-6 rounded-full text-xs ${step === s.key ? 'bg-accent text-sumi' : 'border border-line/50'}`}>{s.badge}</span>
                {s.label}
                {step === s.key && <span className="absolute left-2.5 right-2.5 -bottom-px h-[2px] bg-accent rounded-full" />}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {!state.go_live_date && <p className="text-xs text-muted -mt-2">Set the go-live date first — the other steps open after that.</p>}

      {step === '1' && <StepGoLive state={state} reload={reload} />}
      {step === '2' && <StepCapital state={state} reload={reload} />}
      {step === '3' && <><StepAccounts state={state} reload={reload} /><CheckPanel state={state} reload={reload} /></>}
      {step === '4' && <><StepOpenItems state={state} reload={reload} /><CheckPanel state={state} reload={reload} /></>}
      {step === '5' && (
        <Card className="shoji-pad">
          <SectionTitle kanji="歴">History import (optional)</SectionTitle>
          <p className="text-sm text-muted mb-4 max-w-2xl">Bring in old brands and campaigns so the team can look them up. These are records only — nothing imported here touches revenue, profit, capital or any account balance. You can skip this step and come back later.</p>
          <HistoryImport goLive={state.go_live_date} />
        </Card>
      )}
      {step === 'finish' && <StepFinish state={state} reload={reload} />}

      <div className="flex flex-wrap justify-between gap-2">
        {prev ? <button type="button" className="btn-ghost" onClick={() => go(prev.key)}><Icon name="chevronLeft" /> Back</button> : <span />}
        {next && <button type="button" className="btn-ghost" disabled={!state.go_live_date} onClick={() => go(next.key)}>Next: {next.label} <Icon name="chevronRight" /></button>}
      </div>
    </Shell>
  )
}

function Shell({ sub, children }: { sub?: string; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">始</span>
          <Link to="/settings" className="hover:text-ink underline-offset-4 hover:underline">Settings</Link></p>
        <h1 className="font-mincho text-3xl text-ink">Opening balances &amp; import</h1>
        {sub && <p className="text-sm text-muted mt-1">{sub}</p>}
      </header>
      {children}
    </div>
  )
}

const Saved = ({ show }: { show: boolean }) => <span role="status" className="text-sm text-muted">{show ? 'Saved.' : ''}</span>

// ─── Step 1: go-live date ───────────────────────────────────
function StepGoLive({ state, reload }: StepProps) {
  const [date, setDate] = useState(state.go_live_date ?? '')
  const [saved, setSaved] = useState(false)
  const act = useAsyncAction()
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="始">Go-live date</SectionTitle>
      <form className="space-y-4 max-w-md" onSubmit={async e => {
        e.preventDefault(); setSaved(false)
        if (await act.run(async () => { await openingApi.setGoLive(date); await reload() })) setSaved(true)
      }}>
        <p className="text-sm text-muted">Everything before this date is history; everything from this date is tracked in detail.</p>
        <label className="block"><span className="text-sm text-ink">Go-live date</span>
          <input type="date" required className="field mt-1.5" value={date} onChange={e => { setDate(e.target.value); setSaved(false) }} /></label>
        {date && <p className="text-sm text-ink">Opening entries will be dated <span className="num font-medium">{formatDate(dayBefore(date))}</span> — the day before go-live.</p>}
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex items-center gap-3"><button className="btn-primary" disabled={act.busy}>{act.busy ? 'Saving…' : 'Save go-live date'}</button><Saved show={saved} /></div>
      </form>
    </Card>
  )
}

// ─── Step 2: opening capital ────────────────────────────────
function StepCapital({ state, reload }: StepProps) {
  const fs = state.founders
  const [total, setTotal] = useState(() => toStr(round2(fs.reduce((s, f) => s + f.accumulated_profit, 0))))
  const [shares, setShares] = useState<Record<string, string>>(() => Object.fromEntries(fs.map(f => [f.founder_id, toStr(f.accumulated_profit)])))
  const [own, setOwn] = useState<Record<string, string>>(() => Object.fromEntries(fs.map(f => [f.founder_id, toStr(f.own_money)])))
  const [edited, setEdited] = useState(false)
  const [saved, setSaved] = useState(false)
  const act = useAsyncAction()
  const split = (v: string) => {
    const by = splitByShare(toNum(v), fs)
    setShares(Object.fromEntries(fs.map(f => [f.founder_id, toStr(by[f.founder_id] ?? 0)])))
    setEdited(false)
  }
  // Live previews of what is being typed; the saved totals come back from the server.
  const sharesSum = round2(fs.reduce((s, f) => s + toNum(shares[f.founder_id]), 0))
  const ownSum = round2(fs.reduce((s, f) => s + toNum(own[f.founder_id]), 0))
  const gap = round2(sharesSum - toNum(total))
  const entryDate = state.go_live_date ? formatDate(dayBefore(state.go_live_date)) : ''
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="資">Opening capital</SectionTitle>
      <form className="space-y-5" onSubmit={async e => {
        e.preventDefault(); setSaved(false)
        const rows = fs.map(f => ({ founder_id: f.founder_id, accumulated_profit: toNum(shares[f.founder_id]), own_money: toNum(own[f.founder_id]) }))
        if (await act.run(async () => { await openingApi.saveCapital(rows); await reload() })) setSaved(true)
      }}>
        <div className="text-sm text-muted space-y-2 max-w-2xl">
          <p>Profit the business made before go-live becomes the founders’ <span className="text-ink">capital</span>, not revenue. It will not appear in any revenue or profit report — those start from the go-live date.</p>
          <p>Type the one total, check how it is shared, then add any money each founder personally put in.</p>
        </div>
        <label className="block max-w-sm"><span className="text-sm text-ink">Total accumulated profit till go-live (₹)</span>
          <input type="number" step="0.01" inputMode="decimal" className="field mt-1.5 num" placeholder="0" value={total}
            onChange={e => { setTotal(e.target.value); setSaved(false); if (!edited) split(e.target.value) }} /></label>

        <ul className="space-y-3">
          {fs.map(f => (
            <li key={f.founder_id} className="rounded-shoji border border-line/25 p-4">
              <p className="text-sm text-ink font-medium">{f.name} <span className="text-muted font-normal num">· {f.profit_share_pct}% profit share</span></p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:items-end">
                <label className="block"><span className="text-sm text-ink"><span className="sr-only">{f.name}: </span>Share of that profit (₹)</span>
                  <input type="number" step="0.01" inputMode="decimal" className="field mt-1.5 num" placeholder="0" value={shares[f.founder_id] ?? ''}
                    onChange={e => { setShares({ ...shares, [f.founder_id]: e.target.value }); setEdited(true); setSaved(false) }} /></label>
                <label className="block"><span className="text-sm text-ink"><span className="sr-only">{f.name}: </span>Own money put in (₹)</span>
                  <input type="number" min="0" step="0.01" inputMode="decimal" className="field mt-1.5 num" placeholder="0" value={own[f.founder_id] ?? ''}
                    onChange={e => { setOwn({ ...own, [f.founder_id]: e.target.value }); setSaved(false) }} /></label>
                <div className="sm:text-right"><p className="text-xs text-muted">Opening capital</p>
                  <p className="font-mincho text-xl text-ink num">{formatINR(round2(toNum(shares[f.founder_id]) + toNum(own[f.founder_id])))}</p></div>
              </div>
            </li>
          ))}
        </ul>

        {gap !== 0 && (
          <div role="status" className="rounded-shoji border border-akane/70 p-3 text-sm text-ink flex gap-2.5"><Andon size={18} lit />
            <div className="space-y-2">
              <p>The founders’ shares add up to <span className="num font-medium">{formatINR(sharesSum)}</span> — that is <span className="num font-medium">{formatINR(Math.abs(gap))}</span> {gap > 0 ? 'more' : 'less'} than the total you typed. The shares are what gets saved.</p>
              <button type="button" className="underline underline-offset-4" onClick={() => split(total)}>Split the total by profit share</button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line/25 pt-3">
          <p className="text-sm text-muted">Opening capital from this step <span className="text-xs">(profit shares {formatINR(sharesSum)} + own money {formatINR(ownSum)})</span></p>
          <p className="font-mincho text-2xl text-ink num">{formatINR(round2(sharesSum + ownSum))}</p>
        </div>
        <p className="text-xs text-muted">Saved as “Opening capital” entries dated {entryDate}, the day before go-live. Saving again replaces what was saved here before.</p>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex items-center gap-3"><button className="btn-primary" disabled={act.busy}>{act.busy ? 'Saving…' : 'Save opening capital'}</button><Saved show={saved} /></div>
      </form>
    </Card>
  )
}

// ─── Step 3: opening account balances ───────────────────────
function StepAccounts({ state, reload }: StepProps) {
  const goLive = state.go_live_date ?? ''
  const [vals, setVals] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('bank')
  const act = useAsyncAction()
  const add = useAsyncAction()
  const val = (id: string, server: number) => vals[id] ?? toStr(server)
  const addAccount = () => add.run(async () => {
    if (!name.trim()) throw new Error('Give the account a name.')
    await moneyApi.saveAccount({ name: name.trim(), kind, bank_name: null, last4: null, opening_balance: 0, opening_date: goLive, is_default: false, notes: null })
    await reload(); setName(''); setKind('bank'); setAdding(false)
  })
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="口">Opening account balances</SectionTitle>
      <p className="text-sm text-muted mb-4 max-w-2xl">For each account, type the actual balance on <span className="num text-ink">{formatDate(goLive)}</span> — what the bank statement, UPI app or cash box showed at the start of that day.</p>
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault(); setSaved(false)
        const rows = state.accounts.map(a => ({ account_id: a.account_id, balance: toNum(val(a.account_id, a.opening_balance)) }))
        if (await act.run(async () => { await openingApi.setBalances(rows); await reload() })) setSaved(true)
      }}>
        {state.accounts.length === 0 ? <p className="text-sm text-muted">No money accounts yet — add the first one below.</p> : (
          <ul className="divide-y divide-line/15 border-y border-line/20">
            {state.accounts.map(a => (
              <li key={a.account_id} className="py-3 grid grid-cols-1 sm:grid-cols-[1fr_14rem] gap-2 sm:items-center">
                <label htmlFor={`bal-${a.account_id}`} className="text-sm text-ink">{a.name}<span className="sr-only"> — actual balance on {formatDate(goLive)} (₹)</span>
                  <span aria-hidden className="text-muted"> · {ACCOUNT_KIND_LABEL[a.kind]}</span></label>
                <input id={`bal-${a.account_id}`} type="number" step="0.01" inputMode="decimal" className="field num sm:text-right" placeholder="0"
                  value={val(a.account_id, a.opening_balance)} onChange={e => { setVals({ ...vals, [a.account_id]: e.target.value }); setSaved(false) }} />
              </li>
            ))}
          </ul>
        )}
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={act.busy || state.accounts.length === 0}>{act.busy ? 'Saving…' : 'Save account balances'}</button>
          {!adding && <button type="button" className="btn-ghost" onClick={() => setAdding(true)}><Icon name="plus" /> Add an account</button>}
          <Saved show={saved} />
        </div>
      </form>
      {adding && (
        <div role="group" aria-label="Add an account" className="mt-4 rounded-shoji border border-line/25 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block"><span className="text-sm text-ink">New account name</span>
              <input className="field mt-1.5" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. HDFC current account"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAccount() } }} /></label>
            <label className="block"><span className="text-sm text-ink">New account type</span>
              <select className="field mt-1.5" value={kind} onChange={e => setKind(e.target.value as AccountKind)}>{ACCOUNT_KINDS.map(k => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}</select></label>
          </div>
          {add.error && <FormError>{add.error}</FormError>}
          <div className="flex gap-2"><button type="button" className="btn-primary" disabled={add.busy} onClick={addAccount}>Add account</button>
            <button type="button" className="btn-ghost" onClick={() => { setAdding(false); add.setError(null) }}>Cancel</button></div>
          <p className="text-xs text-muted">After adding, type its balance in the list above and save.</p>
        </div>
      )}
    </Card>
  )
}

// ─── The check ──────────────────────────────────────────────
function CheckPanel({ state, reload, readOnly = false }: StepProps & { readOnly?: boolean }) {
  const t = state.totals
  const rm = useAsyncAction()
  const tile = (label: string, v: number) => <div className="shoji p-3 min-w-0"><p className="text-xs text-muted">{label}</p><p className="font-mincho text-xl text-ink num mt-1 break-words">{formatINR(v)}</p></div>
  const op = (s: string, say: string) => <span className="font-mincho text-xl text-muted text-center" role="img" aria-label={say}>{s}</span>
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="衡">The check</SectionTitle>
      <p className="text-sm text-muted mb-4">What the business held on go-live day must equal the founders’ opening capital.</p>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-2 md:items-center">
        {tile('Account balances', t.accounts)}{op('+', 'plus')}
        {tile('Money still owed to us', t.receivables)}{op('−', 'minus')}
        {tile('Money we still owe', t.payables)}{op('=', 'should equal')}
        {tile('Opening capital', t.capital)}
      </div>
      <p className="text-xs text-muted mt-3">Accounts + owed to us − we owe = <span className="num text-ink">{formatINR(t.net_position)}</span> · Opening capital = <span className="num text-ink">{formatINR(t.capital)}</span> · Difference = <span className="num text-ink">{formatINR(t.difference)}</span></p>

      {t.is_balanced ? (
        <p role="status" className="mt-4 flex items-center gap-3 text-sm text-ink"><Hanko kind="completed" size={34} animate={false} /> It balances: accounts and dues match the opening capital exactly.</p>
      ) : (
        <div role="status" className="mt-4 rounded-shoji border border-akane/70 p-3 text-sm text-ink flex gap-2.5"><Andon size={18} lit />
          <div>
            <p className="font-medium">{t.difference > 0
              ? <>Accounts and dues are <span className="num">{formatINR(Math.abs(t.difference))}</span> more than the opening capital.</>
              : <>The opening capital is <span className="num">{formatINR(Math.abs(t.difference))}</span> more than accounts and dues.</>}</p>
            {!readOnly && <p className="text-muted mt-1">First re-check the capital, the account balances and the open items. If a gap is still left that you can’t trace, add an opening adjustment below.</p>}
          </div>
        </div>
      )}

      {!readOnly && !t.is_balanced && <AdjustmentForm key={t.difference} difference={t.difference} reload={reload} />}

      {state.adjustments.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Opening adjustments</p>
          <ul className="divide-y divide-line/15 border-y border-line/20 text-sm">
            {state.adjustments.map(a => (
              <li key={a.id} className="py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="text-ink min-w-0 break-words">{a.note}</span>
                <span className="flex items-center gap-3"><span className="num text-ink">{a.amount < 0 ? '−' : '+'}{formatINR(Math.abs(a.amount))}</span>
                  {!readOnly && <button type="button" className="text-muted hover:text-ink underline underline-offset-4" disabled={rm.busy} aria-label={`Remove adjustment: ${a.note}`}
                    onClick={() => rm.run(async () => { await openingApi.remove('adjustment', a.id); await reload() })}>Remove</button>}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-2">Adjustments change the opening capital and are shared between founders by profit share.</p>
          {rm.error && <div className="mt-2"><FormError>{rm.error}</FormError></div>}
        </div>
      )}
    </Card>
  )
}

function AdjustmentForm({ difference, reload }: { difference: number; reload: () => Promise<void> }) {
  // A positive difference means capital must go up by that amount; negative, down.
  const up = difference > 0
  const [amount, setAmount] = useState(String(Math.abs(difference)))
  const [note, setNote] = useState('')
  const act = useAsyncAction()
  return (
    <form className="mt-4 rounded-shoji border border-line/25 p-4 space-y-3" aria-label="Add an opening adjustment" onSubmit={async e => {
      e.preventDefault()
      const n = toNum(amount)
      await act.run(async () => {
        if (n <= 0) throw new Error('Type an amount above zero.')
        if (note.trim().length < 3) throw new Error('Write a short note saying what this adjustment is for.')
        await openingApi.addAdjustment(up ? n : -n, note.trim()); await reload()
      })
    }}>
      <p className="text-sm text-ink font-medium">Add an opening adjustment</p>
      <p className="text-sm text-muted">This will {up ? 'increase' : 'reduce'} the opening capital by the amount below, so the two sides match. The direction is worked out for you.</p>
      <div className="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-3">
        <label className="block"><span className="text-sm text-ink">Adjustment amount (₹)</span>
          <input type="number" min="0.01" step="0.01" inputMode="decimal" required className="field mt-1.5 num" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="block"><span className="text-sm text-ink">Adjustment note (required)</span>
          <input className="field mt-1.5" required minLength={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Old cash expenses never recorded" /></label>
      </div>
      {act.error && <FormError>{act.error}</FormError>}
      <button className="btn-primary" disabled={act.busy}>{act.busy ? 'Adding…' : 'Add opening adjustment'}</button>
    </form>
  )
}

// ─── Step 4: open items from before ─────────────────────────
function StepOpenItems({ state, reload }: StepProps) {
  const last = state.go_live_date ? dayBefore(state.go_live_date) : ''
  const brands = useAsync(() => moneyApi.brandOptions(), [])
  const payees = useAsync(() => moneyApi.payeeOptions(), [])
  const blankInv = { brand_id: '', invoice_number: '', issue_date: '', due_date: '', amount: '', note: '' }
  const blankPay = { payee: '', amount: '', tds_rate: '10', due_date: '', description: '' }
  const [inv, setInv] = useState(blankInv)
  const [pay, setPay] = useState(blankPay)
  const invAct = useAsyncAction()
  const payAct = useAsyncAction()
  const rm = useAsyncAction()
  const remove = (kind: 'invoice' | 'payout', id: string) => rm.run(async () => { await openingApi.remove(kind, id); await reload() })
  const tds = round2(toNum(pay.amount) * toNum(pay.tds_rate) / 100)
  return (
    <>
      <Card className="shoji-pad">
        <SectionTitle kanji="請" aside={<span className="text-sm text-muted num">{formatINR(state.totals.receivables)} owed to us</span>}>Unpaid invoices from before go-live</SectionTitle>
        <p className="text-sm text-muted mb-4 max-w-2xl">Invoices you raised before go-live that the brand hasn’t fully paid. Money collected on these reduces what’s owed — it is not new revenue.</p>
        {state.receivables.length > 0 && (
          <ul className="divide-y divide-line/15 border-y border-line/20 text-sm mb-5">
            {state.receivables.map(r => (
              <li key={r.invoice_id} className="py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2"><Link to={`/money/invoices/${r.invoice_id}`} className="text-ink underline underline-offset-4 break-all">{r.invoice_number}</Link><Pill>Opening balance</Pill></p>
                  <p className="text-xs text-muted mt-0.5">{r.brand_name} · <span className="num">invoiced {formatDate(r.issue_date)}{r.due_date ? ` · due ${formatDate(r.due_date)}` : ''}</span></p>
                </div>
                <span className="flex items-center gap-3"><span className="num text-ink">{formatINR(r.outstanding)}</span>
                  <button type="button" className="text-muted hover:text-ink underline underline-offset-4" disabled={rm.busy} aria-label={`Remove invoice ${r.invoice_number}`} onClick={() => remove('invoice', r.invoice_id)}>Remove</button></span>
              </li>
            ))}
          </ul>
        )}
        <form className="space-y-3" aria-label="Add an unpaid invoice" onSubmit={async e => {
          e.preventDefault()
          if (await invAct.run(async () => {
            if (inv.issue_date > last) throw new Error(`The invoice date must be before go-live (${formatDate(last)} or earlier).`)
            await openingApi.addInvoice({ brand_id: inv.brand_id, invoice_number: inv.invoice_number.trim(), issue_date: inv.issue_date, due_date: inv.due_date || null, amount: toNum(inv.amount), note: inv.note.trim() || null })
            await reload()
          })) setInv(blankInv)
        }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block"><span className="text-sm text-ink">Brand</span>
              <select className="field mt-1.5" required value={inv.brand_id} onChange={e => setInv({ ...inv, brand_id: e.target.value })}>
                <option value="">Choose a brand</option>{(brands.data ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="block"><span className="text-sm text-ink">Original invoice number</span>
              <input className="field mt-1.5 num" required value={inv.invoice_number} onChange={e => setInv({ ...inv, invoice_number: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-ink">Invoice date</span>
              <input type="date" required max={last} className="field mt-1.5" value={inv.issue_date} onChange={e => setInv({ ...inv, issue_date: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-ink">Invoice due date (optional)</span>
              <input type="date" className="field mt-1.5" value={inv.due_date} onChange={e => setInv({ ...inv, due_date: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-ink">Amount still owed (₹, GST included)</span>
              <input type="number" min="0.01" step="0.01" inputMode="decimal" required className="field mt-1.5 num" value={inv.amount} onChange={e => setInv({ ...inv, amount: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-ink">Invoice note (optional)</span>
              <input className="field mt-1.5" value={inv.note} onChange={e => setInv({ ...inv, note: e.target.value })} /></label>
          </div>
          <p className="text-xs text-muted">The invoice date must be before go-live. Type only what is still unpaid, not the full invoice value.</p>
          {brands.error && <FormError>{brands.error}</FormError>}
          {invAct.error && <FormError>{invAct.error}</FormError>}
          <button className="btn-primary" disabled={invAct.busy}><Icon name="plus" /> Add unpaid invoice</button>
        </form>
      </Card>

      <Card className="shoji-pad">
        <SectionTitle kanji="払" aside={<span className="text-sm text-muted num">{formatINR(state.totals.payables)} we owe</span>}>Unpaid creator and freelancer dues</SectionTitle>
        <p className="text-sm text-muted mb-4 max-w-2xl">Work done before go-live that you haven’t paid for yet. Paying these later clears the due — it is not a new cost.</p>
        {state.payables.length > 0 && (
          <ul className="divide-y divide-line/15 border-y border-line/20 text-sm mb-5">
            {state.payables.map(p => (
              <li key={p.payout_id} className="py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2"><Link to={`/money/payouts/${p.payout_id}`} className="text-ink underline underline-offset-4 break-words">{p.payee_name}</Link><Pill>Opening balance</Pill></p>
                  <p className="text-xs text-muted mt-0.5">{p.payee_kind === 'creator' ? 'Creator' : 'Freelancer'}{p.description ? ` · ${p.description}` : ''}<span className="num"> · TDS {p.tds_rate}%{p.due_date ? ` · due ${formatDate(p.due_date)}` : ''}</span></p>
                </div>
                <span className="flex items-center gap-3"><span className="num text-ink">{formatINR(p.amount)}</span>
                  <button type="button" className="text-muted hover:text-ink underline underline-offset-4" disabled={rm.busy} aria-label={`Remove due for ${p.payee_name}`} onClick={() => remove('payout', p.payout_id)}>Remove</button></span>
              </li>
            ))}
          </ul>
        )}
        <form className="space-y-3" aria-label="Add an unpaid due" onSubmit={async e => {
          e.preventDefault()
          const [kind, id] = pay.payee.split(':')
          if (await payAct.run(async () => {
            await openingApi.addPayout({ creator_id: kind === 'creator' ? id : null, vendor_id: kind === 'vendor' ? id : null, amount: toNum(pay.amount), tds_rate: toNum(pay.tds_rate), due_date: pay.due_date || null, description: pay.description.trim() || null })
            await reload()
          })) setPay(blankPay)
        }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2"><span className="text-sm text-ink">Payee</span>
              <select className="field mt-1.5" required value={pay.payee} onChange={e => setPay({ ...pay, payee: e.target.value })}>
                <option value="">Choose a creator or freelancer</option>
                <optgroup label="Creators">{(payees.data ?? []).filter(x => x.kind === 'creator').map(x => <option key={x.id} value={`creator:${x.id}`}>{x.name}</option>)}</optgroup>
                <optgroup label="Freelancers">{(payees.data ?? []).filter(x => x.kind === 'vendor').map(x => <option key={x.id} value={`vendor:${x.id}`}>{x.name}</option>)}</optgroup>
              </select></label>
            <label className="block"><span className="text-sm text-ink">Amount owed to them (₹)</span>
              <input type="number" min="0.01" step="0.01" inputMode="decimal" required className="field mt-1.5 num" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-ink">TDS %</span>
              <input type="number" min="0" max="100" step="0.01" inputMode="decimal" className="field mt-1.5 num" value={pay.tds_rate} onChange={e => setPay({ ...pay, tds_rate: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-ink">Payout due date (optional)</span>
              <input type="date" className="field mt-1.5" value={pay.due_date} onChange={e => setPay({ ...pay, due_date: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-ink">What it’s for</span>
              <input className="field mt-1.5" value={pay.description} onChange={e => setPay({ ...pay, description: e.target.value })} placeholder="e.g. Reel for the Diwali campaign" /></label>
          </div>
          {toNum(pay.amount) > 0 && <p className="text-xs text-muted num">TDS to deduct {formatINR(tds)} · they receive {formatINR(round2(toNum(pay.amount) - tds))}</p>}
          {payees.error && <FormError>{payees.error}</FormError>}
          {payAct.error && <FormError>{payAct.error}</FormError>}
          <button className="btn-primary" disabled={payAct.busy}><Icon name="plus" /> Add unpaid due</button>
        </form>
      </Card>
      {rm.error && <FormError>{rm.error}</FormError>}
    </>
  )
}

// ─── Summary (finish screen and the locked page) ────────────
interface SummaryRow { section: string; item: string; detail: string; amount: number }
function summaryRows(s: OpeningState): SummaryRow[] {
  const t = s.totals
  return [
    { section: 'Setup', item: 'Go-live date', detail: formatDate(s.go_live_date), amount: 0 },
    ...s.founders.flatMap(f => [
      { section: 'Opening capital', item: f.name, detail: 'Share of profit before go-live', amount: f.accumulated_profit },
      { section: 'Opening capital', item: f.name, detail: 'Own money put in', amount: f.own_money },
      { section: 'Opening capital', item: f.name, detail: 'Share of adjustments', amount: f.other },
      { section: 'Opening capital', item: f.name, detail: 'Total', amount: f.total },
    ]),
    { section: 'Opening capital', item: 'All founders', detail: 'Total', amount: t.capital },
    ...s.adjustments.map(a => ({ section: 'Opening adjustments', item: a.note, detail: '', amount: a.amount })),
    ...s.accounts.map(a => ({ section: 'Opening account balances', item: a.name, detail: ACCOUNT_KIND_LABEL[a.kind], amount: a.opening_balance })),
    { section: 'Opening account balances', item: 'All accounts', detail: 'Total', amount: t.accounts },
    ...s.receivables.map(r => ({ section: 'Money still owed to us', item: r.invoice_number, detail: `${r.brand_name} · invoiced ${formatDate(r.issue_date)}`, amount: r.outstanding })),
    { section: 'Money still owed to us', item: 'All unpaid invoices', detail: 'Total', amount: t.receivables },
    ...s.payables.map(p => ({ section: 'Money we still owe', item: p.payee_name, detail: p.description ?? '', amount: p.amount })),
    { section: 'Money we still owe', item: 'All unpaid dues', detail: 'Total', amount: t.payables },
    { section: 'The check', item: 'Accounts + owed to us − we owe', detail: '', amount: t.net_position },
    { section: 'The check', item: 'Opening capital', detail: '', amount: t.capital },
    { section: 'The check', item: 'Difference', detail: t.is_balanced ? 'Balanced' : 'Not balanced', amount: t.difference },
  ]
}
const exportSummary = (s: OpeningState) => downloadCSV(`opening-balances-${istToday()}.csv`, summaryRows(s), [
  { header: 'Section', value: r => r.section }, { header: 'Item', value: r => r.item }, { header: 'Detail', value: r => r.detail }, { header: 'Amount (INR)', value: r => r.amount }])

function Summary({ state }: { state: OpeningState }) {
  const t = state.totals
  const list = (rows: { key: string; name: ReactNode; sub?: string; amount: number }[], empty: string, totalLabel: string, total: number) => (
    <>
      {rows.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="divide-y divide-line/15 text-sm">
          {rows.map(r => <li key={r.key} className="py-2 flex justify-between gap-4"><span className="min-w-0 break-words text-ink">{r.name}{r.sub && <span className="block text-xs text-muted">{r.sub}</span>}</span><span className="num text-ink whitespace-nowrap">{formatINR(r.amount)}</span></li>)}
        </ul>
      )}
      <p className="flex justify-between gap-4 border-t border-line/25 pt-2 mt-1 text-sm font-medium text-ink"><span>{totalLabel}</span><span className="num">{formatINR(total)}</span></p>
    </>
  )
  return (
    <>
      <Card className="shoji-pad">
        <SectionTitle kanji="資" aside={<button type="button" className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5" onClick={() => exportSummary(state)}><Icon name="download" /> Download CSV</button>}>Opening capital</SectionTitle>
        <p className="text-sm text-muted mb-3">Go-live date <span className="num text-ink">{formatDate(state.go_live_date)}</span>{state.go_live_date && <> · opening entries dated <span className="num text-ink">{formatDate(dayBefore(state.go_live_date))}</span></>}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Opening capital per founder</caption>
            <thead><tr className="text-left text-xs text-muted border-b border-line/20">
              <th scope="col" className="py-2 pr-4 font-normal">Founder</th>
              <th scope="col" className="py-2 px-3 font-normal text-right whitespace-nowrap">Share of past profit</th>
              <th scope="col" className="py-2 px-3 font-normal text-right whitespace-nowrap">Own money</th>
              <th scope="col" className="py-2 px-3 font-normal text-right whitespace-nowrap">Adjustments</th>
              <th scope="col" className="py-2 pl-3 font-normal text-right whitespace-nowrap">Opening capital</th>
            </tr></thead>
            <tbody className="divide-y divide-line/15">
              {state.founders.map(f => (
                <tr key={f.founder_id}>
                  <th scope="row" className="py-2.5 pr-4 font-normal text-left text-ink">{f.name}<span className="block text-xs text-muted num">{f.profit_share_pct}% profit share</span></th>
                  <td className="py-2.5 px-3 text-right num whitespace-nowrap">{formatINR(f.accumulated_profit)}</td>
                  <td className="py-2.5 px-3 text-right num whitespace-nowrap">{formatINR(f.own_money)}</td>
                  <td className="py-2.5 px-3 text-right num whitespace-nowrap">{formatINR(f.other)}</td>
                  <td className="py-2.5 pl-3 text-right num whitespace-nowrap text-ink font-medium">{formatINR(f.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-line/25 font-medium text-ink">
              <th scope="row" colSpan={4} className="py-2.5 pr-4 text-left font-medium">Total opening capital</th>
              <td className="py-2.5 pl-3 text-right num whitespace-nowrap">{formatINR(t.capital)}</td>
            </tr></tfoot>
          </table>
        </div>
      </Card>
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="shoji-pad"><SectionTitle kanji="口">Opening account balances</SectionTitle>
          {list(state.accounts.map(a => ({ key: a.account_id, name: a.name, sub: ACCOUNT_KIND_LABEL[a.kind], amount: a.opening_balance })), 'No accounts.', 'Total in accounts', t.accounts)}</Card>
        <Card className="shoji-pad"><SectionTitle kanji="請">Money still owed to us</SectionTitle>
          {list(state.receivables.map(r => ({ key: r.invoice_id, name: <Link to={`/money/invoices/${r.invoice_id}`} className="underline underline-offset-4">{r.invoice_number}</Link>, sub: r.brand_name, amount: r.outstanding })), 'No unpaid invoices from before go-live.', 'Total owed to us', t.receivables)}</Card>
        <Card className="shoji-pad"><SectionTitle kanji="払">Money we still owe</SectionTitle>
          {list(state.payables.map(p => ({ key: p.payout_id, name: <Link to={`/money/payouts/${p.payout_id}`} className="underline underline-offset-4">{p.payee_name}</Link>, sub: p.description ?? undefined, amount: p.amount })), 'No unpaid dues from before go-live.', 'Total we owe', t.payables)}</Card>
      </div>
    </>
  )
}

function StepFinish({ state, reload }: StepProps) {
  const act = useAsyncAction()
  const t = state.totals
  const blocked = !state.go_live_date ? 'Set the go-live date first.' : !t.is_balanced ? `The check doesn’t balance yet — sort out the difference of ${formatINR(Math.abs(t.difference))} above first.` : null
  return (
    <>
      <Summary state={state} />
      <CheckPanel state={state} reload={reload} />
      <Card className="shoji-pad">
        <SectionTitle kanji="錠">Finish and lock</SectionTitle>
        <p className="text-sm text-muted max-w-2xl">Locking freezes the go-live date, opening capital, opening balances and open items so they can’t be changed by accident. A founder can re-open it later with their password.</p>
        {blocked && <p id="lock-why" className="text-sm text-ink mt-3 flex gap-2"><Andon size={16} lit /> {blocked}</p>}
        {act.error && <div className="mt-3"><FormError>{act.error}</FormError></div>}
        <button type="button" className="btn-primary mt-4" disabled={!!blocked || act.busy} aria-describedby={blocked ? 'lock-why' : undefined}
          onClick={() => act.run(async () => { await openingApi.lock(); await reload() })}>{act.busy ? 'Locking…' : 'Finish & lock'}</button>
      </Card>
    </>
  )
}

// ─── Locked ─────────────────────────────────────────────────
function LockedView({ state, reload }: StepProps) {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Card className="shoji-pad">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Hanko kind="completed" size={56} />
            <div className="min-w-0">
              <p className="font-mincho text-xl text-ink">Opening balances are locked</p>
              <p className="text-sm text-muted mt-0.5 num">Locked on {formatDate(state.locked_at)}{state.locked_by_name ? ` by ${state.locked_by_name}` : ''}</p>
            </div>
          </div>
          <button type="button" className="btn-ghost" onClick={() => setAsking(true)}>Re-open (needs your password)</button>
        </div>
      </Card>
      <Summary state={state} />
      <CheckPanel state={state} reload={reload} readOnly />
      {asking && <UnlockModal onClose={() => setAsking(false)} onDone={async () => { setAsking(false); await reload() }} />}
    </>
  )
}

function UnlockModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const email = useAuth().member?.email ?? ''
  const [password, setPassword] = useState('')
  const act = useAsyncAction()
  return (
    <Modal title="Re-open opening balances" onClose={onClose}>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (await act.run(() => openingApi.unlock(email, password))) await onDone() }}>
        <p className="text-sm text-muted">Re-opening lets founders change the opening capital, balances and open items again. Confirm it’s you with your password.</p>
        <label className="block"><span className="text-sm text-ink">Email</span>
          <input type="email" readOnly autoComplete="username" className="field mt-1.5 text-muted" value={email} /></label>
        <label className="block"><span className="text-sm text-ink">Password</span>
          <input type="password" required autoFocus autoComplete="current-password" className="field mt-1.5" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <p className="text-xs text-muted">Only sign in with Google? Set a password first: sign out and use “Forgot password” on the login page, then come back here.</p>
        {act.error && <FormError>{act.error}</FormError>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={act.busy || !password}>{act.busy ? 'Checking…' : 'Re-open'}</button></div>
      </form>
    </Modal>
  )
}
