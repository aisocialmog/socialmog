import { useState, type FormEvent } from 'react'
import { creatorsApi } from '../../data/creators'
import { useAsync } from '../../hooks/useAsync'
import { Modal } from '../ui/Modal'
import { FormError } from '../../pages/auth/AuthLayout'
import { EnsoSpinner } from '../art/Ink'

/** Pick an existing shortlist or start a new one, then add the selected creators. */
export function AddToShortlist({ creatorIds, onClose, onDone }: { creatorIds: string[]; onClose: () => void; onDone: (shortlistId: string, name: string) => void }) {
  const lists = useAsync(() => creatorsApi.shortlists(), [])
  const [choice, setChoice] = useState<string>('new')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (choice === 'new' && !name.trim()) { setError('Name the shortlist.'); return }
    setBusy(true); setError(null)
    try {
      const id = choice === 'new' ? await creatorsApi.createShortlist(name, notes.trim() || null, null) : choice
      await creatorsApi.addToShortlist(id, creatorIds)
      onDone(id, choice === 'new' ? name.trim() : lists.data?.find(l => l.id === choice)?.name ?? '')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add to the shortlist'); setBusy(false) }
  }

  return (
    <Modal title={`Add ${creatorIds.length} creator${creatorIds.length === 1 ? '' : 's'} to a shortlist`} onClose={onClose}>
      {lists.loading ? <EnsoSpinner /> : (
        <form onSubmit={submit} className="space-y-4">
          {error && <FormError>{error}</FormError>}
          <fieldset className="space-y-2">
            <legend className="sr-only">Shortlist</legend>
            {(lists.data ?? []).map(l => (
              <label key={l.id} className={`flex items-center gap-3 rounded-shoji border px-3 py-2.5 cursor-pointer ${choice === l.id ? 'border-accent bg-card' : 'border-line/30'}`}>
                <input type="radio" name="sl" checked={choice === l.id} onChange={() => setChoice(l.id)} className="accent-[#E3793A]" />
                <span className="flex-1 text-sm text-ink">{l.name}</span><span className="text-xs text-muted num">{l.count} creators</span>
              </label>
            ))}
            <label className={`flex items-center gap-3 rounded-shoji border px-3 py-2.5 cursor-pointer ${choice === 'new' ? 'border-accent bg-card' : 'border-line/30'}`}>
              <input type="radio" name="sl" checked={choice === 'new'} onChange={() => setChoice('new')} className="accent-[#E3793A]" />
              <span className="text-sm text-ink">New shortlist</span>
            </label>
          </fieldset>
          {choice === 'new' && <>
            <label className="block text-sm text-muted">Name<input className="field mt-1.5" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Chai Sutra Diwali — food creators" autoFocus /></label>
            <label className="block text-sm text-muted">Notes (optional)<textarea className="field mt-1.5 h-16 py-2" value={notes} onChange={e => setNotes(e.target.value)} /></label>
            <p className="text-xs text-muted">You’ll link it to a campaign once Campaigns (feature 4) is built.</p>
          </>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add to shortlist'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
