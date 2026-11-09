// Bulk import: upload → map columns → review (problems + duplicates) → import.
// Duplicates are matched by phone (last 10 digits) or platform handle, against
// the database and within the file itself. Import is all-or-nothing.
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { creatorsApi, type Duplicate } from '../../data/creators'
import { duplicatesWithinFile, formatCount, guessMapping, IMPORT_FIELDS, parseCSV, PLATFORM_LABEL, phoneKey, prepareRows, RATE_LABEL, type DeliverableType, type PreparedRow } from '../../lib/creators'
import { formatINR } from '../../lib/format'
import { toCSV } from '../../lib/csv'
import { Icon } from '../../components/ui/Icon'
import { EnsoSpinner } from '../../components/art/Ink'
import { Pill } from '../../components/ui/kit'
import { CreatorsHeader } from './CreatorsPage'
import { FormError, FormNote } from '../auth/AuthLayout'

type Step = 'upload' | 'map' | 'review' | 'done'
const MAX_ROWS = 5000
const GROUPS = [...new Set(IMPORT_FIELDS.map(f => f.group))]

const TEMPLATE_HEADERS = ['Name', 'Phone', 'WhatsApp', 'Email', 'City', 'State', 'Gender', 'Languages', 'Niches', 'Instagram', 'Instagram followers', 'Instagram avg views', 'Instagram ER',
  'YouTube', 'YouTube subscribers', 'Reel rate', 'Story rate', 'Post rate', 'YouTube video rate', 'Manager name', 'Manager phone', 'Notes']
function downloadTemplate() {
  const csv = toCSV([['Aarohi Sinha', '+91 98350 10001', '', 'aarohi@example.com', 'Ranchi', 'Jharkhand', 'Female', 'Hindi, English', 'Food, Regional',
    '@aarohi.eats', '48.2K', '31K', '6.2', '', '', '9000', '2500', '4000', '', '', '', 'Example row — delete me']],
    TEMPLATE_HEADERS.map((h, i) => ({ header: h, value: (r: string[]) => r[i] })))
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'creators-import-template.csv' })
  a.click()
}

export function CreatorImport() {
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [data, setData] = useState<string[][]>([])
  const [mapping, setMapping] = useState<(string | '')[]>([])
  const [prepared, setPrepared] = useState<PreparedRow[]>([])
  const [dbDupes, setDbDupes] = useState<Duplicate[]>([])
  const [include, setInclude] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ batch_id: string; created: number } | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function readFile(file: File) {
    setError(null)
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) { setError('Choose a .csv file. In Excel or Google Sheets use File → Download / Save as → CSV.'); return }
    const rows = parseCSV(await file.text())
    if (rows.length < 2) { setError('That file has no data rows under the header row.'); return }
    if (rows.length - 1 > MAX_ROWS) { setError(`That file has ${rows.length - 1} rows. Import at most ${MAX_ROWS} at a time.`); return }
    const [h, ...d] = rows
    setFileName(file.name); setHeaders(h); setData(d); setMapping(guessMapping(h)); setStep('map')
  }

  async function review() {
    if (!mapping.includes('name')) { setError('Map one column to “Name”.'); return }
    setBusy(true); setError(null)
    const rows = prepareRows(headers, data, mapping)
    try {
      const phones = rows.map(r => r.row.phone).filter(Boolean) as string[]
      const handles = rows.flatMap(r => r.row.platforms.map(p => `${p.platform}:${p.handle.toLowerCase()}`))
      const found = await creatorsApi.duplicates(phones, handles)
      setPrepared(rows); setDbDupes(found)
      const inFile = duplicatesWithinFile(rows)
      setInclude(new Set(rows.filter(r => !r.problems.length && !inFile.has(r.line) && !matchFor(r, found).length).map(r => r.line)))
      setStep('review')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not check for duplicates') } finally { setBusy(false) }
  }

  const inFile = useMemo(() => duplicatesWithinFile(prepared), [prepared])
  const counts = useMemo(() => ({
    ok: prepared.filter(r => !r.problems.length && !inFile.has(r.line) && !matchFor(r, dbDupes).length).length,
    problems: prepared.filter(r => r.problems.length).length,
    dupes: prepared.filter(r => !r.problems.length && (inFile.has(r.line) || matchFor(r, dbDupes).length)).length,
  }), [prepared, inFile, dbDupes])

  async function runImport() {
    const rows = prepared.filter(r => include.has(r.line) && !r.problems.length).map(r => r.row)
    if (!rows.length) { setError('Tick at least one row to import.'); return }
    setBusy(true); setError(null)
    try { setResult(await creatorsApi.importRows(fileName, rows)); setStep('done') }
    catch (e) { setError(`Nothing was imported: ${e instanceof Error ? e.message : 'the import failed'}`) } finally { setBusy(false) }
  }

  const stepIdx = ['upload', 'map', 'review', 'done'].indexOf(step)
  return (
    <div className="space-y-6 max-w-5xl">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5"><Link to="/creators" className="hover:text-ink">Creators</Link><Icon name="chevronRight" className="text-xs" /><span className="text-ink">Import</span></nav>
      <CreatorsHeader title="Import creators" />
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Steps">
        {['Upload', 'Match columns', 'Review', 'Done'].map((s, i) => (
          <li key={s} aria-current={i === stepIdx ? 'step' : undefined} className={`pill py-1.5 px-3 ${i === stepIdx ? 'bg-accent text-sumi' : i < stepIdx ? 'border border-accent/60 text-ink' : 'border border-line/40 text-muted'}`}>{i + 1}. {s}</li>
        ))}
      </ol>
      {error && <FormError>{error}</FormError>}

      {step === 'upload' && (
        <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const file = e.dataTransfer.files[0]; if (file) readFile(file) }}
          className={`shoji border-dashed p-10 text-center ${over ? 'border-accent bg-raised' : ''}`}>
          <p className="font-mincho text-xl text-ink">Drop a CSV file here</p>
          <p className="text-sm text-muted mt-2">From the old app, a Google Sheet or Excel (save as CSV). Up to {MAX_ROWS.toLocaleString('en-IN')} creators at once.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            <button className="btn-primary" onClick={() => input.current?.click()}>Choose file</button>
            <button className="btn-ghost" onClick={downloadTemplate}><Icon name="download" /> Template</button>
          </div>
          <input ref={input} type="file" accept=".csv,text/csv,.txt,.tsv" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) readFile(file); e.target.value = '' }} />
          <p className="text-xs text-muted mt-6">Numbers can be written as 48.2K, 1.5L, 1M or 1,20,000. Niches and languages can be separated with commas.</p>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <FormNote><span className="num">{fileName} · {data.length} rows</span>. We matched what we could — check each column and pick “Don’t import” for anything you don’t need.</FormNote>
          <div className="shoji overflow-x-auto">
            <table className="w-full text-sm min-w-[40rem]">
              <thead><tr className="text-left text-xs text-muted border-b border-line/25"><th className="px-5 py-3 font-normal">Column in your file</th><th className="px-3 py-3 font-normal">Example</th><th className="px-5 py-3 font-normal">Goes into</th></tr></thead>
              <tbody className="divide-y divide-line/15">
                {headers.map((h, i) => {
                  const taken = new Set(mapping.filter((m, j) => m && j !== i))
                  return (
                    <tr key={i}>
                      <td className="px-5 py-2.5 text-ink">{h || <span className="text-muted">(no header)</span>}</td>
                      <td className="px-3 py-2.5 text-muted truncate max-w-[14rem]">{data.find(r => r[i]?.trim())?.[i] ?? '—'}</td>
                      <td className="px-5 py-2.5">
                        <label className="sr-only" htmlFor={`map-${i}`}>Field for {h}</label>
                        <select id={`map-${i}`} className={`field h-9 ${mapping[i] ? 'border-accent/60' : ''}`} value={mapping[i]} onChange={e => setMapping(m => m.map((x, j) => j === i ? e.target.value : x))}>
                          <option value="">Don’t import</option>
                          {GROUPS.map(g => <optgroup key={g} label={g}>{IMPORT_FIELDS.filter(f => f.group === g).map(f => <option key={f.key} value={f.key} disabled={taken.has(f.key)}>{f.label}</option>)}</optgroup>)}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between gap-2">
            <button className="btn-ghost" onClick={() => setStep('upload')}>Choose another file</button>
            <button className="btn-primary" onClick={review} disabled={busy}>{busy ? 'Checking for duplicates…' : 'Review rows'}</button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Pill tone="accent">{counts.ok} ready</Pill><Pill tone="warm">{counts.dupes} possible duplicates</Pill><Pill tone={counts.problems ? 'alert' : 'quiet'}>{counts.problems} need fixing</Pill>
          </div>
          <p className="text-sm text-muted">Ready rows are ticked. Duplicates are left out unless you tick them (that creates a second record). Rows that need fixing can’t be imported — fix them in the file and upload again.</p>
          <div className="shoji overflow-x-auto max-h-[60vh]">
            <table className="w-full text-sm min-w-[50rem]">
              <thead className="sticky top-0 bg-card z-10"><tr className="text-left text-xs text-muted border-b border-line/25">
                <th className="pl-4 pr-1 py-3 w-8"><span className="sr-only">Import</span></th><th className="px-2 py-3 font-normal">Row</th><th className="px-3 py-3 font-normal">Creator</th>
                <th className="px-3 py-3 font-normal">Platforms</th><th className="px-3 py-3 font-normal">Rates</th><th className="px-4 py-3 font-normal">Check</th>
              </tr></thead>
              <tbody className="divide-y divide-line/15">
                {prepared.map(r => {
                  const db = matchFor(r, dbDupes), dup = inFile.get(r.line)
                  return (
                    <tr key={r.line} className={r.problems.length ? 'opacity-80' : ''}>
                      <td className="pl-4 pr-1 py-2.5"><input type="checkbox" className="accent-[#E3793A]" aria-label={`Import row ${r.line}`} disabled={r.problems.length > 0}
                        checked={include.has(r.line)} onChange={() => setInclude(s => { const n = new Set(s); n.has(r.line) ? n.delete(r.line) : n.add(r.line); return n })} /></td>
                      <td className="px-2 py-2.5 text-muted num">{r.line}</td>
                      <td className="px-3 py-2.5"><span className="text-ink">{r.row.name || '—'}</span><span className="block text-xs text-muted">{[r.row.city, r.row.phone, r.row.niches.join(', ')].filter(Boolean).join(' · ')}</span></td>
                      <td className="px-3 py-2.5 text-xs text-muted">{r.row.platforms.map(p => `${PLATFORM_LABEL[p.platform]} @${p.handle}${p.followers != null ? ` · ${formatCount(p.followers)}` : ''}`).join(', ') || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-muted num">{Object.entries(r.row.rates).map(([t, v]) => `${RATE_LABEL[t as DeliverableType]} ${formatINR(v)}`).join(', ') || '—'}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {r.problems.map(p => <p key={p} className="text-ink"><span className="inline-block w-1.5 h-1.5 rounded-full bg-akane mr-1.5 align-middle" />{p}</p>)}
                        {db.map(d => <p key={d.creator_id + d.value} className="text-ink">Already have <Link className="underline underline-offset-4" to={`/creators/${d.creator_id}`} target="_blank">{d.creator_name}</Link> ({d.matched_on})</p>)}
                        {dup && <p className="text-ink">{dup}</p>}
                        {!r.problems.length && !db.length && !dup && <span className="text-muted">Ready</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <button className="btn-ghost" onClick={() => setStep('map')}>Back to columns</button>
            <button className="btn-primary" onClick={runImport} disabled={busy || include.size === 0}>{busy ? 'Importing…' : `Import ${include.size} creator${include.size === 1 ? '' : 's'}`}</button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="shoji p-8 text-center space-y-4">
          <p className="font-mincho text-2xl text-ink">{result.created} creator{result.created === 1 ? '' : 's'} imported.</p>
          <p className="text-sm text-muted">They’re marked as Prospects. The import is recorded, and every new record says “import” in its history.</p>
          <div className="flex justify-center gap-2"><Link className="btn-primary" to={`/creators?batch=${result.batch_id}`}>See them</Link><button className="btn-ghost" onClick={() => { setStep('upload'); setPrepared([]); setResult(null) }}>Import another file</button></div>
        </div>
      )}
      {busy && step === 'review' && <EnsoSpinner />}
    </div>
  )
}

function matchFor(r: PreparedRow, found: Duplicate[]): Duplicate[] {
  const pk = phoneKey(r.row.phone)
  const hs = r.row.platforms.map(p => `${p.platform}:${p.handle.toLowerCase()}`)
  return found.filter(d => (d.matched_on === 'phone' && d.value === pk) || (d.matched_on === 'handle' && hs.includes(d.value)))
}
