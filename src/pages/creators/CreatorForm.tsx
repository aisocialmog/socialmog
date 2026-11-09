import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { creatorsApi, type CreatorInput, type Duplicate, type PlatformInput } from '../../data/creators'
import { useAsync } from '../../hooks/useAsync'
import { cleanHandle, CREATOR_STATUS_LABEL, GENDERS, LANGUAGES, parseCount, parsePercent, PLATFORMS, PLATFORM_LABEL, phoneKey } from '../../lib/creators'
import { GST_STATES } from '../../lib/brands'
import { Icon } from '../../components/ui/Icon'
import { Avatar } from '../../components/ui/Avatar'
import { EnsoSpinner } from '../../components/art/Ink'
import { ChipSelect, Stars } from '../../components/creators/CreatorBits'
import { FormError } from '../auth/AuthLayout'

type PlatformDraft = { platform: string; handle: string; followers: string; avg_views: string; engagement_rate: string }
const blankPlatform = (): PlatformDraft => ({ platform: 'instagram', handle: '', followers: '', avg_views: '', engagement_rate: '' })
const STATES = Object.values(GST_STATES).sort()

export function CreatorForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const nav = useNavigate()
  const existing = useAsync(() => id ? creatorsApi.get(id) : Promise.resolve(null), [id])
  const niches = useAsync(() => creatorsApi.niches(), [])

  const [f, setF] = useState<CreatorInput>({
    name: '', gender: null, city: '', state: null, languages: [], phone: '', whatsapp: '', email: '',
    manager_name: '', manager_agency: '', manager_phone: '', manager_email: '', status: 'prospect', rating: null,
    would_work_again: null, is_blacklisted: false, blacklist_reason: '', notes: '',
  })
  const [sameWa, setSameWa] = useState(true)
  const [nicheIds, setNicheIds] = useState<string[]>([])
  const [newNiche, setNewNiche] = useState('')
  const [platforms, setPlatforms] = useState<PlatformDraft[]>([blankPlatform()])
  const [photo, setPhoto] = useState<File | null>(null)
  const [dupes, setDupes] = useState<Duplicate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const c = existing.data
    if (!c) return
    setF({ name: c.name, gender: c.gender, city: c.city ?? '', state: c.state, languages: c.languages, phone: c.phone ?? '', whatsapp: c.whatsapp ?? '',
      email: c.email ?? '', manager_name: c.manager_name ?? '', manager_agency: c.manager_agency ?? '', manager_phone: c.manager_phone ?? '',
      manager_email: c.manager_email ?? '', status: c.status, rating: c.rating, would_work_again: c.would_work_again, is_blacklisted: c.is_blacklisted,
      blacklist_reason: c.blacklist_reason ?? '', notes: c.notes ?? '' })
    setSameWa(!c.whatsapp || c.whatsapp === c.phone)
    setNicheIds(c.niche_ids)
  }, [existing.data])

  const t = (k: keyof CreatorInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const clean = (v: string | null) => (v ?? '').trim() || null

  async function submit(e: FormEvent, force = false) {
    e.preventDefault()
    if (!f.name.trim()) { setError('Add the creator’s name.'); return }
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { setError('Check the email address.'); return }
    if (f.is_blacklisted && !clean(f.blacklist_reason)) { setError('Say why this creator is blacklisted.'); return }
    const plats: PlatformInput[] = editing ? [] : platforms.filter(p => cleanHandle(p.handle)).map(p => ({
      platform: p.platform, handle: cleanHandle(p.handle)!, url: null,
      followers: parseCount(p.followers), avg_views: parseCount(p.avg_views), engagement_rate: parsePercent(p.engagement_rate),
    }))
    setBusy(true); setError(null)
    try {
      if (!force) {
        const found = (await creatorsApi.duplicates(f.phone ? [f.phone] : [], plats.map(p => `${p.platform}:${p.handle.toLowerCase()}`))).filter(d => d.creator_id !== id)
        if (found.length) { setDupes(found); setBusy(false); return }
      }
      const input: CreatorInput = {
        ...f, name: f.name.trim(), city: clean(f.city), phone: clean(f.phone), whatsapp: sameWa ? clean(f.phone) : clean(f.whatsapp), email: clean(f.email),
        manager_name: clean(f.manager_name), manager_agency: clean(f.manager_agency), manager_phone: clean(f.manager_phone), manager_email: clean(f.manager_email),
        blacklist_reason: f.is_blacklisted ? clean(f.blacklist_reason) : null, notes: clean(f.notes),
      }
      const creatorId = await creatorsApi.save(input, id)
      await creatorsApi.setNiches(creatorId, existing.data?.niche_ids ?? [], nicheIds)
      for (const p of plats) await creatorsApi.savePlatform(creatorId, p)
      if (photo) await creatorsApi.uploadPhoto(creatorId, photo)
      nav(`/creators/${creatorId}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? (err.message.includes('creator_platforms_handle_key') ? 'One of those handles already belongs to another creator.' : err.message) : 'Could not save')
      setBusy(false)
    }
  }

  if (editing && existing.loading) return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} /></div>
  if (editing && !existing.data) return <FormError>That creator wasn’t found.</FormError>

  return (
    <form onSubmit={e => submit(e)} noValidate className="space-y-6 max-w-3xl">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
        <Link to="/creators" className="hover:text-ink">Creators</Link><Icon name="chevronRight" className="text-xs" />
        {editing ? <><Link to={`/creators/${id}`} className="hover:text-ink">{existing.data?.name}</Link><Icon name="chevronRight" className="text-xs" /><span className="text-ink">Edit</span></> : <span className="text-ink">New creator</span>}
      </nav>
      <h1 className="font-mincho text-3xl text-ink">{editing ? 'Edit creator' : 'Add a creator'}</h1>
      {error && <FormError>{error}</FormError>}
      {dupes && (
        <div role="alert" className="shoji border-akane p-4 space-y-3">
          <p className="text-ink">This looks like someone already in the database:</p>
          <ul className="text-sm space-y-1">{dupes.map(d => <li key={d.creator_id + d.value}>
            <Link to={`/creators/${d.creator_id}`} className="text-ink underline underline-offset-4">{d.creator_name}</Link>
            <span className="text-muted"> — same {d.matched_on === 'phone' ? 'phone number' : `handle (${d.value.replace(':', ' @')})`}</span></li>)}</ul>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost h-9" onClick={() => setDupes(null)}>Go back and check</button>
            <button type="button" className="btn-primary h-9" onClick={e => { setDupes(null); submit(e as unknown as FormEvent, true) }}>Save anyway</button>
          </div>
        </div>
      )}

      <Section title="Creator" kanji="人">
        <div className="sm:col-span-2 flex items-center gap-4">
          {photo ? <img src={URL.createObjectURL(photo)} alt="" className="w-16 h-16 rounded-full object-cover" /> : <Avatar name={f.name || '?'} path={existing.data?.photo_path ?? null} size={64} />}
          <label className="btn-ghost h-9 text-sm cursor-pointer">{photo || existing.data?.photo_path ? 'Change photo' : 'Add photo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={e => { const x = e.target.files?.[0]; if (x && x.size <= 3 * 1024 * 1024) setPhoto(x); else if (x) setError('Keep the photo under 3 MB.') }} />
          </label>
        </div>
        <label className="text-sm text-muted sm:col-span-2">Name *<input className="field mt-1.5" value={f.name} onChange={t('name')} autoFocus={!editing} /></label>
        <label className="text-sm text-muted">City<input className="field mt-1.5" value={f.city ?? ''} onChange={t('city')} placeholder="Ranchi" /></label>
        <label className="text-sm text-muted">State<select className="field mt-1.5" value={f.state ?? ''} onChange={e => setF({ ...f, state: e.target.value || null })}><option value="">—</option>{STATES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="text-sm text-muted">Gender<select className="field mt-1.5" value={f.gender ?? ''} onChange={e => setF({ ...f, gender: e.target.value || null })}><option value="">—</option>{GENDERS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}</select></label>
        <label className="text-sm text-muted">Status<select className="field mt-1.5" value={f.status} onChange={t('status')}>{Object.entries(CREATOR_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <div className="sm:col-span-2">
          <p className="text-sm text-muted mb-2">Languages</p>
          <ChipSelect label="Languages" options={[...new Set([...LANGUAGES, ...f.languages])]} value={f.languages} onChange={languages => setF({ ...f, languages })} />
        </div>
        <div className="sm:col-span-2">
          <p className="text-sm text-muted mb-2">Niches</p>
          <ChipSelect label="Niches" options={(niches.data ?? []).map(n => n.id)} value={nicheIds} onChange={setNicheIds} getLabel={x => niches.data?.find(n => n.id === x)?.name ?? x} />
          <div className="flex gap-2 mt-2 max-w-sm">
            <label className="sr-only" htmlFor="nn">New niche</label>
            <input id="nn" className="field h-9" placeholder="New niche…" value={newNiche} onChange={e => setNewNiche(e.target.value)} />
            <button type="button" className="btn-ghost h-9 shrink-0" disabled={!newNiche.trim()} onClick={async () => {
              try { const n = await creatorsApi.addNiche(newNiche); await niches.reload(); setNicheIds([...nicheIds, n.id]); setNewNiche('') } catch (e) { setError(e instanceof Error && e.message.includes('duplicate') ? 'That niche already exists — pick it above.' : 'Could not add the niche') }
            }}>Add</button>
          </div>
        </div>
      </Section>

      <Section title="Contact" kanji="話">
        <label className="text-sm text-muted">Phone<input className="field mt-1.5" type="tel" placeholder="+91" value={f.phone ?? ''} onChange={t('phone')} /></label>
        <div className="text-sm text-muted">
          <label htmlFor="wa">WhatsApp</label>
          <input id="wa" className="field mt-1.5" type="tel" placeholder="+91" disabled={sameWa} value={sameWa ? f.phone ?? '' : f.whatsapp ?? ''} onChange={t('whatsapp')} />
          <label className="flex items-center gap-2 mt-1.5 text-xs"><input type="checkbox" className="accent-[#E3793A]" checked={sameWa} onChange={e => setSameWa(e.target.checked)} /> Same as phone</label>
        </div>
        <label className="text-sm text-muted sm:col-span-2">Email<input className="field mt-1.5" type="email" value={f.email ?? ''} onChange={t('email')} /></label>
        {phoneKey(f.phone) && phoneKey(f.phone)!.length < 10 && <p className="sm:col-span-2 text-xs text-ink">That phone number looks short.</p>}
      </Section>

      <Section title="Manager / agency (if any)" kanji="仲">
        <label className="text-sm text-muted">Agency<input className="field mt-1.5" value={f.manager_agency ?? ''} onChange={t('manager_agency')} /></label>
        <label className="text-sm text-muted">Manager name<input className="field mt-1.5" value={f.manager_name ?? ''} onChange={t('manager_name')} /></label>
        <label className="text-sm text-muted">Manager phone<input className="field mt-1.5" type="tel" value={f.manager_phone ?? ''} onChange={t('manager_phone')} /></label>
        <label className="text-sm text-muted">Manager email<input className="field mt-1.5" type="email" value={f.manager_email ?? ''} onChange={t('manager_email')} /></label>
      </Section>

      {!editing && (
        <Section title="Platforms" kanji="場">
          <p className="sm:col-span-2 text-xs text-muted -mt-2">Numbers can be typed as 48.2K, 1.5L or 1M. More platforms and stats can be added later on the creator’s page.</p>
          {platforms.map((p, i) => (
            <div key={i} className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-[8rem_1fr_7rem_7rem_5.5rem_2.5rem] gap-2 items-end">
              <label className="text-xs text-muted">Platform<select className="field mt-1" value={p.platform} onChange={e => setPlatforms(ps => ps.map((x, j) => j === i ? { ...x, platform: e.target.value } : x))}>{PLATFORMS.map(x => <option key={x} value={x}>{PLATFORM_LABEL[x]}</option>)}</select></label>
              <label className="text-xs text-muted">Handle or URL<input className="field mt-1" value={p.handle} placeholder="@handle" onChange={e => setPlatforms(ps => ps.map((x, j) => j === i ? { ...x, handle: e.target.value } : x))} /></label>
              <label className="text-xs text-muted">{p.platform === 'youtube' ? 'Subscribers' : 'Followers'}<input className="field mt-1 num" value={p.followers} placeholder="48.2K" onChange={e => setPlatforms(ps => ps.map((x, j) => j === i ? { ...x, followers: e.target.value } : x))} /></label>
              <label className="text-xs text-muted">Avg views<input className="field mt-1 num" value={p.avg_views} onChange={e => setPlatforms(ps => ps.map((x, j) => j === i ? { ...x, avg_views: e.target.value } : x))} /></label>
              <label className="text-xs text-muted">ER %<input className="field mt-1 num" value={p.engagement_rate} onChange={e => setPlatforms(ps => ps.map((x, j) => j === i ? { ...x, engagement_rate: e.target.value } : x))} /></label>
              <button type="button" className="icon-btn" aria-label="Remove this platform row" onClick={() => setPlatforms(ps => ps.length > 1 ? ps.filter((_, j) => j !== i) : [blankPlatform()])}><Icon name="close" /></button>
            </div>
          ))}
          <button type="button" className="btn-ghost h-9 sm:col-span-2 justify-self-start" onClick={() => setPlatforms(ps => [...ps, { ...blankPlatform(), platform: PLATFORMS.find(x => !ps.some(p => p.platform === x)) ?? 'instagram' }])}><Icon name="plus" /> Another platform</button>
        </Section>
      )}

      <Section title="Internal" kanji="評">
        <div><p className="text-sm text-muted mb-1.5">Internal rating</p><Stars value={f.rating} onChange={rating => setF({ ...f, rating })} size={22} label="Internal rating" /></div>
        <fieldset><legend className="text-sm text-muted mb-1.5">Would work again?</legend>
          <div className="inline-flex rounded-shoji border border-line/30 p-0.5">
            {([[true, 'Yes'], [false, 'No'], [null, 'Not sure']] as const).map(([v, l]) => (
              <button key={l} type="button" aria-pressed={f.would_work_again === v} onClick={() => setF({ ...f, would_work_again: v })}
                className={`px-3 h-9 rounded-[5px] text-sm ${f.would_work_again === v ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>{l}</button>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2 rounded-shoji border border-line/30 p-3">
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="accent-[#B7282E]" checked={f.is_blacklisted} onChange={e => setF({ ...f, is_blacklisted: e.target.checked })} /> Blacklist this creator</label>
          {f.is_blacklisted && <label className="block text-sm text-muted mt-3">Reason *<input className="field mt-1.5" value={f.blacklist_reason ?? ''} onChange={t('blacklist_reason')} placeholder="What happened, and when" /></label>}
          <p className="text-xs text-muted mt-2">Blacklisted creators are hidden from the list unless “Include blacklisted” is ticked.</p>
        </div>
        <label className="text-sm text-muted sm:col-span-2">Notes<textarea className="field mt-1.5 h-24 py-2" value={f.notes ?? ''} onChange={t('notes')} placeholder="Strengths, quirks, past feedback…" /></label>
      </Section>

      <div className="sticky bottom-20 lg:bottom-4 z-10 flex justify-end gap-2 bg-bg/90 backdrop-blur rounded-shoji p-2 -mx-2">
        <button type="button" className="btn-ghost" onClick={() => nav(editing ? `/creators/${id}` : '/creators')}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add creator'}</button>
      </div>
    </form>
  )
}

function Section({ title, kanji, children }: { title: string; kanji: string; children: ReactNode }) {
  return (
    <fieldset className="shoji shoji-pad">
      <legend className="sr-only">{title}</legend>
      <h2 className="font-mincho text-lg text-ink flex items-baseline gap-2 mb-4" aria-hidden><span className="text-accent-ink text-base" lang="ja">{kanji}</span>{title}</h2>
      <div className="grid sm:grid-cols-2 gap-4">{children}</div>
    </fieldset>
  )
}
