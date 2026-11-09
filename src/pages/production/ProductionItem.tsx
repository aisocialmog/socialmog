import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { productionApi, type ItemInput, type ProductionItem as Item, type ScriptVersion, type Shoot } from '../../data/production'
import { brandsApi } from '../../data/brands'
import { campaignsApi } from '../../data/campaigns'
import { moneyApi } from '../../data/money'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { isStaff } from '../../lib/access'
import { FORMATS, FORMAT_LABEL, plainText, ROLES, ROLE_LABEL, sanitizeScript, STAGES, STAGE_LABEL, type PersonRole, type Stage } from '../../lib/production'
import { PLATFORMS, PLATFORM_LABEL } from '../../lib/creators'
import { describeActivity } from '../../lib/activity'
import { formatDate, formatDateTime, formatINR } from '../../lib/format'
import { Card, EmptyState, SectionTitle } from '../../components/ui/kit'
import { Icon } from '../../components/ui/Icon'

import { Andon, EnsoSpinner, Hanko } from '../../components/art/Ink'
import { BrandChip, Flags } from './ProductionBits'
import { FormError, FormNote } from '../auth/AuthLayout'

const TABS = [{ key: 'overview', label: 'Overview' }, { key: 'people', label: 'People' }, { key: 'script', label: 'Script' }, { key: 'shoot', label: 'Shoot' },
  { key: 'files', label: 'Files' }, { key: 'expenses', label: 'Expenses', staffOnly: true }, { key: 'activity', label: 'Activity' }] as const
type TabKey = (typeof TABS)[number]['key']
const isUrl = (v: string) => !v.trim() || /^https?:\/\/\S+$/i.test(v.trim())

export function ProductionItem() {
  const { id = '' } = useParams()
  const { role } = useAuth()
  const staff = isStaff(role)
  const [params, setParams] = useSearchParams()
  const tabs = TABS.filter(t => !('staffOnly' in t) || staff)
  const tab = (tabs.find(t => t.key === params.get('tab'))?.key ?? 'overview') as TabKey
  const { data: i, loading, reload } = useAsync(() => productionApi.item(id), [id])
  const [error, setError] = useState<string | null>(null)
  const save = async (patch: Parameters<typeof productionApi.update>[1]) => {
    setError(null)
    try { await productionApi.update(id, patch); await reload() }
    catch (e) { const m = e instanceof Error ? e.message : 'Could not save'; setError(m.includes('live_needs_url') ? 'Add the live post link (Files tab) before marking it posted.' : m) }
  }
  if (loading && !i) return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} /></div>
  if (!i) return <div className="shoji"><EmptyState sketch="koi" line="This item isn’t here — or isn’t assigned to you." action={<Link className="btn-ghost" to="/production">Production board</Link>} /></div>
  const stageIdx = STAGES.indexOf(i.stage)

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5 flex-wrap">
        <Link to="/production" className="hover:text-ink">Production</Link><Icon name="chevronRight" className="text-xs" />
        {i.campaign_id && <><Link to={`/campaigns/${i.campaign_id}`} className="hover:text-ink">{i.campaign_name}</Link><Icon name="chevronRight" className="text-xs" /></>}
        <span className="text-ink truncate">{i.title}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <BrandChip color={i.brand_color} name={i.brand_name} />
          <h1 className="font-mincho text-3xl text-ink mt-1 break-words">{i.title}</h1>
          <p className="text-sm text-muted mt-1">{[FORMAT_LABEL[i.format] ?? i.format, i.platform && (PLATFORM_LABEL[i.platform] ?? i.platform), i.target_date && `post ${formatDate(i.target_date)}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="stage">Stage</label>
          <select id="stage" className="field h-10 w-48" value={i.stage} onChange={e => save({ stage: e.target.value as Stage })}>
            {[...STAGES, 'cancelled' as Stage].map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
          {stageIdx >= 0 && stageIdx < STAGES.length - 1 && <button className="btn-primary" onClick={() => save({ stage: STAGES[stageIdx + 1] })}>Move to {STAGE_LABEL[STAGES[stageIdx + 1]]}</button>}
        </div>
      </header>
      {error && <FormError>{error}</FormError>}
      <Flags i={i} />
      {i.over_revision_limit && <p role="alert" className="flex items-center gap-2 rounded-shoji bg-alert text-kinari text-sm px-3 py-2.5"><Andon size={18} />
        {i.revision_count} client revision rounds — the brand’s scope allows {i.revision_limit}. {staff ? 'Bill the extra rounds.' : 'Tell a founder so the extra rounds can be billed.'}</p>}

      <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Pipeline">
        {STAGES.map((s, n) => <li key={s} aria-current={s === i.stage ? 'step' : undefined}
          className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] ${s === i.stage ? 'bg-accent text-sumi' : n < stageIdx ? 'text-ink border border-accent/50' : 'text-muted border border-line/30'}`}>{STAGE_LABEL[s]}</li>)}
      </ol>
      <p className="text-xs text-muted -mt-3 num">In {STAGE_LABEL[i.stage]} for {i.days_in_stage} day{i.days_in_stage === 1 ? '' : 's'} · since {formatDateTime(i.stage_changed_at)}</p>

      <div role="tablist" aria-label="Item sections" className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 border-b border-line/25">
        {tabs.map(t => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => { params.set('tab', t.key); setParams(params, { replace: true }) }}
          className={`relative px-4 h-11 text-sm whitespace-nowrap ${tab === t.key ? 'text-ink' : 'text-muted hover:text-ink'}`}>{t.label}{tab === t.key && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-accent rounded-full" />}</button>)}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && <Overview i={i} staff={staff} save={save} />}
        {tab === 'people' && <People i={i} staff={staff} onChange={reload} />}
        {tab === 'script' && <Script i={i} onChange={reload} save={save} />}
        {tab === 'shoot' && <ShootTab i={i} staff={staff} onChange={reload} />}
        {tab === 'files' && <Files i={i} save={save} onChange={reload} />}
        {tab === 'expenses' && <Expenses id={i.id} />}
        {tab === 'activity' && <Activity id={i.id} title={i.title} key={i.updated_at} />}
      </div>
    </div>
  )
}

function Overview({ i, staff, save }: { i: Item; staff: boolean; save: (p: Parameters<typeof productionApi.update>[1]) => Promise<void> }) {
  const [brief, setBrief] = useState(i.brief ?? '')
  return (
    <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-7 shoji-pad space-y-4">
        <SectionTitle kanji="記">Details</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm text-muted">Format<select className="field mt-1.5" value={i.format} disabled={!staff} onChange={e => save({ deliverable_type: e.target.value })}>{[...new Set([...FORMATS, i.format])].map(f => <option key={f} value={f}>{FORMAT_LABEL[f] ?? f}</option>)}</select></label>
          <label className="text-sm text-muted">Platform<select className="field mt-1.5" value={i.platform ?? ''} onChange={e => save({ platform: e.target.value || null })}><option value="">—</option>{PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></label>
          <label className="text-sm text-muted">Target post date<input type="date" className="field mt-1.5 num" value={i.target_date ?? ''} onChange={e => save({ go_live_date: e.target.value || null })} /></label>
          <label className="text-sm text-muted">Due to client<input type="date" className="field mt-1.5 num" value={i.due_date ?? ''} onChange={e => save({ due_date: e.target.value || null })} /></label>
          <label className="text-sm text-muted">Revision limit (blank = brand’s scope{i.item_revision_limit == null && i.revision_limit != null ? `: ${i.revision_limit}` : ''})
            <input type="number" min="0" className="field mt-1.5 num" disabled={!staff} defaultValue={i.item_revision_limit ?? ''} onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== i.item_revision_limit) save({ revision_limit: v }) }} />
          </label>
          <div className="text-sm text-muted">Client revision rounds<p className={`mt-1.5 text-2xl num ${i.over_revision_limit ? 'text-ink underline decoration-akane decoration-2' : 'text-ink'}`}>{i.revision_count}{i.revision_limit != null && <span className="text-sm text-muted"> / {i.revision_limit}</span>}</p>
            <span className="text-xs">Counts each move into Revisions.</span></div>
        </div>
      </Card>
      <Card className="lg:col-span-5 shoji-pad">
        <SectionTitle kanji="旨">Brief</SectionTitle>
        <label className="sr-only" htmlFor="ibrief">Brief</label>
        <textarea id="ibrief" className="field h-40 py-2" value={brief} onChange={e => setBrief(e.target.value)} onBlur={() => brief !== (i.brief ?? '') && save({ brief: brief.trim() || null })} placeholder="What this piece is, references, must-haves…" />
        <p className="text-xs text-muted mt-2">Internal — never shown on the client calendar.</p>
        {i.campaign_id && <p className="text-sm mt-4"><Link className="text-ink underline underline-offset-4" to={`/campaigns/${i.campaign_id}?tab=brief`}>Campaign brief: {i.campaign_name}</Link></p>}
      </Card>
    </div>
  )
}

function People({ i, staff, onChange }: { i: Item; staff: boolean; onChange: () => Promise<void> }) {
  const { data, reload } = useAsync(() => productionApi.people(i.id), [i.id])
  const opts = useAsync(() => staff ? productionApi.personOptions() : Promise.resolve([]), [staff])
  const [role, setRole] = useState<PersonRole>('editor'), [pick, setPick] = useState('')
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await reload(); await onChange() } catch (e) { setError(e instanceof Error ? (e.message.includes('production_people_unique') ? 'They’re already in that role.' : e.message) : 'Failed') } }
  return (
    <Card className="shoji-pad max-w-3xl">
      <SectionTitle kanji="人">People</SectionTitle>
      {error && <div className="mb-3"><FormError>{error}</FormError></div>}
      <ul className="divide-y divide-line/15 mb-4">
        {ROLES.map(r => {
          const list = (data ?? []).filter(p => p.role === r)
          return <li key={r} className="py-3 grid grid-cols-[9rem_1fr] gap-3 items-start text-sm"><span className="text-muted">{ROLE_LABEL[r]}</span>
            <span className="flex flex-wrap gap-1.5">{list.length ? list.map(p => <span key={p.id} className="pill border border-line/40 text-ink pr-1">{p.name}<span className="text-[10px] text-muted">{p.kind === 'creator' ? 'creator' : p.kind === 'vendor' ? 'vendor' : ''}</span>
              {staff && <button aria-label={`Remove ${p.name} as ${ROLE_LABEL[r]}`} className="w-5 h-5 grid place-items-center rounded-full hover:bg-raised" onClick={() => run(() => productionApi.removePerson(p.id))}><Icon name="close" className="text-[10px]" /></button>}</span>)
              : <span className="text-muted">—</span>}</span></li>
        })}
      </ul>
      {staff && (
        <form className="grid sm:grid-cols-[11rem_1fr_auto] gap-2" onSubmit={e => { e.preventDefault(); const o = opts.data?.find(x => `${x.kind}:${x.id}` === pick); if (o) run(() => productionApi.addPerson(i.id, role, o)).then(() => setPick('')) }}>
          <label className="sr-only" htmlFor="prole">Role</label>
          <select id="prole" className="field" value={role} onChange={e => setRole(e.target.value as PersonRole)}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          <label className="sr-only" htmlFor="pwho">Person</label>
          <select id="pwho" className="field" value={pick} onChange={e => setPick(e.target.value)}><option value="">Choose a team member, freelancer, vendor or creator…</option>
            {(['team', 'vendor', 'creator'] as const).map(k => <optgroup key={k} label={k === 'team' ? 'Team & freelancers' : k === 'vendor' ? 'Vendors' : 'Creators'}>
              {(opts.data ?? []).filter(o => o.kind === k).map(o => <option key={o.id} value={`${o.kind}:${o.id}`}>{o.name} · {o.hint}</option>)}</optgroup>)}
          </select>
          <button className="btn-primary" disabled={!pick}><Icon name="plus" /> Add</button>
        </form>
      )}
      <p className="text-xs text-muted mt-3">Team members and freelancers named here see this item and find it in “My work”.</p>
    </Card>
  )
}

// ─── Script: rich text, versions, comments per version ───────
function RichEditor({ initial, onChange }: { initial: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.innerHTML = sanitizeScript(initial) }, [initial])
  const cmd = (c: string, v?: string) => { ref.current?.focus(); document.execCommand(c, false, v); onChange(ref.current?.innerHTML ?? '') }
  const B = ({ c, v, label, children }: { c: string; v?: string; label: string; children: React.ReactNode }) =>
    <button type="button" className="icon-btn w-9 h-9 text-sm" aria-label={label} onMouseDown={e => e.preventDefault()} onClick={() => cmd(c, v)}>{children}</button>
  return (
    <div className="rounded-shoji border border-line/40 bg-bg">
      <div className="flex flex-wrap gap-0.5 border-b border-line/30 p-1" role="toolbar" aria-label="Formatting">
        <B c="bold" label="Bold"><strong>B</strong></B><B c="italic" label="Italic"><em>I</em></B><B c="underline" label="Underline"><u>U</u></B>
        <B c="formatBlock" v="h3" label="Heading">H</B><B c="formatBlock" v="p" label="Paragraph">¶</B>
        <B c="insertUnorderedList" label="Bullet list">•</B><B c="insertOrderedList" label="Numbered list">1.</B>
      </div>
      <div ref={ref} contentEditable role="textbox" aria-multiline="true" aria-label="Script" suppressContentEditableWarning
        className="script-body min-h-[16rem] p-4 text-sm text-ink focus:outline-none" onInput={e => onChange((e.target as HTMLDivElement).innerHTML)} />
    </div>
  )
}

function Script({ i, onChange, save }: { i: Item; onChange: () => Promise<void>; save: (p: Parameters<typeof productionApi.update>[1]) => Promise<void> }) {
  const { data, reload } = useAsync(() => productionApi.scripts(i.id), [i.id])
  const versions = data ?? []
  const [sel, setSel] = useState<string | null>(null)
  const current = versions.find(v => v.id === sel) ?? versions[0]
  const comments = useAsync(() => productionApi.comments(versions.map(v => v.id)), [data])
  const [editing, setEditing] = useState(false)
  const [html, setHtml] = useState('')
  const [c, setC] = useState({ body: '', client: true, author: '' })
  const [error, setError] = useState<string | null>(null)
  const latest = versions[0]
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await reload(); await comments.reload(); await onChange() } catch (e) { setError(e instanceof Error ? e.message : 'Failed') } }
  const STATUS: Record<ScriptVersion['status'], string> = { draft: 'Draft', in_review: 'With client', approved: 'Approved', rejected: 'Changes asked' }

  if (editing) return (
    <div className="space-y-3 max-w-4xl">
      {error && <FormError>{error}</FormError>}
      <RichEditor initial={latest?.body ?? ''} onChange={setHtml} />
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
        {latest && latest.status === 'draft' && <button className="btn-ghost" onClick={() => run(async () => { await productionApi.saveScript(i.id, sanitizeScript(html || latest.body), false, latest); setEditing(false) })}>Update v{latest.version}</button>}
        <button className="btn-primary" onClick={() => run(async () => { await productionApi.saveScript(i.id, sanitizeScript(html || latest?.body || ''), true, latest); setEditing(false); setSel(null) })}>Save as v{(latest?.version ?? 0) + 1}</button>
      </div>
      <p className="text-xs text-muted">Each saved version is kept, with its own comments. Drafts can be updated in place until they’re sent.</p>
    </div>
  )
  return (
    <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-8 shoji-pad">
        <SectionTitle kanji="筆" aside={<button className="btn-primary h-9" onClick={() => { setHtml(''); setEditing(true) }}>{latest ? 'Write a new version' : 'Write the script'}</button>}>
          Script{current && <span className="text-sm text-muted font-sans ml-2">v{current.version} · {STATUS[current.status]}</span>}</SectionTitle>
        {error && <div className="mb-3"><FormError>{error}</FormError></div>}
        {!current ? <EmptyState sketch="branch" line="No script yet." /> : <>
          <div className="script-body text-sm text-ink" dangerouslySetInnerHTML={{ __html: sanitizeScript(current.body) }} />
          <div className="flex flex-wrap gap-2 mt-5 items-center">
            {current.status === 'approved' ? <Hanko kind="approved" size={40} animate={false} /> : <>
              <button className="btn-ghost h-9" onClick={() => run(() => productionApi.setScriptStatus(current.id, 'in_review'))}>Sent to client</button>
              <button className="btn-ghost h-9" onClick={() => run(async () => { await productionApi.setScriptStatus(current.id, 'approved'); if (['idea', 'script'].includes(i.stage)) await save({ stage: 'script_approved' }) })}>Client approved</button>
              <button className="btn-ghost h-9" onClick={() => run(() => productionApi.setScriptStatus(current.id, 'rejected'))}>Client asked for changes</button>
            </>}
          </div>
        </>}
      </Card>
      <div className="lg:col-span-4 space-y-4">
        <Card className="shoji-pad">
          <SectionTitle kanji="版">Versions</SectionTitle>
          {versions.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
            <ul className="space-y-1">{versions.map(v => <li key={v.id}><button onClick={() => setSel(v.id)} className={`w-full text-left rounded-shoji px-3 py-2 text-sm ${current?.id === v.id ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>
              v{v.version} · {STATUS[v.status]}<span className="block text-[11px] num">{formatDate(v.created_at)} · {(comments.data ?? []).filter(x => x.script_id === v.id).length} comments</span><span className="block text-[11px] truncate">{plainText(v.body).slice(0, 60)}</span></button></li>)}</ul>
          )}
        </Card>
        {current && (
          <Card className="shoji-pad">
            <SectionTitle kanji="評">Comments on v{current.version}</SectionTitle>
            <ul className="space-y-3 mb-4">{(comments.data ?? []).filter(x => x.script_id === current.id).map(x => (
              <li key={x.id} className={`text-sm rounded-shoji border px-3 py-2 ${x.from_client ? 'border-accent/60' : 'border-line/30'} ${x.is_resolved ? 'opacity-60' : ''}`}>
                <p className="text-[11px] text-muted">{x.from_client ? `Client${x.author_name ? ` · ${x.author_name}` : ''}` : 'Team'} · {formatDate(x.created_at)}</p>
                <p className="text-ink whitespace-pre-line">{x.body}</p>
                <button className="text-[11px] text-muted underline underline-offset-4" onClick={() => run(() => productionApi.resolveComment(x.id, !x.is_resolved))}>{x.is_resolved ? 'Reopen' : 'Mark resolved'}</button>
              </li>))}
              {(comments.data ?? []).filter(x => x.script_id === current.id).length === 0 && <li className="text-sm text-muted">No comments on this version.</li>}
            </ul>
            <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (c.body.trim()) run(() => productionApi.addComment(current.id, c.body.trim(), c.client, c.client ? c.author.trim() || null : null)).then(() => setC({ ...c, body: '' })) }}>
              <label className="sr-only" htmlFor="sc-body">Comment</label>
              <textarea id="sc-body" className="field h-20 py-2" value={c.body} onChange={e => setC({ ...c, body: e.target.value })} placeholder={c.client ? 'Paste or note the client’s feedback…' : 'Note for the team…'} />
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted flex items-center gap-1.5"><input type="checkbox" className="accent-[#E3793A]" checked={c.client} onChange={e => setC({ ...c, client: e.target.checked })} /> From the client</label>
                {c.client && <><label className="sr-only" htmlFor="sc-author">Client name</label><input id="sc-author" className="field h-8 text-xs flex-1 min-w-[8rem]" placeholder="Who (e.g. Priya)" value={c.author} onChange={e => setC({ ...c, author: e.target.value })} /></>}
                <button className="btn-ghost h-8 text-xs ml-auto" disabled={!c.body.trim()}>Add comment</button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}

// ─── Shoot ───────────────────────────────────────────────────
function ShootTab({ i, staff, onChange }: { i: Item; staff: boolean; onChange: () => Promise<void> }) {
  const shoot = useAsync(() => i.shoot_id ? productionApi.shoot(i.shoot_id) : Promise.resolve(null), [i.shoot_id])
  const [editing, setEditing] = useState(false)
  const s = shoot.data
  if (shoot.loading) return <EnsoSpinner />
  if (editing || (!s && staff && editing)) return <ShootForm i={i} s={s} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await shoot.reload(); await onChange() }} />
  if (!s) return <div className="shoji"><EmptyState sketch="fuji" line="No shoot planned for this item." action={staff && <button className="btn-primary" onClick={() => setEditing(true)}><Icon name="plus" /> Plan the shoot</button>} /></div>
  return (
    <Card className="shoji-pad max-w-3xl">
      <SectionTitle kanji="撮" aside={staff && <button className="text-sm text-muted hover:text-ink" onClick={() => setEditing(true)}>Edit</button>}>{s.title}</SectionTitle>
      <dl className="grid sm:grid-cols-2 gap-4 text-sm">
        <div><dt className="text-xs text-muted">Date</dt><dd className="text-ink num text-lg">{formatDate(s.shoot_date)}</dd></div>
        <div><dt className="text-xs text-muted">Time</dt><dd className="text-ink num text-lg">{s.call_time ? s.call_time.slice(0, 5) : '—'}{s.wrap_time ? ` – ${s.wrap_time.slice(0, 5)}` : ''}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs text-muted">Location</dt><dd className="text-ink">{s.location ?? '—'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs text-muted mb-1">Equipment</dt><dd className="flex flex-wrap gap-1.5">{s.equipment.length ? s.equipment.map(e => <span key={e} className="pill border border-line/40 text-ink">{e}</span>) : '—'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs text-muted">Call sheet notes</dt><dd className="text-ink whitespace-pre-line">{s.call_sheet_notes ?? '—'}</dd></div>
        {(s.items?.length ?? 0) > 1 && <div className="sm:col-span-2"><dt className="text-xs text-muted">Also shot that day</dt><dd className="text-ink">{s.items!.filter(t => t !== i.title).join(', ')}</dd></div>}
      </dl>
    </Card>
  )
}
function ShootForm({ i, s, onClose, onSaved }: { i: Item; s: Shoot | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: s?.title ?? `${i.title} — shoot`, shoot_date: s?.shoot_date ?? '', call_time: s?.call_time?.slice(0, 5) ?? '', wrap_time: s?.wrap_time?.slice(0, 5) ?? '',
    location: s?.location ?? '', equipment: s?.equipment.join('\n') ?? '', call_sheet_notes: s?.call_sheet_notes ?? '', status: s?.status ?? 'planned' })
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="shoji shoji-pad grid sm:grid-cols-2 gap-4 max-w-3xl" onSubmit={async e => {
      e.preventDefault(); if (!f.shoot_date) { setError('Pick the shoot date.'); return }
      try { await productionApi.saveShoot(i, { title: f.title.trim() || 'Shoot', shoot_date: f.shoot_date, call_time: f.call_time || null, wrap_time: f.wrap_time || null, location: f.location.trim() || null,
        equipment: f.equipment.split('\n').map(x => x.trim()).filter(Boolean), call_sheet_notes: f.call_sheet_notes.trim() || null, status: f.status }, s?.id); onSaved() }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not save') }
    }}>
      {error && <div className="sm:col-span-2"><FormError>{error}</FormError></div>}
      <label className="sm:col-span-2 text-sm text-muted">Title<input className="field mt-1.5" value={f.title} onChange={set('title')} /></label>
      <label className="text-sm text-muted">Date *<input type="date" className="field mt-1.5 num" value={f.shoot_date} onChange={set('shoot_date')} /></label>
      <label className="text-sm text-muted">Status<select className="field mt-1.5" value={f.status} onChange={set('status')}>{['planned', 'confirmed', 'done', 'rescheduled', 'cancelled'].map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select></label>
      <label className="text-sm text-muted">Call time<input type="time" className="field mt-1.5 num" value={f.call_time} onChange={set('call_time')} /></label>
      <label className="text-sm text-muted">Wrap time<input type="time" className="field mt-1.5 num" value={f.wrap_time} onChange={set('wrap_time')} /></label>
      <label className="sm:col-span-2 text-sm text-muted">Location<input className="field mt-1.5" value={f.location} onChange={set('location')} /></label>
      <label className="text-sm text-muted">Equipment (one per line)<textarea className="field mt-1.5 h-28 py-2" value={f.equipment} onChange={set('equipment')} placeholder={'FX3\n2 × LED panels\nGimbal'} /></label>
      <label className="text-sm text-muted">Call sheet notes<textarea className="field mt-1.5 h-28 py-2" value={f.call_sheet_notes} onChange={set('call_sheet_notes')} placeholder="Arrival, contacts, parking, food…" /></label>
      <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Save shoot</button></div>
    </form>
  )
}

// ─── Files (links) ───────────────────────────────────────────
function Files({ i, save, onChange }: { i: Item; save: (p: Parameters<typeof productionApi.update>[1]) => Promise<void>; onChange: () => Promise<void> }) {
  const edits = useAsync(() => productionApi.edits(i.id), [i.id])
  const [e, setE] = useState({ url: '', notes: '' })
  const [error, setError] = useState<string | null>(null)
  const Link1 = ({ label, field, value }: { label: string; field: 'raw_footage_url' | 'final_file_url' | 'thumbnail_url' | 'live_url'; value: string | null }) => {
    const [v, setV] = useState(value ?? '')
    return <label className="text-sm text-muted">{label}<span className="flex gap-1.5 mt-1.5">
      <input className={`field ${!isUrl(v) ? 'border-akane ring-1 ring-akane' : ''}`} value={v} placeholder="https://drive.google.com/…" onChange={x => setV(x.target.value)}
        onBlur={() => { if (isUrl(v) && v.trim() !== (value ?? '')) save({ [field]: v.trim() || null }) }} />
      {value && <a className="icon-btn shrink-0" href={value} target="_blank" rel="noreferrer" aria-label={`Open ${label}`}><Icon name="link" /></a>}</span></label>
  }
  return (
    <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-6 shoji-pad space-y-4">
        <SectionTitle kanji="素">Links</SectionTitle>
        <Link1 label="Raw footage (Google Drive)" field="raw_footage_url" value={i.raw_footage_url} />
        <Link1 label="Final file" field="final_file_url" value={i.final_file_url} />
        <Link1 label="Thumbnail" field="thumbnail_url" value={i.thumbnail_url} />
        <Link1 label="Live post" field="live_url" value={i.live_url} />
        {i.thumbnail_url && /\.(png|jpe?g|webp)(\?|$)/i.test(i.thumbnail_url) && <img src={i.thumbnail_url} alt="Thumbnail" className="rounded-shoji max-h-40" />}
      </Card>
      <Card className="lg:col-span-6 shoji-pad">
        <SectionTitle kanji="編">Edit versions</SectionTitle>
        {error && <div className="mb-3"><FormError>{error}</FormError></div>}
        <ul className="divide-y divide-line/15 mb-4">{(edits.data ?? []).map(x => <li key={x.id} className="py-2.5 text-sm flex gap-3">
          <span className="font-mincho text-accent-ink w-8">v{x.version}</span><span className="flex-1 min-w-0"><a className="text-ink hover:underline underline-offset-4 break-all" href={x.url} target="_blank" rel="noreferrer">{x.url.replace(/^https?:\/\//, '')}</a>
            <span className="block text-xs text-muted">{[x.notes, formatDate(x.created_at)].filter(Boolean).join(' · ')}</span></span></li>)}
          {(edits.data ?? []).length === 0 && <li className="py-2 text-sm text-muted">No edits yet.</li>}</ul>
        <form className="grid gap-2" onSubmit={async ev => {
          ev.preventDefault(); setError(null)
          if (!/^https?:\/\/\S+$/i.test(e.url.trim())) { setError('Paste the link to the edit (Drive, Frame.io, Dropbox…).'); return }
          try { await productionApi.addEdit(i.id, ((edits.data ?? [])[0]?.version ?? 0) + 1, e.url.trim(), e.notes.trim() || null); setE({ url: '', notes: '' }); await edits.reload(); await onChange() }
          catch (err) { setError(err instanceof Error ? err.message : 'Could not add') }
        }}>
          <label className="sr-only" htmlFor="ev-url">Edit link</label><input id="ev-url" className="field" placeholder={`Link to v${((edits.data ?? [])[0]?.version ?? 0) + 1}`} value={e.url} onChange={x => setE({ ...e, url: x.target.value })} />
          <label className="sr-only" htmlFor="ev-notes">Notes</label><input id="ev-notes" className="field" placeholder="What changed (optional)" value={e.notes} onChange={x => setE({ ...e, notes: x.target.value })} />
          <button className="btn-primary justify-self-start"><Icon name="plus" /> Add edit version</button>
        </form>
        <p className="text-xs text-muted mt-3">The newest edit also becomes the draft link on the campaign tracker.</p>
      </Card>
    </div>
  )
}

function Expenses({ id }: { id: string }) {
  const { data, loading } = useAsync(() => moneyApi.expensesFor({ deliverable_id: id }), [id])
  const pays = useAsync(() => moneyApi.payouts().then(l => l.filter(p => p.deliverable_id === id && (p.status === 'pending' || p.status === 'approved'))), [id])
  if (loading) return <EnsoSpinner />
  const total = (data ?? []).reduce((s, x) => s + Number(x.amount), 0)
  return (
    <Card className="shoji-pad max-w-3xl">
      <SectionTitle kanji="金" aside={<Link className="btn-ghost h-9" to={`/money/expenses?new=1&item=${id}`}><Icon name="plus" /> Add expense</Link>}>Production expenses</SectionTitle>
      {!(data ?? []).length ? <p className="text-sm text-muted">No expenses linked — ₹0. Location, props, travel and paid freelancer fees show here.</p> : <>
        <ul className="divide-y divide-line/15">{data!.map(x => <li key={x.id}><Link to={`/money/expenses/${x.id}`} className="py-2.5 flex justify-between gap-3 text-sm hover:bg-raised/40"><span className="text-ink">{x.description}<span className="block text-xs text-muted num">{formatDate(x.expense_date)} · {x.category_name} · {x.status === 'paid' ? 'paid' : 'unpaid'}</span></span><span className="num text-ink">{formatINR(x.amount)}</span></Link></li>)}</ul>
        <p className="text-sm text-right mt-3 num">Total before GST <span className="text-ink">{formatINR(total)}</span></p></>}
      {(pays.data ?? []).length > 0 && <p className="text-sm text-muted mt-4">Still to pay: {(pays.data ?? []).map(p => <Link key={p.id} className="underline underline-offset-4 mr-2" to={`/money/payouts/${p.id}`}>{p.payee_name} {formatINR(p.gross)}</Link>)}</p>}
    </Card>
  )
}

function Activity({ id, title }: { id: string; title: string }) {
  const { data, loading } = useAsync(() => productionApi.activity(id), [id])
  const rows = useMemo(() => (data ?? []).map(e => ({ e, d: describeActivity(e, { [id]: title }) })).filter(r => r.d.text), [data, id, title])
  if (loading) return <EnsoSpinner />
  if (!rows.length) return <div className="shoji"><EmptyState line="No history yet." /></div>
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="歴">History</SectionTitle>
      <ol className="relative ml-1.5 border-l border-line/30 space-y-5">
        {rows.map(({ e, d }) => <li key={e.id} className="pl-5 relative"><span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-card ${d.kind === 'status' ? 'bg-kaki' : 'bg-hai'}`} aria-hidden />
          <p className="text-sm text-ink"><span className="font-medium">{e.actor_name}</span> {d.text}</p><p className="text-xs text-muted mt-0.5 num">{formatDateTime(e.created_at)}</p></li>)}
      </ol>
    </Card>
  )
}

// ─── New item form ───────────────────────────────────────────
export function ProductionForm() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { member } = useAuth()
  const brands = useAsync(() => brandsApi.list(false), [])
  const camps = useAsync(() => campaignsApi.list(false), [])
  const [f, setF] = useState<ItemInput>({ title: '', brand_id: params.get('brand') ?? '', campaign_id: params.get('campaign'), deliverable_type: 'reel', platform: 'instagram',
    go_live_date: params.get('date'), due_date: null, assignee_id: member?.id ?? null, brief: null, revision_limit: null })
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof ItemInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value || null })
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.title.trim() || !f.brand_id) { setError('Add a title and pick the brand.'); return }
    try { nav(`/production/${await productionApi.create({ ...f, title: f.title.trim() })}`, { replace: true }) } catch (err) { setError(err instanceof Error ? err.message : 'Could not save') }
  }
  return (
    <form onSubmit={submit} className="space-y-6 max-w-2xl">
      <h1 className="font-mincho text-3xl text-ink">New production item</h1>
      {error && <FormError>{error}</FormError>}
      <div className="shoji shoji-pad grid sm:grid-cols-2 gap-4">
        <label className="sm:col-span-2 text-sm text-muted">Title *<input className="field mt-1.5" autoFocus value={f.title} onChange={set('title')} /></label>
        <label className="text-sm text-muted">Brand *<select className="field mt-1.5" value={f.brand_id} onChange={e => setF({ ...f, brand_id: e.target.value, campaign_id: null })}><option value="">Choose…</option>{brands.data?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="text-sm text-muted">Campaign (optional)<select className="field mt-1.5" value={f.campaign_id ?? ''} onChange={set('campaign_id')}><option value="">None — production only</option>
          {camps.data?.filter(c => c.brand_id === f.brand_id).map(c => <option key={c.campaign_id} value={c.campaign_id}>{c.name}</option>)}</select></label>
        <label className="text-sm text-muted">Format<select className="field mt-1.5" value={f.deliverable_type} onChange={set('deliverable_type')}>{FORMATS.map(x => <option key={x} value={x}>{FORMAT_LABEL[x]}</option>)}</select></label>
        <label className="text-sm text-muted">Platform<select className="field mt-1.5" value={f.platform ?? ''} onChange={set('platform')}><option value="">—</option>{PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></label>
        <label className="text-sm text-muted">Target post date<input type="date" className="field mt-1.5 num" value={f.go_live_date ?? ''} onChange={set('go_live_date')} /></label>
        <label className="text-sm text-muted">Due to client<input type="date" className="field mt-1.5 num" value={f.due_date ?? ''} onChange={set('due_date')} /></label>
        <label className="sm:col-span-2 text-sm text-muted">Brief<textarea className="field mt-1.5 h-24 py-2" value={f.brief ?? ''} onChange={set('brief')} /></label>
      </div>
      <FormNote>It starts at Idea. Add people, the script and the shoot on the item page.</FormNote>
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => nav('/production')}>Cancel</button><button className="btn-primary">Create item</button></div>
    </form>
  )
}
