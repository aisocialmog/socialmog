import { useState } from 'react'
import { creatorsApi } from '../../data/creators'
import { useAsync } from '../../hooks/useAsync'
import { Modal } from '../../components/ui/Modal'
import { Icon } from '../../components/ui/Icon'
import { EnsoSpinner } from '../../components/art/Ink'
import { FormError } from '../auth/AuthLayout'

/** The editable niche list. Removing a niche archives it (creators keep it in history). */
export function NicheEditor({ onClose }: { onClose: () => void }) {
  const { data, loading, reload } = useAsync(() => creatorsApi.niches(), [])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await reload() } catch (e) { setError(e instanceof Error ? (e.message.includes('duplicate') ? 'That niche already exists.' : e.message) : 'Something went wrong') } }
  return (
    <Modal title="Niche list" onClose={onClose}>
      <form className="flex gap-2 mb-4" onSubmit={e => { e.preventDefault(); if (name.trim()) run(async () => { await creatorsApi.addNiche(name); setName('') }) }}>
        <label className="sr-only" htmlFor="new-niche">New niche</label>
        <input id="new-niche" className="field" value={name} onChange={e => setName(e.target.value)} placeholder="Add a niche, e.g. Spirituality" />
        <button className="btn-primary shrink-0" disabled={!name.trim()}><Icon name="plus" /> Add</button>
      </form>
      {error && <div className="mb-3"><FormError>{error}</FormError></div>}
      {loading ? <EnsoSpinner /> : (
        <ul className="divide-y divide-line/15 max-h-[50vh] overflow-y-auto">
          {(data ?? []).map(n => (
            <li key={n.id} className="py-2 flex items-center gap-2">
              {editing?.id === n.id ? (
                <form className="flex gap-2 flex-1" onSubmit={e => { e.preventDefault(); run(async () => { await creatorsApi.renameNiche(n.id, editing.name); setEditing(null) }) }}>
                  <label className="sr-only" htmlFor={`n-${n.id}`}>Rename {n.name}</label>
                  <input id={`n-${n.id}`} className="field h-9" autoFocus value={editing.name} onChange={e => setEditing({ id: n.id, name: e.target.value })} />
                  <button className="btn-primary h-9">Save</button>
                </form>
              ) : <>
                <span className="flex-1 text-sm text-ink">{n.name}</span>
                <button className="icon-btn w-9 h-9" aria-label={`Rename ${n.name}`} onClick={() => setEditing(n)}><Icon name="edit" /></button>
                <button className="icon-btn w-9 h-9" aria-label={`Remove ${n.name}`} onClick={() => { if (confirm(`Remove “${n.name}” from the list? Creators tagged with it lose the tag in filters.`)) run(() => creatorsApi.archiveNiche(n.id)) }}><Icon name="close" /></button>
              </>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
