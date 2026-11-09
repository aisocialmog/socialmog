import { useMemo, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { productionApi, type ProductionItem } from '../../data/production'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { isStaff } from '../../lib/access'
import { FORMATS, FORMAT_LABEL, ROLE_LABEL, STAGES, STAGE_KANJI, STAGE_LABEL, type PersonRole, type Stage } from '../../lib/production'
import { formatDate, istToday } from '../../lib/format'
import { addDaysISO } from '../../lib/production'
import { downloadCSV } from '../../lib/csv'
import { Icon } from '../../components/ui/Icon'
import { EmptyState, Pill } from '../../components/ui/kit'
import { Kanban } from '../../components/ui/Kanban'
import { EnsoSpinner } from '../../components/art/Ink'
import { BrandChip, Flags } from './ProductionBits'
import { FormError } from '../auth/AuthLayout'

const personName = (p: string) => p.split(':').slice(1).join(':')
const initials = (n: string) => n.replace(/[[\]()]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

export function ProductionTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => `relative px-4 h-11 inline-flex items-center text-sm ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`
  const bar = (on: boolean) => on && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-accent rounded-full" />
  return (
    <nav aria-label="Production sections" className="flex gap-1 border-b border-line/25">
      <NavLink to="/production" end className={cls}>{({ isActive }) => <>Board{bar(isActive)}</>}</NavLink>
      <NavLink to="/production/mine" className={cls}>{({ isActive }) => <>My work{bar(isActive)}</>}</NavLink>
      <NavLink to="/calendar" className={cls}>{({ isActive }) => <>Calendar{bar(isActive)}</>}</NavLink>
    </nav>
  )
}
function Header({ title }: { title: string }) {
  const { role } = useAuth()
  const nav = useNavigate()
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">作</span>Production</p><h1 className="font-mincho text-3xl text-ink">{title}</h1></div>
      {isStaff(role) && <button className="btn-primary" onClick={() => nav('/production/new')}><Icon name="plus" /> New production item</button>}
    </header>
  )
}

export function ProductionBoard() {
  const nav = useNavigate()
  const { role } = useAuth()
  const { data, loading, error, setData, reload } = useAsync(() => productionApi.items(), [])
  const [brand, setBrand] = useState('all'), [person, setPerson] = useState('all'), [format, setFormat] = useState('all'), [due, setDue] = useState('all')
  const [flag, setFlag] = useState<'all' | 'stuck' | 'overdue' | 'revisions'>('all')
  const today = istToday()
  const brands = useMemo(() => [...new Map((data ?? []).map(i => [i.brand_id, i.brand_name])).entries()], [data])
  const peopleList = useMemo(() => [...new Set((data ?? []).flatMap(i => [...i.people.map(personName), i.assignee_name].filter(Boolean) as string[]))].sort(), [data])
  const rows = (data ?? []).filter(i => brand === 'all' || i.brand_id === brand).filter(i => format === 'all' || i.format === format)
    .filter(i => person === 'all' || i.assignee_name === person || i.people.some(p => personName(p) === person))
    .filter(i => due === 'all' || (i.sort_date != null && (due === 'overdue' ? i.is_overdue : due === 'week' ? i.sort_date <= addDaysISO(today, 7) : i.sort_date <= addDaysISO(today, 14))))
    .filter(i => flag === 'all' || (flag === 'stuck' ? i.is_stuck : flag === 'overdue' ? i.is_overdue : i.over_revision_limit))
  const counts = { stuck: (data ?? []).filter(i => i.is_stuck).length, overdue: (data ?? []).filter(i => i.is_overdue).length, revisions: (data ?? []).filter(i => i.over_revision_limit).length }

  return (
    <div className="space-y-6">
      <Header title="Production board" />
      <ProductionTabs />
      <div className="flex flex-wrap gap-2">
        {([['stuck', `${counts.stuck} stuck > 3 days`], ['overdue', `${counts.overdue} past post date`], ['revisions', `${counts.revisions} over revision limit`]] as const)
          .filter(([k]) => counts[k] > 0).map(([k, l]) => (
            <button key={k} aria-pressed={flag === k} onClick={() => setFlag(flag === k ? 'all' : k)}
              className={`pill py-1.5 px-3 text-sm ${flag === k ? 'bg-alert text-kinari' : 'border border-akane/70 text-ink'}`}><span className={`w-2 h-2 rounded-full ${flag === k ? 'bg-kinari' : 'bg-akane'}`} />{l}</button>
          ))}
      </div>
      <div className="shoji p-3 sm:p-4 grid grid-cols-2 lg:grid-cols-5 gap-2">
        <label className="sr-only" htmlFor="pf-brand">Brand</label>
        <select id="pf-brand" className="field" value={brand} onChange={e => setBrand(e.target.value)}><option value="all">Any brand</option>{brands.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <label className="sr-only" htmlFor="pf-person">Assignee</label>
        <select id="pf-person" className="field" value={person} onChange={e => setPerson(e.target.value)}><option value="all">Anyone</option>{peopleList.map(p => <option key={p}>{p}</option>)}</select>
        <label className="sr-only" htmlFor="pf-format">Format</label>
        <select id="pf-format" className="field" value={format} onChange={e => setFormat(e.target.value)}><option value="all">Any format</option>{FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}</select>
        <label className="sr-only" htmlFor="pf-due">Due</label>
        <select id="pf-due" className="field" value={due} onChange={e => setDue(e.target.value)}><option value="all">Any due date</option><option value="overdue">Past target date</option><option value="week">Due in 7 days</option><option value="fortnight">Due in 14 days</option></select>
        <button className="btn-ghost justify-center col-span-2 lg:col-span-1" onClick={() => downloadCSV(`production-${today}.csv`, rows, [
          { header: 'Title', value: i => i.title }, { header: 'Brand', value: i => i.brand_name }, { header: 'Campaign', value: i => i.campaign_name }, { header: 'Format', value: i => FORMAT_LABEL[i.format] },
          { header: 'Stage', value: i => STAGE_LABEL[i.stage] }, { header: 'Days in stage', value: i => i.days_in_stage }, { header: 'Target post date', value: i => i.target_date ? formatDate(i.target_date) : '' },
          { header: 'People', value: i => i.people.map(p => `${ROLE_LABEL[p.split(':')[0] as PersonRole]}: ${personName(p)}`).join('; ') }, { header: 'Revisions', value: i => i.revision_count }, { header: 'Revision limit', value: i => i.revision_limit },
        ])}><Icon name="download" /> CSV</button>
      </div>
      {error && <FormError>{error}</FormError>}
      {loading && !data ? <div className="py-16 grid place-items-center"><EnsoSpinner size={44} /></div>
        : !(data ?? []).length ? <div className="shoji"><EmptyState sketch="branch" line="The studio is quiet. Add your first production item." /></div> : (
        <Kanban columns={STAGES.map(s => ({ key: s, label: STAGE_LABEL[s], kanji: STAGE_KANJI[s] }))} items={rows}
          getId={i => i.id} getColumn={i => i.stage} getName={i => i.title} onOpen={i => nav(`/production/${i.id}`)}
          hint="Drag to the next stage — on a phone, use the grip. Every move is timed in the activity log."
          onMove={async (i, to) => {
            const prev = data; setData(d => d && d.map(x => x.id === i.id ? { ...x, stage: to as Stage, days_in_stage: 0, is_stuck: false } : x))
            try { await productionApi.update(i.id, { stage: to as Stage }) } catch (e) { setData(prev); throw new Error(e instanceof Error && e.message.includes('live_needs_url') ? 'add the live post link first' : e instanceof Error ? e.message : 'try again') }
            reload()
          }}
          renderCard={(i, grip) => <>
            <div className="pr-6"><BrandChip color={i.brand_color} name={i.brand_name} small />
              <p className="text-sm text-ink font-medium leading-snug mt-1 break-words">{i.title}</p>
              <p className="text-xs text-muted">{FORMAT_LABEL[i.format] ?? i.format}{i.campaign_name ? ` · ${i.campaign_name}` : ''}</p></div>
            <div className="mt-2"><Flags i={i} compact /></div>
            <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted">
              <span className="num">{i.target_date ? `Post ${formatDate(i.target_date).slice(0, 6)}` : 'No date'}{i.shoot_date ? ` · shoot ${formatDate(i.shoot_date).slice(0, 6)}` : ''}</span>
              <span className="flex items-center gap-1">{i.people.slice(0, 3).map(p => <span key={p} title={`${ROLE_LABEL[p.split(':')[0] as PersonRole]}: ${personName(p)}`} className="grid place-items-center w-6 h-6 rounded-full bg-raised text-[10px] text-ink">{initials(personName(p))}</span>)}{grip}</span>
            </div>
          </>} />
      )}
      {role === 'freelancer' && <p className="text-xs text-muted">You see the items you’re named on.</p>}
    </div>
  )
}

export function MyWork() {
  const { member } = useAuth()
  const { data, loading } = useAsync(() => productionApi.items(), [])
  const shoots = useAsync(() => productionApi.shoots(addDaysISO(istToday(), -1), addDaysISO(istToday(), 60)), [])
  if (!member) return null
  const mine = (data ?? []).filter(i => i.stage !== 'live' && (i.assignee_id === member.id || i.people_member_ids.includes(member.id)))
    .sort((a, b) => (a.sort_date ?? '9').localeCompare(b.sort_date ?? '9'))
  const myShoots = (shoots.data ?? []).filter(s => mine.some(i => s.item_ids?.includes(i.id))).sort((a, b) => a.shoot_date.localeCompare(b.shoot_date))
  const roleOn = (i: ProductionItem) => [i.assignee_id === member.id ? 'Owner' : null, ...i.people.filter(p => i.people_member_ids.includes(member.id) && personName(p) === member.name).map(p => ROLE_LABEL[p.split(':')[0] as PersonRole])].filter(Boolean).join(', ')
  return (
    <div className="space-y-6">
      <Header title="My work" />
      <ProductionTabs />
      {loading ? <EnsoSpinner /> : mine.length === 0 ? <div className="shoji"><EmptyState sketch="koi" line="Still water. Nothing is assigned to you." /></div> : (
        <ul className="shoji divide-y divide-line/15">
          {mine.map(i => (
            <li key={i.id}><Link to={`/production/${i.id}`} className="p-4 sm:px-5 grid grid-cols-[5.5rem_1fr] sm:grid-cols-[6rem_1fr_auto] gap-3 items-center hover:bg-raised/50">
              <span className={`num text-sm ${i.is_overdue ? 'text-ink' : 'text-muted'}`}>{i.sort_date ? formatDate(i.sort_date).slice(0, 6) : 'No date'}<span className="block text-[11px] text-muted">{i.due_date ? 'due' : 'post date'}</span></span>
              <span className="min-w-0"><span className="block text-ink">{i.title}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted"><BrandChip color={i.brand_color} name={i.brand_name} small />· {FORMAT_LABEL[i.format]}{roleOn(i) ? ` · you: ${roleOn(i)}` : ''}</span>
                <span className="block mt-1"><Flags i={i} compact /></span></span>
              <span className="col-span-2 sm:col-span-1"><Pill>{STAGE_LABEL[i.stage]}</Pill></span>
            </Link></li>
          ))}
        </ul>
      )}
      {myShoots.length > 0 && (
        <section className="shoji shoji-pad"><h2 className="font-mincho text-lg text-ink mb-3">Your upcoming shoots</h2>
          <ul className="divide-y divide-line/15 text-sm">{myShoots.map(s => <li key={s.id} className="py-2.5 flex gap-3"><span className="num text-ink w-20">{formatDate(s.shoot_date).slice(0, 6)}</span><span className="flex-1">{s.title}<span className="block text-xs text-muted">{[s.call_time && `call ${s.call_time.slice(0, 5)}`, s.location].filter(Boolean).join(' · ')}</span></span></li>)}</ul>
        </section>
      )}
    </div>
  )
}
