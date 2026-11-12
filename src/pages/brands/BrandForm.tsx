import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { db } from '../../data/db'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { brandsApi, type BrandInput, type RetainerInput } from '../../data/brands'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { BRAND_STATUSES, ENGAGEMENTS, ENGAGEMENT_LABEL, GST_STATES, gstinProblem, hasRetainer, INDUSTRIES, LEAD_SOURCES,
  normalizeHandle, normalizeWebsite, renewalNotice, STATUS_LABEL, stateFromGstin, type EngagementType, type BrandStatus } from '../../lib/brands'
import { istToday } from '../../lib/format'
import { Icon } from '../../components/ui/Icon'
import { EnsoSpinner } from '../../components/art/Ink'
import { BrandLogo } from '../../components/brands/BrandBits'
import { FormError } from '../auth/AuthLayout'

const ENGAGEMENT_HELP: Record<EngagementType, string> = {
  production: 'We script, shoot and edit content for them.',
  campaign_management: 'We run influencer campaigns for them.',
  full_marketing: 'We handle their marketing for a monthly fee.',
  mixed: 'A retainer plus separate projects or campaigns.',
}

interface FormState {
  name: string; billing_name: string; industry: string; website: string; instagram_handle: string; youtube_handle: string
  engagement_type: EngagementType; status: BrandStatus; source: string; owner_id: string; city: string; state_code: string
  gstin: string; billing_address: string; payment_terms_days: string; notes: string
  monthly_fee: string; start_date: string; billing_day: string; renewal_date: string; scope: string
  contact_name: string; contact_designation: string; contact_email: string; contact_phone: string
}

export function BrandForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const sources = useAsync(() => db.rows<{ name: string; is_archived: boolean }>('list_items', { kind: 'lead_source' }, 'name').catch(() => []), [])
  const nav = useNavigate()
  const { member } = useAuth()
  const owners = useAsync(() => brandsApi.owners(), [])
  const existing = useAsync(async () => id ? { brand: await brandsApi.get(id), retainer: await brandsApi.retainer(id) } : null, [id])

  const [f, setF] = useState<FormState>({
    name: '', billing_name: '', industry: '', website: '', instagram_handle: '', youtube_handle: '',
    engagement_type: 'campaign_management', status: 'lead', source: '', owner_id: member?.id ?? '', city: '', state_code: '',
    gstin: '', billing_address: '', payment_terms_days: '', notes: '',
    monthly_fee: '', start_date: istToday(), billing_day: '1', renewal_date: '', scope: '',
    contact_name: '', contact_designation: '', contact_email: '', contact_phone: '',
  })
  const [logo, setLogo] = useState<File | null>(null)
  const logoUrl = useMemo(() => logo ? URL.createObjectURL(logo) : null, [logo])
  useEffect(() => () => { if (logoUrl) URL.revokeObjectURL(logoUrl) }, [logoUrl])
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const b = existing.data?.brand, r = existing.data?.retainer
    if (!b) return
    setF(s => ({
      ...s, name: b.name, billing_name: b.billing_name ?? '', industry: b.industry ?? '', website: b.website ?? '',
      instagram_handle: b.instagram_handle ?? '', youtube_handle: b.youtube_handle ?? '', engagement_type: b.engagement_type,
      status: b.status, source: b.source ?? '', owner_id: b.owner_id ?? '', city: b.city ?? '', state_code: b.state_code ?? '',
      gstin: b.gstin ?? '', billing_address: b.billing_address ?? '', payment_terms_days: b.payment_terms_days?.toString() ?? '', notes: b.notes ?? '',
      ...(r ? { monthly_fee: String(r.monthly_fee), start_date: r.start_date, billing_day: r.billing_day?.toString() ?? '', renewal_date: r.renewal_date ?? '', scope: r.scope ?? '' } : {}),
    }))
  }, [existing.data])

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.value
    setF(s => {
      const next = { ...s, [k]: v }
      if (k === 'gstin') { const st = stateFromGstin(v.toUpperCase()); if (st) next.state_code = st.code }
      return next
    })
  }

  const retainerOn = hasRetainer(f.engagement_type)
  const hadRetainer = Boolean(existing.data?.retainer)
  const problems = useMemo(() => {
    const p: Partial<Record<keyof FormState, string>> = {}
    if (!f.name.trim()) p.name = 'Give the brand a name.'
    const g = gstinProblem(f.gstin); if (g) p.gstin = g
    if (f.payment_terms_days && !(Number(f.payment_terms_days) >= 0 && Number(f.payment_terms_days) <= 365)) p.payment_terms_days = 'Between 0 and 365 days.'
    if (retainerOn) {
      if (!(Number(f.monthly_fee) > 0)) p.monthly_fee = 'Enter the monthly fee.'
      if (!f.start_date) p.start_date = 'When does the retainer start?'
      if (f.billing_day && !(Number(f.billing_day) >= 1 && Number(f.billing_day) <= 28)) p.billing_day = 'Pick a day from 1 to 28.'
      if (f.renewal_date && f.start_date && f.renewal_date < f.start_date) p.renewal_date = 'Renewal can’t be before the start.'
    }
    if (f.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.contact_email)) p.contact_email = 'Check this email.'
    return p
  }, [f, retainerOn])

  async function submit(e: FormEvent) {
    e.preventDefault(); setTouched(true)
    if (Object.keys(problems).length) { setError('Please fix the highlighted fields.'); return }
    setBusy(true); setError(null)
    const gstin = f.gstin.trim().toUpperCase() || null
    const input: BrandInput = {
      name: f.name.trim(), billing_name: f.billing_name.trim() || null, industry: f.industry.trim() || null,
      website: normalizeWebsite(f.website), instagram_handle: normalizeHandle(f.instagram_handle), youtube_handle: normalizeHandle(f.youtube_handle),
      engagement_type: f.engagement_type, status: f.status, source: f.source.trim() || null, owner_id: f.owner_id || null,
      city: f.city.trim() || null, state_code: f.state_code || null, state: f.state_code ? GST_STATES[f.state_code] : null,
      gstin, billing_address: f.billing_address.trim() || null,
      payment_terms_days: f.payment_terms_days === '' ? null : Number(f.payment_terms_days), notes: f.notes.trim() || null,
    }
    try {
      const brandId = await brandsApi.save(input, id)
      const retainer: RetainerInput | null = retainerOn ? {
        monthly_fee: Number(f.monthly_fee), start_date: f.start_date, billing_day: f.billing_day ? Number(f.billing_day) : null,
        renewal_date: f.renewal_date || null, scope: f.scope.trim() || null,
      } : null
      if (retainer || hadRetainer) await brandsApi.saveRetainer(brandId, retainer)
      if (!editing && f.contact_name.trim()) {
        await brandsApi.saveContact(brandId, { name: f.contact_name.trim(), designation: f.contact_designation.trim() || null, email: f.contact_email.trim() || null,
          phone: f.contact_phone.trim() || null, whatsapp: null, is_billing: false, notes: null, is_primary: true })
      }
      if (logo) await brandsApi.uploadLogo(brandId, logo)
      nav(`/brands/${brandId}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the brand.')
      setBusy(false)
    }
  }

  if (editing && existing.loading) return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} /></div>
  if (editing && !existing.data?.brand) return <FormError>That brand wasn’t found.</FormError>

  const err = (k: keyof FormState) => touched && problems[k] ? <span className="block text-xs text-ink mt-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-akane mr-1.5 align-middle" />{problems[k]}</span> : null
  const cls = (k: keyof FormState) => `field mt-1.5 ${touched && problems[k] ? 'border-akane ring-1 ring-akane' : ''}`
  const renewal = retainerOn && f.renewal_date ? renewalNotice(f.renewal_date, Math.round((Date.parse(f.renewal_date) - Date.parse(istToday())) / 864e5)) : null

  return (
    <form onSubmit={submit} noValidate className="space-y-6 max-w-3xl">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
        <Link to="/brands" className="hover:text-ink">Brands</Link><Icon name="chevronRight" className="text-xs" />
        {editing ? <><Link to={`/brands/${id}`} className="hover:text-ink">{existing.data?.brand?.name}</Link><Icon name="chevronRight" className="text-xs" /><span className="text-ink">Edit</span></>
          : <span className="text-ink">New brand</span>}
      </nav>
      <h1 className="font-mincho text-3xl text-ink">{editing ? 'Edit brand' : 'Add a brand'}</h1>
      {error && <FormError>{error}</FormError>}

      <Section title="Brand" kanji="商">
        <div className="sm:col-span-2 flex items-center gap-4">
          {logoUrl ? <img src={logoUrl} alt="" className="w-16 h-16 rounded-shoji object-contain bg-kinari" />
            : <BrandLogo name={f.name || '?'} path={existing.data?.brand?.logo_path ?? null} size={64} />}
          <label className="btn-ghost h-9 text-sm cursor-pointer">
            {logo || existing.data?.brand?.logo_path ? 'Change logo' : 'Add logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only"
              onChange={e => { const file = e.target.files?.[0]; if (file && file.size <= 5 * 1024 * 1024) setLogo(file); else if (file) setError('Keep the logo under 5 MB.') }} />
          </label>
          <span className="text-xs text-muted">PNG, JPG, WebP or SVG, up to 5 MB</span>
        </div>
        <label className="text-sm text-muted sm:col-span-2">Brand name *<input className={cls('name')} value={f.name} onChange={set('name')} autoFocus={!editing} />{err('name')}</label>
        <label className="text-sm text-muted">Industry / category
          <input className="field mt-1.5" list="industries" value={f.industry} onChange={set('industry')} />
          <datalist id="industries">{INDUSTRIES.map(i => <option key={i} value={i} />)}</datalist>
        </label>
        <label className="text-sm text-muted">Website<input className="field mt-1.5" inputMode="url" placeholder="brand.com" value={f.website} onChange={set('website')} /></label>
        <label className="text-sm text-muted">Instagram<input className="field mt-1.5" placeholder="@handle" value={f.instagram_handle} onChange={set('instagram_handle')} /></label>
        <label className="text-sm text-muted">YouTube<input className="field mt-1.5" placeholder="@channel" value={f.youtube_handle} onChange={set('youtube_handle')} /></label>
      </Section>

      <Section title="Relationship" kanji="縁">
        <fieldset className="sm:col-span-2">
          <legend className="text-sm text-muted mb-2">Engagement type</legend>
          <div className="grid sm:grid-cols-2 gap-2">
            {ENGAGEMENTS.map(x => (
              <label key={x} className={`rounded-shoji border px-3 py-2.5 cursor-pointer transition-colors duration-calm ${f.engagement_type === x ? 'border-accent bg-raised' : 'border-line/30 hover:border-line/60'}`}>
                <span className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="engagement" value={x} checked={f.engagement_type === x} onChange={() => setF(s => ({ ...s, engagement_type: x }))} className="accent-[#E3793A]" />
                  {ENGAGEMENT_LABEL[x]}
                </span>
                <span className="block text-xs text-muted mt-1">{ENGAGEMENT_HELP[x]}</span>
              </label>
            ))}
          </div>
          {!retainerOn && hadRetainer && <p className="text-xs text-ink mt-2"><span className="inline-block w-1.5 h-1.5 rounded-full bg-akane mr-1.5 align-middle" />Saving with this engagement type ends the current retainer (it stays in the history).</p>}
        </fieldset>
        <label className="text-sm text-muted">Status
          <select className="field mt-1.5" value={f.status} onChange={set('status')}>{BRAND_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        </label>
        <label className="text-sm text-muted">Lead source
          <input className="field mt-1.5" list="sources" value={f.source} onChange={set('source')} placeholder="Referral, Instagram…" />
          <datalist id="sources">{(sources.data ?? []).filter(x => !x.is_archived).map(x => x.name).concat(sources.data?.length ? [] : LEAD_SOURCES).map(s => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="text-sm text-muted sm:col-span-2">Owner — who handles this brand
          <select className="field mt-1.5" value={f.owner_id} onChange={set('owner_id')}>
            <option value="">No owner yet</option>{owners.data?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      </Section>

      {retainerOn && (
        <Section title="Retainer" kanji="約">
          <label className="text-sm text-muted">Monthly fee (₹, before GST) *<input className={`${cls('monthly_fee')} num`} type="number" min="0" step="1" inputMode="numeric" value={f.monthly_fee} onChange={set('monthly_fee')} />{err('monthly_fee')}</label>
          <label className="text-sm text-muted">Billing day of month<input className={`${cls('billing_day')} num`} type="number" min="1" max="28" value={f.billing_day} onChange={set('billing_day')} />{err('billing_day')}</label>
          <label className="text-sm text-muted">Start date *<input className={`${cls('start_date')} num`} type="date" value={f.start_date} onChange={set('start_date')} />{err('start_date')}</label>
          <label className="text-sm text-muted">Renewal date<input className={`${cls('renewal_date')} num`} type="date" min={f.start_date} value={f.renewal_date} onChange={set('renewal_date')} />{err('renewal_date')}</label>
          {renewal && <p className="sm:col-span-2 rounded-shoji bg-alert text-kinari text-sm px-3 py-2">{renewal.text}</p>}
          <label className="text-sm text-muted sm:col-span-2">Scope of work<textarea className="field mt-1.5 h-28 py-2" value={f.scope} onChange={set('scope')} placeholder="e.g. 8 reels + 12 stories a month, content calendar, community replies" /></label>
        </Section>
      )}

      <Section title="Billing" kanji="金">
        <label className="text-sm text-muted sm:col-span-2">Billing name (as on invoices)<input className="field mt-1.5" value={f.billing_name} onChange={set('billing_name')} placeholder="e.g. Chai Sutra Beverages Pvt. Ltd." /></label>
        <label className="text-sm text-muted">GSTIN (optional)
          <input className={`${cls('gstin')} uppercase num`} maxLength={15} value={f.gstin} onChange={set('gstin')} placeholder="27AAACC1234D1ZC" />
          {err('gstin') ?? (f.gstin && !problems.gstin ? <span className="block text-xs mt-1">State set from GSTIN: {GST_STATES[f.gstin.slice(0, 2)]}</span> : null)}
        </label>
        <label className="text-sm text-muted">State (place of supply)
          <select className="field mt-1.5" value={f.state_code} onChange={set('state_code')}>
            <option value="">—</option>{Object.entries(GST_STATES).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </label>
        <label className="text-sm text-muted">City<input className="field mt-1.5" value={f.city} onChange={set('city')} /></label>
        <label className="text-sm text-muted">Payment terms (days)<input className={`${cls('payment_terms_days')} num`} type="number" min="0" max="365" placeholder="Default from settings" value={f.payment_terms_days} onChange={set('payment_terms_days')} />{err('payment_terms_days')}</label>
        <label className="text-sm text-muted sm:col-span-2">Billing address<textarea className="field mt-1.5 h-20 py-2" value={f.billing_address} onChange={set('billing_address')} /></label>
      </Section>

      {!editing && (
        <Section title="Primary contact (optional)" kanji="人">
          <label className="text-sm text-muted">Name<input className="field mt-1.5" value={f.contact_name} onChange={set('contact_name')} /></label>
          <label className="text-sm text-muted">Designation<input className="field mt-1.5" value={f.contact_designation} onChange={set('contact_designation')} /></label>
          <label className="text-sm text-muted">Email<input className={cls('contact_email')} type="email" value={f.contact_email} onChange={set('contact_email')} />{err('contact_email')}</label>
          <label className="text-sm text-muted">Phone<input className="field mt-1.5" type="tel" placeholder="+91" value={f.contact_phone} onChange={set('contact_phone')} /></label>
        </Section>
      )}

      <Section title="Notes" kanji="記">
        <label className="text-sm text-muted sm:col-span-2"><span className="sr-only">Notes</span>
          <textarea className="field h-28 py-2" value={f.notes} onChange={set('notes')} placeholder="Anything the team should know: approval process, tone, do’s and don’ts…" />
        </label>
      </Section>

      <div className="sticky bottom-20 lg:bottom-4 z-10 flex justify-end gap-2 bg-bg/90 backdrop-blur rounded-shoji p-2 -mx-2">
        <button type="button" className="btn-ghost" onClick={() => nav(editing ? `/brands/${id}` : '/brands')}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add brand'}</button>
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
