// Files tab for any record (campaign, brand…): drop or choose files, pick a
// type, open via short-lived signed links, remove (archive).
import { useRef, useState } from 'react'
import { useAsync } from '../../hooks/useAsync'
import { formatBytes } from '../../lib/brands'
import { formatDate } from '../../lib/format'
import { EmptyState, MoreMenu } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { EnsoSpinner } from '../art/Ink'
import { FormError } from '../../pages/auth/AuthLayout'

export interface FileRow { id: string; file_name: string; kind: string; size_bytes: number | null; storage_path: string; created_at: string }
const MAX = 50 * 1024 * 1024

export function RecordFiles({ load, upload, archive, signedUrl, kinds, defaultKind, hint }: {
  load: () => Promise<FileRow[]>; upload: (file: File, kind: string) => Promise<void>; archive: (id: string) => Promise<void>
  signedUrl: (path: string, name: string) => Promise<string | null>; kinds: { value: string; label: string }[]; defaultKind: string; hint: string
}) {
  const { data, loading, reload } = useAsync(load, [])
  const [kind, setKind] = useState(defaultKind)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  async function add(list: FileList | File[]) {
    setError(null)
    for (const f of Array.from(list)) {
      if (f.size > MAX) { setError(`${f.name} is over 50 MB.`); continue }
      setBusy(f.name)
      try { await upload(f, kind) } catch (e) { setError(`${f.name}: ${e instanceof Error ? e.message : 'upload failed'}`) }
    }
    setBusy(null); reload()
  }
  async function open(f: FileRow) { const u = await signedUrl(f.storage_path, f.file_name); if (u) window.open(u, '_blank', 'noopener'); else setError('Could not open the file.') }
  return (
    <div className="space-y-4">
      <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files) }}
        className={`shoji p-5 flex flex-col sm:flex-row sm:items-center gap-3 border-dashed ${over ? 'border-accent bg-raised' : ''}`}>
        <div className="flex-1"><p className="text-ink">{busy ? `Uploading ${busy}…` : 'Drop files here, or choose them'}</p><p className="text-xs text-muted mt-0.5">{hint}</p></div>
        <label className="sr-only" htmlFor="rf-kind">File type</label>
        <select id="rf-kind" className="field sm:w-48" value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
        <button className="btn-primary justify-center" disabled={Boolean(busy)} onClick={() => input.current?.click()}><Icon name="plus" /> Upload</button>
        <input ref={input} type="file" multiple className="sr-only" onChange={e => { if (e.target.files?.length) add(e.target.files); e.target.value = '' }} />
      </div>
      {error && <FormError>{error}</FormError>}
      {loading ? <EnsoSpinner /> : !data?.length ? <div className="shoji"><EmptyState sketch="branch" line="No files yet." /></div> : (
        <ul className="shoji divide-y divide-line/15">
          {data.map(f => (
            <li key={f.id} className="p-4 sm:px-5 flex items-center gap-3">
              <span className="grid place-items-center w-10 h-10 rounded-shoji bg-raised text-[10px] uppercase text-muted shrink-0">{f.file_name.split('.').pop()?.slice(0, 4)}</span>
              <div className="min-w-0 flex-1">
                <button className="text-ink text-left hover:underline underline-offset-4 break-all" onClick={() => open(f)}>{f.file_name}</button>
                <p className="text-xs text-muted num">{kinds.find(k => k.value === f.kind)?.label ?? f.kind} · {formatBytes(f.size_bytes)} · {formatDate(f.created_at)}</p>
              </div>
              <MoreMenu label={`Actions for ${f.file_name}`} items={[{ label: 'Download', onSelect: () => open(f) },
                { label: 'Remove', danger: true, onSelect: async () => { if (confirm(`Remove ${f.file_name}? It stays in the history.`)) { await archive(f.id); reload() } } }]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
