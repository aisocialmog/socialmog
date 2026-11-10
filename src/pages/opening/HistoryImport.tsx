// Step 5 of the opening-balances wizard: optional history import, for the record only.
// Upload → match columns → review → import → result, for old brands, past campaigns
// and who was on each campaign. Creators use the existing importer.
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { openingApi, type ImportResult } from '../../data/opening'
import { parseCSV } from '../../lib/creators'
import { downloadCSV, toCSV } from '../../lib/csv'
import { guessHistoryMapping, historyTemplate, HISTORY_FIELDS, HISTORY_TYPE_LABEL, prepareHistoryRows, type HistoryRowMap, type HistoryType } from '../../lib/historyImport'
import { Icon } from '../../components/ui/Icon'
import { Card, Pill } from '../../components/ui/kit'
import { FormError, FormNote } from '../auth/AuthLayout'

type Tab = HistoryType | 'creators'
const TABS: { key: Tab; label: string }[] = [
  { key: 'brands', label: HISTORY_TYPE_LABEL.brands },
  { key: 'creators', label: 'Creators' },
  { key: 'campaigns', label: HISTORY_TYPE_LABEL.campaigns },
  { key: 'campaignCreators', label: HISTORY_TYPE_LABEL.campaignCreators },
]
const MAX_ROWS = 5000
const REVIEW_ROWS = 10
const ABOUT: Record<HistoryType, string> = {
  brands: 'Brands you worked with before go-live. Brands we already have are skipped.',
  campaigns: 'Campaigns that ran before go-live. Add the brands first, so each campaign finds its brand.',
  campaignCreators: 'Which creator worked on which past campaign, and what they were paid. Add creators and past campaigns first.',
}

export function HistoryImport({ goLive }: { goLive: string | null }) {
  const [tab, setTab] = useState<Tab>('brands')
  return (
    <div className="space-y-5">
      <FormNote>For the record only. Past campaign money is shown on brand and creator pages as historical figures and is left out of every money report, so nothing is counted twice.</FormNote>
      <p className="text-sm text-muted">Best order: brands → creators → past campaigns → who was on each campaign. You can skip this step and do it later.</p>
      <div role="tablist" aria-label="What to import" className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.key} role="tab" id={`hist-tab-${t.key}`} aria-selected={tab === t.key} aria-controls="hist-panel" onClick={() => setTab(t.key)}
            className={`pill py-1.5 px-3 text-sm ${tab === t.key ? 'bg-accent text-sumi' : 'border border-line/40 text-muted hover:text-ink'}`}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id="hist-panel" aria-labelledby={`hist-tab-${tab}`}>
        {tab === 'creators' ? (
          <Card className="space-y-3">
            <p className="font-mincho text-lg text-ink">Creators</p>
            <p className="text-sm text-muted">Creators have their own importer: it takes the full creator sheet (platforms, followers, rates) and checks for duplicates by phone number and handle. Do it before importing past campaigns.</p>
            <Link to="/creators/import" className="btn-primary inline-flex">Open the creator importer</Link>
          </Card>
        ) : <ImportPanel key={tab} type={tab} goLive={goLive} />}
      </div>
    </div>
  )
}

type Step = 'upload' | 'map' | 'review' | 'done'

function ImportPanel({ type, goLive }: { type: HistoryType; goLive: string | null }) {
  const fields = HISTORY_FIELDS[type]
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [data, setData] = useState<string[][]>([])
  const [colFor, setColFor] = useState<Record<string, number>>({})   // field key → column index (-1 = none)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const mapping = useMemo(() => headers.map((_, i) => fields.find(f => colFor[f.key] === i)?.key ?? ''), [headers, fields, colFor])
  const prepared = useMemo(() => prepareHistoryRows(type, data, mapping, goLive), [type, data, mapping, goLive])
  const problemRows = new Set(prepared.problems.map(p => p.row)).size

  async function readFile(file: File) {
    setError(null)
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) { setError('Choose a .csv file. In Excel or Google Sheets use File → Download / Save as → CSV.'); return }
    const rows = parseCSV(await file.text())
    if (rows.length < 2) { setError('That file has no data rows under the header row.'); return }
    if (rows.length - 1 > MAX_ROWS) { setError(`That file has ${rows.length - 1} rows. Import at most ${MAX_ROWS} at a time.`); return }
    const [h, ...d] = rows
    const guess = guessHistoryMapping(h, fields)
    const cf: Record<string, number> = {}
    for (const f of fields) cf[f.key] = guess.indexOf(f.key)
    setFileName(file.name); setHeaders(h); setData(d); setColFor(cf); setStep('map')
  }

  function review() {
    const missing = fields.filter(f => f.required && (colFor[f.key] ?? -1) < 0)
    if (missing.length) { setError(`Pick a column for ${missing.map(f => `“${f.label}”`).join(' and ')}.`); return }
    setError(null); setStep('review')
  }

  async function runImport() {
    if (!prepared.rows.length) { setError('There are no ready rows to import.'); return }
    setBusy(true); setError(null)
    try {
      let r: ImportResult
      if (type === 'brands') r = await openingApi.importBrands(prepared.rows as HistoryRowMap['brands'][], fileName)
      else if (type === 'campaigns') r = await openingApi.importCampaigns(prepared.rows as HistoryRowMap['campaigns'][], fileName)
      else r = await openingApi.importCampaignCreators(prepared.rows as HistoryRowMap['campaignCreators'][], fileName)
      setResult(r)
      setStep('done')
    } catch (e) { setError(`Nothing was imported: ${e instanceof Error ? e.message : 'the import failed'}`) } finally { setBusy(false) }
  }

  function template() {
    const t = historyTemplate(type)
    const csv = toCSV([t.example], t.headers.map((h, i) => ({ header: h, value: (r: string[]) => r[i] })))
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: t.filename })
    document.body.appendChild(a); a.click(); a.remove()
  }

  function reset() { setStep('upload'); setResult(null); setData([]); setHeaders([]); setError(null) }

  const label = HISTORY_TYPE_LABEL[type]
  const shown = prepared.review.slice(0, REVIEW_ROWS)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{ABOUT[type]}</p>
      {error && <FormError>{error}</FormError>}

      {step === 'upload' && (
        <div className="shoji p-8 text-center space-y-4">
          <p className="font-mincho text-xl text-ink">Upload a CSV file for “{label}”</p>
          <p className="text-sm text-muted">From a Google Sheet or Excel (save as CSV). Up to {MAX_ROWS.toLocaleString('en-IN')} rows at once. Dates like 15/07/2025 and amounts like ₹1,50,000 are fine.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-primary" onClick={() => input.current?.click()}>Choose file</button>
            <button type="button" className="btn-ghost" onClick={template}><Icon name="download" /> Download template</button>
          </div>
          <label className="sr-only" htmlFor={`hist-file-${type}`}>{label} CSV file</label>
          <input id={`hist-file-${type}`} ref={input} type="file" accept=".csv,text/csv,.txt,.tsv" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) void readFile(file); e.target.value = '' }} />
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <FormNote><span className="num">{fileName} · {data.length} rows</span>. We matched what we could — check each field and pick “Don’t import” for anything you don’t have.</FormNote>
          <div className="shoji overflow-x-auto">
            <table className="w-full text-sm min-w-[32rem]">
              <thead><tr className="text-left text-xs text-muted border-b border-line/25"><th className="px-5 py-3 font-normal">Our field</th><th className="px-3 py-3 font-normal">Column in your file</th><th className="px-5 py-3 font-normal">Example</th></tr></thead>
              <tbody className="divide-y divide-line/15">
                {fields.map(f => {
                  const i = colFor[f.key] ?? -1
                  return (
                    <tr key={f.key}>
                      <td className="px-5 py-2.5 text-ink"><label htmlFor={`hist-map-${type}-${f.key}`}>{f.label}{f.required && <span className="text-akane" aria-hidden="true"> *</span>}{f.required && <span className="sr-only"> (required)</span>}</label></td>
                      <td className="px-3 py-2.5">
                        <select id={`hist-map-${type}-${f.key}`} className={`field h-9 ${i >= 0 ? 'border-accent/60' : ''}`} value={i}
                          onChange={e => { const v = Number(e.target.value); setColFor(c => { const n: Record<string, number> = {}; for (const k of Object.keys(c)) n[k] = v >= 0 && c[k] === v ? -1 : c[k]; n[f.key] = v; return n }) }}>
                          <option value={-1}>{f.required ? 'Choose a column…' : 'Don’t import'}</option>
                          {headers.map((h, j) => <option key={j} value={j}>{h || `(column ${j + 1})`}</option>)}
                        </select>
                      </td>
                      <td className="px-5 py-2.5 text-muted truncate max-w-[12rem]">{i >= 0 ? data.find(r => r[i]?.trim())?.[i] ?? '—' : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between gap-2">
            <button type="button" className="btn-ghost" onClick={reset}>Choose another file</button>
            <button type="button" className="btn-primary" onClick={review}>Review rows</button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Pill tone="accent">{prepared.rows.length} rows ready</Pill>
            <Pill tone={problemRows ? 'alert' : 'quiet'}>{problemRows} with problems</Pill>
          </div>
          <p className="text-sm text-muted" role="status">{prepared.rows.length} rows ready, {problemRows} with problems{problemRows ? ' — those are skipped' : ''}. Showing the first {shown.length}.</p>
          <div className="shoji overflow-x-auto">
            <table className="w-full text-sm min-w-[40rem]">
              <thead><tr className="text-left text-xs text-muted border-b border-line/25">
                <th className="px-4 py-3 font-normal">Row</th>
                {fields.filter(f => mapping.includes(f.key)).map(f => <th key={f.key} className="px-3 py-3 font-normal">{f.label}</th>)}
                <th className="px-4 py-3 font-normal">Check</th>
              </tr></thead>
              <tbody className="divide-y divide-line/15">
                {shown.map(r => (
                  <tr key={r.row} className={r.problems.length ? 'opacity-80' : ''}>
                    <td className="px-4 py-2.5 text-muted num">{r.row}</td>
                    {fields.filter(f => mapping.includes(f.key)).map(f => <td key={f.key} className="px-3 py-2.5 text-ink max-w-[14rem] truncate">{r.values[f.key] || <span className="text-muted">—</span>}</td>)}
                    <td className="px-4 py-2.5 text-xs">
                      {r.problems.length ? r.problems.map(p => <p key={p} className="text-ink"><span className="inline-block w-1.5 h-1.5 rounded-full bg-akane mr-1.5 align-middle" />{p}</p>) : <span className="text-muted">Ready</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep('map')}>Back to columns</button>
            <button type="button" className="btn-primary" onClick={() => void runImport()} disabled={busy || prepared.rows.length === 0}>{busy ? 'Importing…' : `Import ${prepared.rows.length} row${prepared.rows.length === 1 ? '' : 's'}`}</button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="shoji p-6 space-y-4">
          <p className="font-mincho text-xl text-ink" role="status">{result.created} created · {result.skipped} skipped (already there) · {result.errors.length + prepared.problems.length} with errors</p>
          {(result.errors.length > 0 || prepared.problems.length > 0) && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[28rem]">
                  <thead><tr className="text-left text-xs text-muted border-b border-line/25"><th className="px-3 py-2 font-normal">Row</th><th className="px-3 py-2 font-normal">Name</th><th className="px-3 py-2 font-normal">Problem</th></tr></thead>
                  <tbody className="divide-y divide-line/15">
                    {[...prepared.problems, ...result.errors].map((e, i) => <tr key={i}><td className="px-3 py-2 num text-muted">{e.row}</td><td className="px-3 py-2 text-ink">{e.name}</td><td className="px-3 py-2 text-muted">{e.problem}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn-ghost" onClick={() => downloadCSV(`history-${type}-errors.csv`, [...prepared.problems, ...result.errors], [
                { header: 'Row', value: e => e.row }, { header: 'Name', value: e => e.name }, { header: 'Problem', value: e => e.problem }])}>
                <Icon name="download" /> Download errors CSV
              </button>
            </>
          )}
          <div><button type="button" className="btn-primary" onClick={reset}>Import another file</button></div>
        </div>
      )}
    </div>
  )
}
