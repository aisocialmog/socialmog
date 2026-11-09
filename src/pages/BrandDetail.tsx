import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BrushDivider, Hanko } from '../components/art/Ink'
import { Card, MoreMenu, Pill, PreviewBadge, SectionTitle } from '../components/ui/kit'
import { Icon } from '../components/ui/Icon'
import { brandDetail as b, brands } from '../demo/data'
import { formatDate, formatDateTime, formatINR } from '../lib/format'
import { STATUS_TONE } from './BrandsList'

const CAMPAIGN_LABEL: Record<string, string> = { live: 'Live', in_production: 'In production', completed: 'Completed' }

export function BrandDetail() {
  const row = brands.find(x => x.id === b.id)!
  const [paid, setPaid] = useState<Record<string, boolean>>({})
  const tabs = ['Overview', 'Campaigns', 'Invoices', 'Files', 'Activity'] as const
  const [tab, setTab] = useState<(typeof tabs)[number]>('Overview')

  return (
    <div className="space-y-6 sm:space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
        <Link to="/brands" className="hover:text-ink">Brands</Link><Icon name="chevronRight" className="text-xs" /><span className="text-ink">{b.name}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <span className="hidden sm:grid place-items-center w-14 h-14 shrink-0 rounded-shoji bg-raised font-mincho text-2xl text-ink" aria-hidden>{b.name[0]}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mincho text-3xl text-ink">{b.name}</h1>
              <Pill tone={STATUS_TONE[b.status]}>Active</Pill>
            </div>
            <p className="text-sm text-muted mt-1">{b.industry} · {b.relationship} · {b.city} · owned by {b.owner}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <PreviewBadge />
          <button className="btn-primary ml-2"><Icon name="plus" /> New campaign</button>
          <MoreMenu items={[
            { label: 'Edit brand', onSelect: () => {} }, { label: 'Add contact', onSelect: () => {} },
            { label: 'Create invoice', onSelect: () => {} }, { label: 'Export brand data (CSV)', onSelect: () => {} },
            { label: 'Archive brand', onSelect: () => {}, danger: true },
          ]} />
        </div>
      </header>

      {/* calculated totals strip */}
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-shoji overflow-hidden border border-line/30 bg-line/20">
        {[
          ['Billed (lifetime)', formatINR(row.billed), null],
          ['Received', formatINR(row.received), null],
          ['Outstanding', formatINR(row.outstanding), row.overdue ? `${formatINR(row.overdue)} overdue` : null],
          ['Campaigns', `${row.activeCampaigns} active · ${row.campaigns} total`, null],
        ].map(([k, v, alert]) => (
          <div key={k} className="bg-card px-5 py-4">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-1.5 text-xl text-ink num">{v}</dd>
            {alert && <dd className="mt-2"><Pill tone="alert">{alert}</Pill></dd>}
          </div>
        ))}
      </dl>

      <div role="tablist" aria-label="Brand sections" className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 border-b border-line/25">
        {tabs.map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`relative px-4 h-11 text-sm whitespace-nowrap transition-colors duration-calm ${tab === t ? 'text-ink' : 'text-muted hover:text-ink'}`}>
            {t}{tab === t && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-accent rounded-full" />}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        <div className="lg:col-span-8 space-y-4 sm:space-y-6">
          <Card className="shoji-pad">
            <SectionTitle kanji="陣" aside={<Link to="/campaigns" className="text-sm text-muted hover:text-ink">All campaigns</Link>}>Campaigns</SectionTitle>
            <ul className="divide-y divide-line/20">
              {b.campaigns.map(c => (
                <li key={c.name} className="py-4 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_8rem_8rem_auto] gap-x-4 gap-y-1 items-center">
                  <div className="min-w-0">
                    <p className="text-ink">{c.name}</p>
                    <p className="text-xs text-muted num">{c.period} · {c.creators} creators</p>
                  </div>
                  <div className="text-right sm:order-none order-last col-span-2 sm:col-span-1 flex sm:block justify-between text-sm">
                    <span className="sm:hidden text-muted text-xs">Value</span><span className="num text-ink">{formatINR(c.value)}</span>
                  </div>
                  <div className="text-right hidden sm:block text-sm"><span className="num text-ink">{formatINR(c.profit)}</span><p className="text-xs text-muted">profit</p></div>
                  <div className="justify-self-end">
                    {c.status === 'completed' ? <Hanko kind="completed" size={40} animate={false} /> : <Pill tone={c.status === 'live' ? 'accent' : 'quiet'}>{CAMPAIGN_LABEL[c.status]}</Pill>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="shoji-pad">
            <SectionTitle kanji="金">Invoices</SectionTitle>
            <ul className="divide-y divide-line/20">
              {b.invoices.map(inv => {
                const isPaid = inv.status === 'paid' || paid[inv.number]
                return (
                  <li key={inv.number} className="py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-ink num">{inv.number}</p>
                      <p className="text-xs text-muted num">Issued {formatDate(inv.date)} · due {formatDate(inv.due)}</p>
                    </div>
                    <div className="text-right">
                      <p className="num text-ink">{formatINR(inv.total)}</p>
                      {inv.status === 'overdue' && !isPaid && <p className="text-xs text-muted num">{formatINR(inv.outstanding!)} left</p>}
                    </div>
                    <div className="w-24 flex justify-end">
                      {isPaid ? <Hanko kind="paid" size={44} animate={Boolean(paid[inv.number])} />
                        : inv.status === 'overdue' ? <Pill tone="alert">Overdue</Pill>
                        : <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setPaid(p => ({ ...p, [inv.number]: true }))}>Mark paid</button>}
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-muted mt-3">Paid / overdue are worked out from receipts and due dates — never set by hand.</p>
          </Card>

          <Card className="shoji-pad">
            <SectionTitle kanji="作">Deliverables in flight</SectionTitle>
            <ul className="grid sm:grid-cols-3 gap-3">
              {b.deliverables.map(d => (
                <li key={d.title} className="rounded-shoji border border-line/25 p-4">
                  <Pill>{d.stage}</Pill>
                  <p className="text-sm text-ink mt-3">{d.title}</p>
                  <p className="text-xs text-muted mt-1">{d.creator} · live {formatDate(d.goLive)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <aside className="lg:col-span-4 space-y-4 sm:space-y-6">
          <Card className="shoji-pad">
            <SectionTitle>Details</SectionTitle>
            <dl className="space-y-3 text-sm">
              {[
                ['Legal name', b.legalName], ['GSTIN', b.gstin], ['State', b.state],
                ['Payment terms', `${b.paymentTerms} days`], ['Client since', formatDate(b.since)],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-3"><dt className="text-muted">{k}</dt><dd className="text-ink break-words num">{v}</dd></div>
              ))}
              <div className="grid grid-cols-[7.5rem_1fr] gap-3"><dt className="text-muted">Online</dt>
                <dd className="text-ink space-y-1"><span className="flex items-center gap-1.5"><Icon name="link" className="text-muted" />{b.website}</span><span className="block">{b.instagram}</span></dd></div>
            </dl>
            <BrushDivider className="my-5" />
            <p className="eyebrow mb-2">Retainer</p>
            <p className="text-ink">{b.retainer.title}</p>
            <p className="text-sm text-muted mt-1"><span className="num text-ink">{formatINR(b.retainer.monthlyFee)}</span> / month · since {formatDate(b.retainer.from)}</p>
            <p className="text-sm text-muted mt-1">{b.retainer.scope}</p>
          </Card>

          <Card className="shoji-pad">
            <SectionTitle kanji="人">Contacts</SectionTitle>
            <ul className="space-y-4">
              {b.contacts.map(c => (
                <li key={c.name} className="flex items-start gap-3">
                  <span className="grid place-items-center w-9 h-9 rounded-full bg-raised text-xs text-ink shrink-0" aria-hidden>{c.name.split(' ').map(w => w[0]).join('')}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{c.name} {c.primary && <Pill>Primary</Pill>} {c.billing && <Pill>Billing</Pill>}</p>
                    <p className="text-xs text-muted">{c.role}</p>
                    <a href={`mailto:${c.email}`} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1 mt-1 break-all"><Icon name="mail" />{c.email}</a>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="shoji-pad">
            <SectionTitle kanji="歴" aside={<button className="text-sm text-muted hover:text-ink">View all</button>}>Activity</SectionTitle>
            <ol className="relative ml-1.5 border-l border-line/30 space-y-5">
              {b.activity.map(a => (
                <li key={a.at} className="pl-5 relative">
                  <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-card ${a.kind === 'seal' ? 'bg-akane' : a.kind === 'money' ? 'bg-yamabuki' : a.kind === 'status' ? 'bg-kaki' : 'bg-hai'}`} aria-hidden />
                  <p className="text-sm text-ink"><span className="font-medium">{a.who}</span> {a.text}</p>
                  <p className="text-xs text-muted mt-0.5 num">{formatDateTime(a.at)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  )
}
