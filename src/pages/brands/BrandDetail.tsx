import { useMemo, useRef, useState, type FormEvent } from 'react'
import { AiRecordTools } from '../../components/work/Ai'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { moneyApi } from '../../data/money'
import { PAY_STATUS_LABEL, PAY_STATUS_TONE } from '../../lib/money'
import { brandsApi, type BrandOverview, type Contact, type ContactInput } from '../../data/brands'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { isStaff } from '../../lib/access'
import { BRAND_STATUSES, ENGAGEMENT_LABEL, FILE_KINDS, formatBytes, instagramUrl, STATUS_LABEL, STATUS_TONE, youtubeUrl, type BrandFileKind } from '../../lib/brands'
import { describeActivity, type ActivityKind } from '../../lib/activity'
import { formatDate, formatDateTime, formatINR, istToday } from '../../lib/format'
import { downloadCSV } from '../../lib/csv'
import { Card, EmptyState, MoreMenu, Pill, SectionTitle } from '../../components/ui/kit'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Avatar } from '../../components/ui/Avatar'
import { BrushDivider, EnsoSpinner, Hanko } from '../../components/art/Ink'
import { BrandLogo, RenewalWarning } from '../../components/brands/BrandBits'
import { FormError } from '../auth/AuthLayout'

const TABS = [
  { key: 'overview', label: 'Overview' }, { key: 'contacts', label: 'Contacts' }, { key: 'campaigns', label: 'Campaigns' },
  { key: 'production', label: 'Production' }, { key: 'money', label: 'Invoices & Payments', staffOnly: true },
  { key: 'files', label: 'Files' }, { key: 'activity', label: 'Activity' },
] as const
type TabKey = (typeof TABS)[number]['key']

export function BrandDetail() {
  const { id = '' } = useParams()
  const { role } = useAuth()
  const money = isStaff(role)
  const [params, setParams] = useSearchParams()
  const tabs = TABS.filter(t => !('staffOnly' in t) || money)
  const tab = (tabs.find(t => t.key === params.get('tab'))?.key ?? 'overview') as TabKey
  const setTab = (t: TabKey) => { params.set('tab', t); setParams(params, { replace: true }) }

  const brand = useAsync(() => brandsApi.get(id), [id])
  const contacts = useAsync(() => brandsApi.contacts(id), [id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const b = brand.data
  if (brand.loading && !b) return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} label="Loading brand" /></div>
  if (!b) return <div className="shoji"><EmptyState sketch="koi" line="This brand isn’t here — it may be archived or not yours to see." action={<Link to="/brands" className="btn-ghost">Back to brands</Link>} /></div>

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await fn(); await brand.reload() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
        <Link to="/brands" className="hover:text-ink">Brands</Link><Icon name="chevronRight" className="text-xs" /><span className="text-ink truncate">{b.name}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <BrandLogo name={b.name} path={b.logo_path} size={56} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="font-mincho text-3xl text-ink break-words">{b.name}</h1>
              <Pill tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Pill>
              {b.is_archived && <Pill tone="ink">Archived</Pill>}
            </div>
            <p className="text-sm text-muted mt-1">{[ENGAGEMENT_LABEL[b.engagement_type], b.industry, b.city].filter(Boolean).join(' · ')}</p>
            <p className="text-sm text-muted mt-1 flex items-center gap-2">
              {b.owner_name ? <><Avatar name={b.owner_name} path={b.owner_photo_path} size={20} /> Handled by <span className="text-ink">{b.owner_name}</span></> : 'No owner yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link to={`/brands/${b.id}/edit`} className="btn-primary"><Icon name="edit" /> Edit brand</Link>
          <AiRecordTools kind="brand" id={id} />
          <MoreMenu items={[
            ...BRAND_STATUSES.filter(s => s !== b.status).map(s => ({ label: `Move to ${STATUS_LABEL[s]}`, onSelect: () => act(() => brandsApi.setStatus(b.id, s)) })),
            b.is_archived
              ? { label: 'Restore brand', onSelect: () => act(() => brandsApi.setArchived(b.id, false)) }
              : { label: 'Archive brand', danger: true, onSelect: () => { if (confirm(`Archive ${b.name}? It leaves the lists but nothing is deleted — you can restore it from “Show archived brands”.`)) act(() => brandsApi.setArchived(b.id, true)) } },
          ]} />
        </div>
      </header>

      {error && <FormError>{error}</FormError>}
      {busy && <p className="sr-only" role="status">Saving…</p>}
      {b.renewal_warning && <RenewalWarning renewalDate={b.renewal_date} days={b.days_to_renewal} />}

      {money && (
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-shoji overflow-hidden border border-line/30 bg-line/20">
          <Stat label="Lifetime revenue" value={formatINR(b.lifetime_revenue)} hint="Invoiced, before GST" />
          <Stat label="Outstanding" value={formatINR(b.outstanding)} alert={Number(b.overdue) > 0 ? `${formatINR(b.overdue)} overdue` : undefined} />
          <Stat label="Active campaigns" value={`${b.active_campaigns}`} hint={`${b.total_campaigns} in total`} />
          <Stat label="Retainer" value={b.monthly_fee ? `${formatINR(b.monthly_fee)}/mo` : '—'} hint={b.renewal_date ? `Renews ${formatDate(b.renewal_date)}` : undefined} />
        </dl>
      )}
      {money && b.historical_campaigns > 0 && (
        <p className="text-sm text-muted -mt-3">Before go-live: <span className="num text-ink">{formatINR(b.historical_revenue)}</span> across <span className="num">{b.historical_campaigns}</span> past campaign{b.historical_campaigns === 1 ? '' : 's'} (history — not in money reports)</p>
      )}

      <div role="tablist" aria-label="Brand sections" className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 border-b border-line/25">
        {tabs.map(t => (
          <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls="brand-panel" onClick={() => setTab(t.key)}
            className={`relative px-4 h-11 text-sm whitespace-nowrap transition-colors duration-calm ${tab === t.key ? 'text-ink' : 'text-muted hover:text-ink'}`}>
            {t.label}{t.key === 'contacts' && contacts.data ? <span className="ml-1.5 text-xs text-muted num">{contacts.data.filter(c => !c.is_archived).length}</span> : null}
            {tab === t.key && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-accent rounded-full" />}
          </button>
        ))}
      </div>

      <div id="brand-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <Overview b={b} money={money} contacts={contacts.data ?? []} onNotes={n => act(() => brandsApi.setNotes(b.id, n))} goContacts={() => setTab('contacts')} />}
        {tab === 'contacts' && <Contacts brandId={b.id} list={contacts.data} reload={async () => { await contacts.reload(); await brand.reload() }} />}
        {tab === 'campaigns' && <Campaigns brandId={b.id} money={money} />}
        {tab === 'production' && <Production brandId={b.id} />}
        {tab === 'money' && money && <Money brandId={b.id} />}
        {tab === 'files' && <Files brandId={b.id} />}
        {tab === 'activity' && <Activity b={b} contacts={contacts.data ?? []} />}
      </div>
    </div>
  )
}

function Stat({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: string }) {
  return (
    <div className="bg-card px-5 py-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1.5 text-xl text-ink num">{value}</dd>
      {hint && <dd className="text-xs text-muted mt-1">{hint}</dd>}
      {alert && <dd className="mt-2"><Pill tone="alert">{alert}</Pill></dd>}
    </div>
  )
}

// ─── Overview ────────────────────────────────────────────────
function Overview({ b, money, contacts, onNotes, goContacts }: { b: BrandOverview; money: boolean; contacts: Contact[]; onNotes: (n: string | null) => Promise<void>; goContacts: () => void }) {
  const retainer = useAsync(() => money ? brandsApi.retainer(b.id) : Promise.resolve(null), [b.id, b.updated_at, money])
  const [editingNotes, setEditingNotes] = useState(false)
  const [notes, setNotes] = useState(b.notes ?? '')
  const primary = contacts.find(c => c.is_primary && !c.is_archived)
  const r = retainer.data

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
      <Card className="lg:col-span-7 shoji-pad">
        <SectionTitle kanji="記">Details</SectionTitle>
        <dl className="space-y-3 text-sm">
          {([
            ['Billing name', b.billing_name], ['GSTIN', b.gstin], ['State', b.state ? `${b.state}${b.state_code ? ` (${b.state_code})` : ''}` : null],
            ['City', b.city], ['Billing address', b.billing_address], ['Payment terms', b.payment_terms_days != null ? `${b.payment_terms_days} days` : 'Default'],
            ['Lead source', b.source], ['Added', formatDate(b.created_at)],
          ] as [string, string | null][]).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3"><dt className="text-muted">{k}</dt><dd className="text-ink break-words whitespace-pre-line num">{v || <span className="text-muted">—</span>}</dd></div>
          ))}
          <div className="grid grid-cols-[8.5rem_1fr] gap-3"><dt className="text-muted">Online</dt>
            <dd className="text-ink space-y-1">
              {b.website && <a className="flex items-center gap-1.5 hover:underline underline-offset-4 break-all" href={b.website} target="_blank" rel="noreferrer"><Icon name="link" className="text-muted shrink-0" />{b.website.replace(/^https?:\/\//, '')}</a>}
              {b.instagram_handle && <a className="block hover:underline underline-offset-4" href={instagramUrl(b.instagram_handle)} target="_blank" rel="noreferrer">Instagram @{b.instagram_handle}</a>}
              {b.youtube_handle && <a className="block hover:underline underline-offset-4" href={youtubeUrl(b.youtube_handle)} target="_blank" rel="noreferrer">YouTube {b.youtube_handle}</a>}
              {!b.website && !b.instagram_handle && !b.youtube_handle && <span className="text-muted">—</span>}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="lg:col-span-5 space-y-4 sm:space-y-6">
        {money && (r || b.engagement_type === 'full_marketing' || b.engagement_type === 'mixed') && (
          <Card className="shoji-pad">
            <SectionTitle kanji="約">Retainer</SectionTitle>
            {r ? <>
              <p className="font-mincho text-3xl text-accent-ink num">{formatINR(r.monthly_fee)}<span className="text-base text-muted"> / month</span></p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted">Started</dt><dd className="text-ink num">{formatDate(r.start_date)}</dd></div>
                <div><dt className="text-xs text-muted">Billing day</dt><dd className="text-ink num">{r.billing_day ? `${r.billing_day} of each month` : '—'}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-muted">Renewal</dt><dd className="text-ink num">{r.renewal_date ? formatDate(r.renewal_date) : 'Not set'}</dd></div>
              </dl>
              {r.scope && <><BrushDivider className="my-4" /><p className="text-xs text-muted mb-1">Scope of work</p><p className="text-sm text-ink whitespace-pre-line">{r.scope}</p></>}
            </> : <p className="text-sm text-muted">No retainer set yet. <Link to={`/brands/${b.id}/edit`} className="underline underline-offset-4 hover:text-ink">Add the monthly fee</Link>.</p>}
          </Card>
        )}

        <Card className="shoji-pad">
          <SectionTitle kanji="人" aside={<button className="text-sm text-muted hover:text-ink" onClick={goContacts}>All contacts</button>}>Primary contact</SectionTitle>
          {primary ? <ContactLines c={primary} /> : <p className="text-sm text-muted">No contacts yet. <button className="underline underline-offset-4 hover:text-ink" onClick={goContacts}>Add one</button>.</p>}
        </Card>

        <Card className="shoji-pad">
          <SectionTitle kanji="筆" aside={!editingNotes && <button className="text-sm text-muted hover:text-ink" onClick={() => { setNotes(b.notes ?? ''); setEditingNotes(true) }}>Edit</button>}>Notes</SectionTitle>
          {editingNotes ? (
            <form onSubmit={async e => { e.preventDefault(); await onNotes(notes.trim() || null); setEditingNotes(false) }} className="space-y-3">
              <label className="sr-only" htmlFor="notes">Notes</label>
              <textarea id="notes" className="field h-36 py-2" value={notes} onChange={e => setNotes(e.target.value)} autoFocus />
              <div className="flex justify-end gap-2"><button type="button" className="btn-ghost h-9" onClick={() => setEditingNotes(false)}>Cancel</button><button className="btn-primary h-9">Save notes</button></div>
            </form>
          ) : b.notes ? <p className="text-sm text-ink whitespace-pre-line">{b.notes}</p> : <p className="text-sm text-muted">Nothing noted yet.</p>}
        </Card>
      </div>
    </div>
  )
}

const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, '').replace(/^0+/, '').replace(/^(?!91)(\d{10})$/, '91$1')}`

function ContactLines({ c }: { c: Contact }) {
  return (
    <div className="flex items-start gap-3">
      <Avatar name={c.name} size={40} />
      <div className="min-w-0 text-sm space-y-1">
        <p className="text-ink">{c.name}</p>
        {c.designation && <p className="text-xs text-muted">{c.designation}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          {c.phone && <a className="inline-flex items-center gap-1.5 text-muted hover:text-ink" href={`tel:${c.phone.replace(/\s/g, '')}`}><Icon name="phone" />{c.phone}</a>}
          {c.whatsapp && <a className="inline-flex items-center gap-1.5 text-muted hover:text-ink" href={waLink(c.whatsapp)} target="_blank" rel="noreferrer">WhatsApp</a>}
          {c.email && <a className="inline-flex items-center gap-1.5 text-muted hover:text-ink break-all" href={`mailto:${c.email}`}><Icon name="mail" />{c.email}</a>}
        </div>
      </div>
    </div>
  )
}

// ─── Contacts ────────────────────────────────────────────────
function Contacts({ brandId, list, reload }: { brandId: string; list: Contact[] | null; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<Contact | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = (list ?? []).filter(c => !c.is_archived)
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await reload() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <p className="text-sm text-muted">{active.length} contact{active.length === 1 ? '' : 's'}</p>
        <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" /> Add contact</button>
      </div>
      {error && <FormError>{error}</FormError>}
      {list === null ? <EnsoSpinner /> : active.length === 0 ? (
        <div className="shoji"><EmptyState sketch="branch" line="No one to call yet. Add the first contact." /></div>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3 sm:gap-4">
          {active.map(c => (
            <li key={c.id} className="shoji p-5">
              <div className="flex items-start justify-between gap-2">
                <ContactLines c={c} />
                <MoreMenu label={`Actions for ${c.name}`} items={[
                  { label: 'Edit', onSelect: () => setEditing(c) },
                  ...(c.is_primary ? [] : [{ label: 'Make primary', onSelect: () => run(() => brandsApi.makePrimary(c.id)) }]),
                  { label: 'Remove contact', danger: true, onSelect: () => { if (confirm(`Remove ${c.name}? They stay in the history.`)) run(() => brandsApi.archiveContact(c.id)) } },
                ]} />
              </div>
              <div className="mt-3 flex gap-2">{c.is_primary && <Pill tone="accent">Primary</Pill>}{c.is_billing && <Pill>Billing</Pill>}</div>
              {c.notes && <p className="text-xs text-muted mt-3 whitespace-pre-line">{c.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      {editing && <ContactForm brandId={brandId} contact={editing === 'new' ? null : editing} first={active.length === 0}
        onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} />}
    </div>
  )
}

function ContactForm({ brandId, contact, first, onClose, onSaved }: { brandId: string; contact: Contact | null; first: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<ContactInput>({
    name: contact?.name ?? '', designation: contact?.designation ?? '', phone: contact?.phone ?? '', whatsapp: contact?.whatsapp ?? '',
    email: contact?.email ?? '', is_billing: contact?.is_billing ?? false, notes: contact?.notes ?? '', is_primary: contact?.is_primary ?? first,
  })
  const [sameWa, setSameWa] = useState(Boolean(contact?.whatsapp && contact.whatsapp === contact.phone))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const t = (k: keyof ContactInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!f.name?.trim()) { setError('Add a name.'); return }
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { setError('Check the email address.'); return }
    setBusy(true); setError(null)
    const clean = (v: string | null) => v?.trim() || null
    try {
      await brandsApi.saveContact(brandId, { name: f.name.trim(), designation: clean(f.designation), phone: clean(f.phone),
        whatsapp: sameWa ? clean(f.phone) : clean(f.whatsapp), email: clean(f.email), is_billing: f.is_billing, notes: clean(f.notes), is_primary: f.is_primary }, contact?.id)
      onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); setBusy(false) }
  }

  return (
    <Modal title={contact ? `Edit ${contact.name}` : 'Add a contact'} onClose={onClose}>
      <form onSubmit={save} className="grid sm:grid-cols-2 gap-4">
        {error && <div className="sm:col-span-2"><FormError>{error}</FormError></div>}
        <label className="text-sm text-muted">Name *<input className="field mt-1.5" value={f.name} onChange={t('name')} required /></label>
        <label className="text-sm text-muted">Designation<input className="field mt-1.5" value={f.designation ?? ''} onChange={t('designation')} placeholder="Brand manager" /></label>
        <label className="text-sm text-muted">Phone<input className="field mt-1.5" type="tel" placeholder="+91" value={f.phone ?? ''} onChange={t('phone')} /></label>
        <div className="text-sm text-muted">
          <label htmlFor="c-wa">WhatsApp</label>
          <input id="c-wa" className="field mt-1.5" type="tel" placeholder="+91" value={sameWa ? f.phone ?? '' : f.whatsapp ?? ''} onChange={t('whatsapp')} disabled={sameWa} />
          <label className="flex items-center gap-2 mt-1.5 text-xs"><input type="checkbox" checked={sameWa} onChange={e => setSameWa(e.target.checked)} className="accent-[#E3793A]" /> Same as phone</label>
        </div>
        <label className="text-sm text-muted sm:col-span-2">Email<input className="field mt-1.5" type="email" value={f.email ?? ''} onChange={t('email')} /></label>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.is_primary} onChange={e => setF({ ...f, is_primary: e.target.checked })} className="accent-[#E3793A]" /> Primary contact</label>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.is_billing} onChange={e => setF({ ...f, is_billing: e.target.checked })} className="accent-[#E3793A]" /> Gets invoices</label>
        <label className="text-sm text-muted sm:col-span-2">Notes<textarea className="field mt-1.5 h-20 py-2" value={f.notes ?? ''} onChange={t('notes')} /></label>
        <div className="sm:col-span-2 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : contact ? 'Save' : 'Add contact'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Campaigns / Production / Money (filled by later features) ──
const CAMPAIGN_STATUS: Record<string, string> = { draft: 'Draft', pitched: 'Pitched', confirmed: 'Confirmed', in_production: 'In production', live: 'Live', completed: 'Completed', on_hold: 'On hold', cancelled: 'Cancelled' }

function Campaigns({ brandId, money }: { brandId: string; money: boolean }) {
  const { data, loading } = useAsync(() => brandsApi.campaigns(brandId, money), [brandId, money])
  if (loading) return <EnsoSpinner />
  if (!data?.length) return <div className="shoji"><EmptyState sketch="fuji" line="No campaigns with this brand yet." action={<p className="text-xs text-muted -mt-2">Creating campaigns arrives with feature 4.</p>} /></div>
  return (
    <ul className="shoji divide-y divide-line/15">
      {data.map(c => (
        <li key={c.id} className="p-4 sm:px-5 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_9rem_9rem_auto] gap-x-4 gap-y-1 items-center">
          <div className="min-w-0"><p className="text-ink truncate">{c.name}</p><p className="text-xs text-muted num">{c.code ? `${c.code} · ` : ''}{c.start_date ? formatDate(c.start_date) : 'No dates'}{c.end_date ? ` – ${formatDate(c.end_date)}` : ''}</p></div>
          {money && <p className="hidden sm:block text-right text-sm num text-ink">{formatINR(c.contract_value ?? 0)}<span className="block text-xs text-muted">contract</span></p>}
          {money && <p className="hidden sm:block text-right text-sm num text-ink">{formatINR(c.profit ?? 0)}<span className="block text-xs text-muted">profit</span></p>}
          <div className="justify-self-end">{c.status === 'completed' ? <Hanko kind="completed" size={38} animate={false} /> : <Pill tone={c.status === 'live' ? 'accent' : 'quiet'}>{CAMPAIGN_STATUS[c.status] ?? c.status}</Pill>}</div>
        </li>
      ))}
    </ul>
  )
}

function Production({ brandId }: { brandId: string }) {
  const { data, loading } = useAsync(() => brandsApi.deliverables(brandId), [brandId])
  if (loading) return <EnsoSpinner />
  if (!data?.length) return <div className="shoji"><EmptyState sketch="branch" line="Nothing in production for this brand." action={<p className="text-xs text-muted -mt-2">The production tracker arrives with feature 5.</p>} /></div>
  return (
    <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {data.map(d => (
        <li key={d.id} className="shoji p-4"><Pill>{d.stage.replace(/_/g, ' ')}</Pill><p className="text-sm text-ink mt-3">{d.title}</p>
          <p className="text-xs text-muted mt-1 num">{[d.deliverable_type.replace(/_/g, ' '), d.platform, d.go_live_date && `live ${formatDate(d.go_live_date)}`].filter(Boolean).join(' · ')}</p></li>
      ))}
    </ul>
  )
}

function Money({ brandId }: { brandId: string }) {
  const nav = useNavigate()
  const inv = useAsync(() => moneyApi.invoices().then(l => l.filter(i => i.brand_id === brandId)), [brandId])
  const rec = useAsync(() => moneyApi.payments().then(l => l.filter(p => p.brand_id === brandId)), [brandId])
  const month = istToday().slice(0, 8) + '01'
  const ret = useAsync(() => moneyApi.retainersToInvoice(month).then(l => l.filter(r => r.brand_id === brandId)), [brandId, month])
  const [err, setErr] = useState<string | null>(null)
  if (inv.loading || rec.loading) return <EnsoSpinner />
  const invoices = inv.data ?? [], receipts = rec.data ?? []
  const r = ret.data?.[0]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => nav(`/money/invoices/new?brand=${brandId}`)}><Icon name="plus" /> New invoice</button>
        {r && (r.invoice_id ? <Link className="btn-ghost" to={`/money/invoices/${r.invoice_id}`}>This month’s retainer invoice: {r.invoice_number ?? 'draft'}</Link>
          : <button className="btn-ghost" onClick={async () => { setErr(null); try { nav(`/money/invoices/${await moneyApi.createRetainerInvoice(r.retainer_id, month)}`) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } }}>
              Create this month’s retainer invoice ({formatINR(r.monthly_fee)})</button>)}
        <Link className="btn-ghost" to={`/money/payments?record=1&brand=${brandId}`}>Record payment</Link>
      </div>
      {err && <FormError>{err}</FormError>}
      <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
        <Card className="lg:col-span-7 shoji-pad">
          <SectionTitle kanji="金">Invoices</SectionTitle>
          {invoices.length === 0 ? <EmptyState line="No invoices yet — ₹0 billed." /> : (
            <ul className="divide-y divide-line/15">
              {invoices.map(i => (
                <li key={i.invoice_id}><Link to={`/money/invoices/${i.invoice_id}`} className="py-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-raised/40">
                  <div className="flex-1 min-w-0"><p className="text-ink num">{i.invoice_number ?? 'Draft'}</p><p className="text-xs text-muted num">{i.issue_date ? `Issued ${formatDate(i.issue_date)}` : 'Not sent yet'}{i.due_date ? ` · due ${formatDate(i.due_date)}` : ''}</p></div>
                  <p className="text-right num text-ink">{formatINR(i.total)}{i.outstanding > 0 && <span className="block text-xs text-muted">{formatINR(i.outstanding)} left</span>}</p>
                  <div className="w-24 flex justify-end">{i.payment_status === 'paid' ? <Hanko kind="paid" size={40} animate={false} /> : <Pill tone={PAY_STATUS_TONE[i.payment_status]}>{PAY_STATUS_LABEL[i.payment_status]}</Pill>}</div>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-5 shoji-pad">
          <SectionTitle kanji="入">Payments received</SectionTitle>
          {receipts.length === 0 ? <p className="text-sm text-muted">Nothing received yet.</p> : (
            <ul className="divide-y divide-line/15">
              {receipts.map(r => (
                <li key={r.id}><Link to={`/money/payments/${r.id}`} className="py-3 flex justify-between gap-3 text-sm hover:bg-raised/40">
                  <span><span className="text-ink num">{formatDate(r.received_on)}</span><span className="block text-xs text-muted">{[r.mode?.toUpperCase(), r.reference, r.invoice_numbers.join(', ')].filter(Boolean).join(' · ')}</span></span>
                  <span className="text-right num text-ink">{formatINR(r.amount_received)}{Number(r.tds_deducted) > 0 && <span className="block text-xs text-muted">+ TDS {formatINR(r.tds_deducted)}</span>}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

// ─── Files ───────────────────────────────────────────────────
const MAX_FILE = 50 * 1024 * 1024
function Files({ brandId }: { brandId: string }) {
  const { data, loading, reload } = useAsync(() => brandsApi.files(brandId), [brandId])
  const [kind, setKind] = useState<BrandFileKind>('contract')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const files = (data ?? []).filter(f => !f.is_archived)

  async function upload(list: FileList | File[]) {
    setError(null)
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE) { setError(`${file.name} is over 50 MB.`); continue }
      setBusy(file.name)
      try { await brandsApi.uploadFile(brandId, file, kind) } catch (e) { setError(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`) }
    }
    setBusy(null); reload()
  }
  async function open(path: string, name: string) {
    const url = await brandsApi.signedUrl(path, name)
    if (url) window.open(url, '_blank', 'noopener'); else setError('Could not open the file.')
  }

  return (
    <div className="space-y-4">
      <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files) }}
        className={`shoji p-5 flex flex-col sm:flex-row sm:items-center gap-3 border-dashed ${over ? 'border-accent bg-raised' : ''}`}>
        <div className="flex-1">
          <p className="text-ink">{busy ? `Uploading ${busy}…` : 'Drop files here, or choose them'}</p>
          <p className="text-xs text-muted mt-0.5">Contracts, brand guidelines, logos, decks · up to 50 MB each · stored privately</p>
        </div>
        <label className="sr-only" htmlFor="file-kind">File type</label>
        <select id="file-kind" className="field sm:w-48" value={kind} onChange={e => setKind(e.target.value as BrandFileKind)}>
          {FILE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <button className="btn-primary justify-center" disabled={Boolean(busy)} onClick={() => input.current?.click()}><Icon name="plus" /> Upload</button>
        <input ref={input} type="file" multiple className="sr-only" onChange={e => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
      </div>
      {error && <FormError>{error}</FormError>}
      {loading ? <EnsoSpinner /> : files.length === 0 ? <div className="shoji"><EmptyState sketch="branch" line="No files yet." /></div> : (
        <ul className="shoji divide-y divide-line/15">
          {files.map(f => (
            <li key={f.id} className="p-4 sm:px-5 flex items-center gap-3">
              <span className="grid place-items-center w-10 h-10 rounded-shoji bg-raised text-[10px] uppercase text-muted shrink-0">{f.file_name.split('.').pop()?.slice(0, 4)}</span>
              <div className="min-w-0 flex-1">
                <button className="text-ink text-left hover:underline underline-offset-4 break-all" onClick={() => open(f.storage_path, f.file_name)}>{f.file_name}</button>
                <p className="text-xs text-muted num">{FILE_KINDS.find(k => k.value === f.kind)?.label ?? f.kind} · {formatBytes(f.size_bytes)} · {formatDate(f.created_at)}</p>
              </div>
              <MoreMenu label={`Actions for ${f.file_name}`} items={[
                { label: 'Download', onSelect: () => open(f.storage_path, f.file_name) },
                { label: 'Remove', danger: true, onSelect: async () => { if (confirm(`Remove ${f.file_name}? It stays in the history.`)) { await brandsApi.archiveFile(f.id); reload() } } },
              ]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Activity ────────────────────────────────────────────────
const DOT: Record<ActivityKind, string> = { create: 'bg-hai', status: 'bg-kaki', money: 'bg-yamabuki', archive: 'bg-akane', update: 'bg-hai' }

function Activity({ b, contacts }: { b: BrandOverview; contacts: Contact[] }) {
  const { data, loading } = useAsync(() => brandsApi.activity(b.id), [b.id, b.updated_at])
  const owners = useAsync(() => brandsApi.owners(), [])
  const files = useAsync(() => brandsApi.files(b.id), [b.id])
  const names = useMemo(() => Object.fromEntries([...contacts.map(c => [c.id, c.name]), ...(files.data ?? []).map(f => [f.id, f.file_name])]), [contacts, files.data])
  const ownerNames = useMemo(() => Object.fromEntries((owners.data ?? []).map(o => [o.id, o.name])), [owners.data])
  const rows = (data ?? []).map(e => ({ e, d: describeActivity(e, names, ownerNames) }))

  if (loading) return <EnsoSpinner />
  if (!rows.length) return <div className="shoji"><EmptyState line="No history yet." /></div>
  return (
    <Card className="shoji-pad">
      <SectionTitle kanji="歴" aside={<button className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5"
        onClick={() => downloadCSV(`${b.name.replace(/\W+/g, '-')}-activity-${istToday()}.csv`, rows, [
          { header: 'When (IST)', value: r => formatDateTime(r.e.created_at) }, { header: 'Who', value: r => r.e.actor_name },
          { header: 'What', value: r => r.d.text }, { header: 'Record', value: r => r.e.table_name }, { header: 'Action', value: r => r.e.action },
          { header: 'Old values', value: r => r.e.old_values ? JSON.stringify(r.e.old_values) : '' }, { header: 'New values', value: r => r.e.new_values ? JSON.stringify(r.e.new_values) : '' },
        ])}><Icon name="download" /> CSV</button>}>History</SectionTitle>
      <ol className="relative ml-1.5 border-l border-line/30 space-y-5">
        {rows.map(({ e, d }) => (
          <li key={e.id} className="pl-5 relative">
            <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-card ${DOT[d.kind]}`} aria-hidden />
            <p className="text-sm text-ink"><span className="font-medium">{e.actor_name}</span> {d.text}</p>
            <p className="text-xs text-muted mt-0.5 num">{formatDateTime(e.created_at)}{e.source !== 'app' ? ` · ${e.source}` : ''}</p>
          </li>
        ))}
      </ol>
    </Card>
  )
}
