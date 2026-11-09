// Content calendar: production items by target post date + shoots by shoot
// date, colour-coded by brand. Mouse: drag a chip to another day to reschedule.
// Phones / keyboard: tap a day for its list; reschedule from the item page.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { productionApi, type ProductionItem, type SharedEntry, type Shoot } from '../../data/production'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { isStaff } from '../../lib/access'
import { addDaysISO, brandColor, FORMAT_LABEL, monthGrid, MONTHS, STAGE_LABEL, weekDays } from '../../lib/production'
import { formatDate, formatDateTime, istToday } from '../../lib/format'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { EnsoSpinner, Seigaiha } from '../../components/art/Ink'
import { ProductionTabs } from './ProductionPage'
import { brandStyle } from './ProductionBits'
import { FormError, FormNote } from '../auth/AuthLayout'

type Entry = { key: string; kind: 'post' | 'shoot'; id: string; date: string; title: string; brandId: string; color: number | null; brandName: string; sub: string; flag: boolean }
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function useEntries(items: ProductionItem[] | null, shoots: Shoot[] | null, brand: string, show: { posts: boolean; shoots: boolean }) {
  return useMemo(() => {
    const e: Entry[] = []
    if (show.posts) for (const i of items ?? []) if (i.target_date && (brand === 'all' || i.brand_id === brand))
      e.push({ key: `p${i.id}`, kind: 'post', id: i.id, date: i.target_date, title: i.title, brandId: i.brand_id, color: i.brand_color, brandName: i.brand_name, sub: `${FORMAT_LABEL[i.format] ?? i.format} · ${STAGE_LABEL[i.stage]}`, flag: i.is_overdue })
    if (show.shoots) for (const s of shoots ?? []) if (brand === 'all' || s.brand_id === brand)
      e.push({ key: `s${s.id}`, kind: 'shoot', id: s.id, date: s.shoot_date, title: s.title, brandId: s.brand_id ?? 'none', color: s.brand_color, brandName: s.brand_name ?? '—', sub: `Shoot${s.call_time ? ` · ${s.call_time.slice(0, 5)}` : ''}`, flag: false })
    return e
  }, [items, shoots, brand, show.posts, show.shoots])
}

export function CalendarPage() {
  const nav = useNavigate()
  const { role } = useAuth()
  const staff = isStaff(role)
  const today = istToday()
  const [view, setView] = useState<'month' | 'week'>('month')
  const [anchor, setAnchor] = useState(today)
  const [brand, setBrand] = useState('all')
  const [show, setShow] = useState({ posts: true, shoots: true })
  const [selected, setSelected] = useState(today)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [y, m] = anchor.split('-').map(Number)
  const days = view === 'month' ? monthGrid(y, m) : weekDays(anchor)
  const items = useAsync(() => productionApi.items(), [])
  const shoots = useAsync(() => productionApi.shoots(days[0], days[days.length - 1]), [days[0], days[days.length - 1]])
  const entries = useEntries(items.data, shoots.data, brand, show)
  const brands = useMemo(() => [...new Map((items.data ?? []).map(i => [i.brand_id, i.brand_name])).entries()], [items.data])
  const colorOf = (id: string) => (items.data ?? []).find(i => i.brand_id === id)?.brand_color ?? null
  const byDay = (d: string) => entries.filter(e => e.date === d)

  // drag to reschedule (mouse / pen)
  const [drag, setDrag] = useState<{ e: Entry; x: number; y: number; over: string | null; active: boolean; sx: number; sy: number } | null>(null)
  const dragRef = useRef(drag); dragRef.current = drag
  const moved = useRef(false)
  useEffect(() => {
    if (!drag) return
    const mv = (ev: PointerEvent) => {
      const d = dragRef.current!; const active = d.active || Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 6
      const over = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-day]')?.dataset.day) ?? null
      setDrag({ ...d, x: ev.clientX, y: ev.clientY, over, active })
    }
    const up = async () => {
      const d = dragRef.current; setDrag(null)
      if (!d?.active) return
      moved.current = true; setTimeout(() => { moved.current = false }, 0)
      if (!d.over || d.over === d.e.date) return
      setError(null)
      try {
        if (d.e.kind === 'post') await productionApi.update(d.e.id, { go_live_date: d.over }); else await productionApi.moveShoot(d.e.id, d.over)
        await Promise.all([items.reload(), shoots.reload()])
      } catch (err) { setError(`Couldn’t move “${d.e.title}”: ${err instanceof Error ? err.message : 'try again'}`) }
    }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null])

  const step = (n: number) => setAnchor(view === 'week' ? addDaysISO(anchor, 7 * n) : `${m + n > 12 ? y + 1 : m + n < 1 ? y - 1 : y}-${String(((m + n - 1 + 12) % 12) + 1).padStart(2, '0')}-01`)
  const open = (e: Entry) => { if (moved.current) return; nav(e.kind === 'post' ? `/production/${e.id}` : `/production/${(shoots.data ?? []).find(s => s.id === e.id)?.item_ids?.[0] ?? ''}?tab=shoot`) }
  const Chip = ({ e }: { e: Entry }) => (
    <button type="button" onPointerDown={ev => { if (ev.pointerType === 'mouse' && ev.button === 0) setDrag({ e, x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, over: e.date, active: false }) }}
      onClick={() => open(e)} title={`${e.brandName} · ${e.title} · ${e.sub}`}
      className={`w-full text-left rounded-[4px] px-1.5 py-1 text-[11px] leading-tight flex items-start gap-1 bg-raised hover:bg-card cursor-pointer lg:cursor-grab ${drag?.active && drag.e.key === e.key ? 'opacity-30' : ''}`}>
      <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: brandColor(e.color) }} aria-hidden />
      <span className="min-w-0"><span className="block truncate text-ink">{e.kind === 'shoot' ? '撮 ' : ''}{e.title}</span><span className="block truncate text-muted">{e.brandName.replace(' (sample)', '')} · {e.sub}</span></span>
      {e.flag && <span className="ml-auto w-1.5 h-1.5 mt-1 rounded-full bg-akane shrink-0" aria-label="past target date" />}
    </button>
  )
  const title = view === 'month' ? `${MONTHS[m - 1]} ${y}` : `${formatDate(days[0])} – ${formatDate(days[6])}`

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">暦</span>Content calendar</p><h1 className="font-mincho text-3xl text-ink">{title}</h1></div>
        <div className="flex items-center gap-1">
          {staff && <button className="btn-primary" onClick={() => nav(`/production/new?date=${selected}${brand !== 'all' ? `&brand=${brand}` : ''}`)}><Icon name="plus" /> Plan a post</button>}
        </div>
      </header>
      <ProductionTabs />
      <div className="flex flex-wrap items-center gap-2">
        <button className="icon-btn" aria-label="Previous" onClick={() => step(-1)}><Icon name="chevronLeft" /></button>
        <button className="btn-ghost h-9" onClick={() => { setAnchor(today); setSelected(today) }}>Today</button>
        <button className="icon-btn" aria-label="Next" onClick={() => step(1)}><Icon name="chevronRight" /></button>
        <div role="tablist" aria-label="View" className="inline-flex rounded-shoji border border-line/30 p-0.5 ml-1">
          {(['month', 'week'] as const).map(v => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`px-3 h-8 rounded-[5px] text-sm ${view === v ? 'bg-raised text-ink' : 'text-muted'}`}>{v === 'month' ? 'Month' : 'Week'}</button>)}
        </div>
        <label className="sr-only" htmlFor="cal-brand">Brand</label>
        <select id="cal-brand" className="field h-9 w-48" value={brand} onChange={e => setBrand(e.target.value)}><option value="all">All brands</option>{brands.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <label className="text-sm text-muted flex items-center gap-1.5"><input type="checkbox" className="accent-[#E3793A]" checked={show.posts} onChange={e => setShow({ ...show, posts: e.target.checked })} /> Posts</label>
        <label className="text-sm text-muted flex items-center gap-1.5"><input type="checkbox" className="accent-[#E3793A]" checked={show.shoots} onChange={e => setShow({ ...show, shoots: e.target.checked })} /> Shoots</label>
        {staff && brand !== 'all' && <button className="btn-ghost h-9 ml-auto" onClick={() => setSharing(true)}><Icon name="link" /> Share with client</button>}
      </div>
      <ul className="flex flex-wrap gap-3 text-xs text-muted" aria-label="Brand colours">{brands.filter(([id]) => brand === 'all' || id === brand).map(([id, n]) => <li key={id} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm ring-1 ring-line/40" style={{ background: brandColor(colorOf(id)) }} />{n}</li>)}<li>· 撮 = shoot · <span className="inline-block w-1.5 h-1.5 rounded-full bg-akane align-middle" /> past post date</li></ul>
      {error && <FormError>{error}</FormError>}
      {(items.loading && !items.data) ? <EnsoSpinner /> : (
        <div className="shoji overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line/25 text-[11px] text-muted">{DOW.map(d => <div key={d} className="px-2 py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {days.map(d => {
              const list = byDay(d), inMonth = view === 'week' || Number(d.slice(5, 7)) === m, over = drag?.active && drag.over === d
              return (
                <div key={d} data-day={d} onClick={() => setSelected(d)}
                  className={`border-b border-r border-line/15 p-1 sm:p-1.5 ${view === 'week' ? 'min-h-[22rem]' : 'min-h-[4.5rem] sm:min-h-[7.5rem]'} ${inMonth ? '' : 'bg-bg/40'} ${over ? 'bg-raised outline outline-1 outline-accent' : ''} ${selected === d ? 'ring-1 ring-inset ring-accent/50' : ''}`}>
                  <p className={`text-[11px] num mb-1 ${d === today ? 'inline-grid place-items-center w-5 h-5 rounded-full bg-accent text-sumi' : inMonth ? 'text-ink' : 'text-muted'}`}>{Number(d.slice(8))}</p>
                  <div className="hidden sm:block space-y-1">{(view === 'week' ? list : list.slice(0, 3)).map(e => <Chip key={e.key} e={e} />)}
                    {view === 'month' && list.length > 3 && <button className="text-[11px] text-muted hover:text-ink" onClick={() => setSelected(d)}>+{list.length - 3} more</button>}</div>
                  <div className="sm:hidden flex flex-wrap gap-0.5">{list.slice(0, 4).map(e => <span key={e.key} className="w-1.5 h-1.5 rounded-full" style={{ background: brandColor(e.color) }} />)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <section className="shoji shoji-pad" aria-live="polite">
        <h2 className="font-mincho text-lg text-ink mb-3">{formatDate(selected)}</h2>
        {byDay(selected).length === 0 ? <p className="text-sm text-muted">Nothing planned.</p> :
          <ul className="space-y-2">{byDay(selected).map(e => <li key={e.key}><Chip e={e} /></li>)}</ul>}
        <p className="text-xs text-muted mt-3">To move something on a phone or with the keyboard, open it and change the date.</p>
      </section>
      {drag?.active && <div className="fixed z-50 pointer-events-none rounded-[4px] px-2 py-1 text-xs shadow-2xl shadow-black/40" style={{ left: drag.x + 8, top: drag.y + 8, ...brandStyle(drag.e.color) }}>{drag.e.title}{drag.over ? ` → ${formatDate(drag.over)}` : ''}</div>}
      {sharing && <ShareModal brandId={brand} brandName={brands.find(([id]) => id === brand)?.[1] ?? ''} onClose={() => setSharing(false)} />}
    </div>
  )
}

function ShareModal({ brandId, brandName, onClose }: { brandId: string; brandName: string; onClose: () => void }) {
  const list = useAsync(() => productionApi.shares(brandId), [brandId])
  const [days, setDays] = useState<string>('180'), [shoots, setShoots] = useState(true)
  const [link, setLink] = useState<string | null>(null), [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title={`Share ${brandName}’s calendar`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">The client sees post titles, formats, dates, a simple status and live links — never money, briefs, notes, people or locations. No login needed.</p>
        {error && <FormError>{error}</FormError>}
        {link ? (
          <div className="space-y-2">
            <FormNote>Copy this link now — for safety it isn’t shown again.</FormNote>
            <div className="flex gap-2"><label className="sr-only" htmlFor="share-url">Link</label><input id="share-url" readOnly className="field text-xs" value={link} onFocus={e => e.target.select()} />
              <button className="btn-primary shrink-0" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) } }}>{copied ? 'Copied' : 'Copy'}</button></div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm text-muted">Link works for<select className="field mt-1.5" value={days} onChange={e => setDays(e.target.value)}><option value="30">30 days</option><option value="90">90 days</option><option value="180">6 months</option><option value="">Until I turn it off</option></select></label>
            <label className="text-sm text-ink flex items-center gap-2 sm:mt-7"><input type="checkbox" className="accent-[#E3793A]" checked={shoots} onChange={e => setShoots(e.target.checked)} /> Show shoot days</label>
            <button className="btn-primary sm:col-span-2 justify-center" onClick={async () => {
              setError(null)
              try { const t = await productionApi.createShare(brandId, days ? Number(days) : null, shoots); setLink(`${window.location.origin}/share/calendar/${t}`); list.reload() }
              catch (e) { setError(e instanceof Error ? e.message : 'Could not create the link') }
            }}>Create read-only link</button>
          </div>
        )}
        <div><p className="text-xs text-muted mb-2">Active links</p>
          {(list.data ?? []).length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="divide-y divide-line/15">{list.data!.map(s => <li key={s.id} className="py-2 flex items-center gap-3 text-sm">
              <span className="flex-1 text-ink">Made {formatDateTime(s.created_at)}<span className="block text-xs text-muted">{s.expires_at ? `until ${formatDate(s.expires_at)}` : 'no end date'}{s.include_shoots ? ' · with shoots' : ''}</span></span>
              <button className="btn-ghost h-8 text-xs" onClick={async () => { await productionApi.revokeShare(s.id); list.reload() }}>Turn off</button></li>)}</ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ─── Public, read-only client calendar ───────────────────────
export function SharedCalendar() {
  const { token = '' } = useParams()
  const today = istToday()
  const [anchor, setAnchor] = useState(today.slice(0, 8) + '01')
  const [y, m] = anchor.split('-').map(Number)
  const days = monthGrid(y, m)
  const brand = useAsync(() => productionApi.sharedBrand(token), [token])
  const cal = useAsync(() => productionApi.sharedCalendar(token, days[0], days[days.length - 1]), [token, anchor])
  const step = (n: number) => setAnchor(`${m + n > 12 ? y + 1 : m + n < 1 ? y - 1 : y}-${String(((m + n - 1 + 12) % 12) + 1).padStart(2, '0')}-01`)
  const list = (d: string) => (cal.data ?? []).filter((e: SharedEntry) => e.on_date === d)
  const STATUS_CLS: Record<string, string> = { Posted: 'bg-accent text-sumi', 'Awaiting your review': 'bg-yamabuki text-sumi', Approved: 'border border-accent text-ink' }
  useEffect(() => { document.title = brand.data ? `${brand.data.brand_name} — content calendar` : 'Content calendar' }, [brand.data])

  if (brand.loading) return <div className="min-h-screen grid place-items-center"><EnsoSpinner size={44} /></div>
  if (!brand.data) return (
    <div className="min-h-screen grid place-items-center px-4 relative overflow-hidden"><Seigaiha opacity={0.04} />
      <div className="relative shoji p-8 max-w-sm text-center"><p className="font-mincho text-xl text-ink">This link isn’t active.</p><p className="text-sm text-muted mt-2">It may have expired or been turned off. Ask your Social Mog contact for a new one.</p></div></div>
  )
  return (
    <div className="min-h-screen px-4 sm:px-8 py-8 max-w-6xl mx-auto space-y-6">
      <div className="fixed inset-x-0 top-0 h-[3px] bg-sunset" aria-hidden />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><span className="grid place-items-center w-11 h-11 rounded-full bg-akane text-kinari font-mincho font-bold -rotate-6" aria-hidden>SM</span>
          <div><p className="text-xs text-muted">Content calendar by Social Mog</p><h1 className="font-mincho text-2xl text-ink">{brand.data.brand_name.replace(' (sample)', '')}</h1></div></div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" aria-label="Previous month" onClick={() => step(-1)}><Icon name="chevronLeft" /></button>
          <p className="font-mincho text-lg text-ink w-40 text-center">{MONTHS[m - 1]} {y}</p>
          <button className="icon-btn" aria-label="Next month" onClick={() => step(1)}><Icon name="chevronRight" /></button>
        </div>
      </header>
      {cal.error && <FormError>{cal.error}</FormError>}
      <div className="shoji overflow-hidden hidden sm:block">
        <div className="grid grid-cols-7 border-b border-line/25 text-[11px] text-muted">{DOW.map(d => <div key={d} className="px-2 py-2">{d}</div>)}</div>
        <div className="grid grid-cols-7">{days.map(d => (
          <div key={d} className={`border-b border-r border-line/15 p-1.5 min-h-[7rem] ${Number(d.slice(5, 7)) === m ? '' : 'bg-bg/40'}`}>
            <p className={`text-[11px] num mb-1 ${d === today ? 'inline-grid place-items-center w-5 h-5 rounded-full bg-accent text-sumi' : 'text-muted'}`}>{Number(d.slice(8))}</p>
            <div className="space-y-1">{list(d).map((e, n) => <div key={n} className="rounded-[4px] bg-raised px-1.5 py-1 text-[11px] leading-tight">
              <span className="block text-ink truncate">{e.kind === 'shoot' ? '撮 ' : ''}{e.title}</span>
              <span className="block text-muted truncate">{e.kind === 'shoot' ? (e.at_time ? e.at_time.slice(0, 5) : 'Shoot') : `${FORMAT_LABEL[e.format ?? ''] ?? e.format ?? ''}`}</span>
              <span className={`inline-block mt-0.5 px-1.5 rounded-full text-[10px] ${STATUS_CLS[e.status] ?? 'border border-line/40 text-muted'}`}>{e.status}</span>
              {e.live_url && <a href={e.live_url} target="_blank" rel="noreferrer" className="block text-[10px] text-muted underline">View post</a>}
            </div>)}</div>
          </div>))}</div>
      </div>
      <ul className="sm:hidden shoji divide-y divide-line/15">
        {days.filter(d => list(d).length).map(d => <li key={d} className="p-4"><p className="text-xs text-muted num mb-2">{formatDate(d)}</p>
          {list(d).map((e, n) => <p key={n} className="text-sm text-ink">{e.kind === 'shoot' ? '撮 ' : ''}{e.title} <span className={`ml-1 px-1.5 rounded-full text-[10px] ${STATUS_CLS[e.status] ?? 'border border-line/40 text-muted'}`}>{e.status}</span></p>)}</li>)}
        {!days.some(d => list(d).length) && <li className="p-4 text-sm text-muted">Nothing planned this month.</li>}
      </ul>
      <p className="text-xs text-muted">Read-only. Dates are target post dates in IST and can move. {brand.data.expires_at ? `This link works until ${formatDate(brand.data.expires_at)}.` : ''}</p>
      <p className="text-xs text-muted"><Link to="/login" className="underline underline-offset-4">Social Mog team sign-in</Link></p>
    </div>
  )
}
