// Campaign report. On screen: an internal panel (spend, profit, margin) plus
// the client report on washi paper. "Download PDF report" prints only the
// paper (A4), so internal numbers never reach the brand.
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { campaignsApi, type DeliverableRow } from '../../data/campaigns'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import { isStaff } from '../../lib/access'
import { formatCPV, KIND_LABEL, OBJECTIVE_LABEL } from '../../lib/campaigns'
import { formatCount, PLATFORM_LABEL, RATE_LABEL, type DeliverableType } from '../../lib/creators'
import { formatDate, formatINR } from '../../lib/format'
import { Icon } from '../../components/ui/Icon'
import { EmptyState } from '../../components/ui/kit'
import { EnsoSpinner } from '../../components/art/Ink'
import { BrandLogo } from '../../components/brands/BrandBits'

interface CreatorTotals { name: string; posts: number; views: number; engagements: number; clicks: number; conversions: number }

/** Single-series horizontal bars, drawn in akane on paper (5.6:1), values in ink. */
function BarChart({ title, rows, unit }: { title: string; rows: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  const H = 26, W = 360, L = 104
  return (
    <figure className="break-inside-avoid">
      <figcaption className="font-mincho text-[15px] text-[#1E1C1A] mb-2">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${rows.length * H + 4}`} className="w-full" role="img" aria-label={`${title}: ${rows.map(r => `${r.label} ${formatCount(r.value)} ${unit}`).join(', ')}`}>
        {rows.map((r, i) => {
          const w = Math.max(2, (r.value / max) * (W - L - 52))
          return (
            <g key={r.label} transform={`translate(0 ${i * H})`}>
              <title>{`${r.label}: ${r.value.toLocaleString('en-IN')} ${unit}`}</title>
              <text x={L - 10} y={H / 2 + 4} textAnchor="end" fontSize="12" fill="#1E1C1A">{r.label.length > 15 ? r.label.slice(0, 14) + '…' : r.label}</text>
              <rect x={L} y={5} width={w} height={H - 10} rx={4} fill="#B7282E" />
              <text x={L + w + 8} y={H / 2 + 4} fontSize="12" fill="#1E1C1A" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(r.value)}</text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

export function CampaignReport() {
  const { id = '' } = useParams()
  const { role } = useAuth()
  const staff = isStaff(role)
  const sum = useAsync(() => campaignsApi.summary(id), [id])
  const dels = useAsync(() => campaignsApi.deliverables(id), [id])
  const s = sum.data
  useEffect(() => { if (s) document.title = `${s.brand_name} — ${s.name} — campaign report` ; return () => { document.title = 'Social Mog OS' } }, [s])

  if (sum.loading || dels.loading) return <div className="py-16 grid place-items-center"><EnsoSpinner size={44} label="Preparing report" /></div>
  if (!s) return <div className="shoji"><EmptyState sketch="koi" line="This campaign isn’t here." /></div>

  const posts = (dels.data ?? []).filter(d => d.is_posted)
  const byCreator = new Map<string, CreatorTotals>()
  for (const d of posts) {
    const k = d.creator_name ?? '—'
    const t = byCreator.get(k) ?? { name: k, posts: 0, views: 0, engagements: 0, clicks: 0, conversions: 0 }
    t.posts++; t.views += d.views ?? 0; t.engagements += d.engagements; t.clicks += d.link_clicks ?? 0; t.conversions += d.conversions ?? 0
    byCreator.set(k, t)
  }
  const creators = [...byCreator.values()].sort((a, b) => b.views - a.views)
  const top: DeliverableRow[] = [...posts].filter(d => d.views).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 3)
  const kpis: [string, string][] = [
    ['Views', formatCount(s.views)], ['Reach', formatCount(s.reach)], ['Engagements', formatCount(s.engagements)],
    ['Engagement rate', s.engagement_rate != null ? `${s.engagement_rate}%` : '—'], ['Link clicks', formatCount(s.link_clicks)],
    ['Sales / code uses', formatCount(s.conversions)], ['Posts live', `${s.posted}`], ['Creators', `${creators.length}`],
  ]
  if (s.client_cost_per_view != null) kpis.splice(4, 0, ['Cost per view', formatCPV(s.client_cost_per_view)])
  const ink = 'text-[#1E1C1A]', soft = 'text-[#5c5752]'

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
          <Link to="/campaigns" className="hover:text-ink">Campaigns</Link><Icon name="chevronRight" className="text-xs" />
          <Link to={`/campaigns/${s.campaign_id}`} className="hover:text-ink">{s.name}</Link><Icon name="chevronRight" className="text-xs" /><span className="text-ink">Report</span>
        </nav>
        <button className="btn-primary" onClick={() => window.print()}><Icon name="download" /> Download PDF report</button>
      </div>

      {staff && (
        <section className="no-print shoji p-5" aria-label="Internal numbers">
          <p className="eyebrow mb-3">Internal — not in the PDF</p>
          <dl className="grid grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
            {[['Client budget', s.client_budget != null ? formatINR(s.client_budget) : '—'], ['Actual creator spend', formatINR(s.actual_creator_spend ?? 0)],
              ['Production expenses', formatINR(s.production_expenses)], ['Profit so far', formatINR(s.profit ?? 0)], ['Our cost per view', formatCPV(s.cost_per_view)]].map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-lg text-ink num mt-0.5">{v}</dd></div>
            ))}
          </dl>
          <p className="text-xs text-muted mt-3">Expected margin {s.expected_margin != null ? formatINR(s.expected_margin) : '—'}. The PDF shows the brand only results, and cost per view on their own investment.</p>
        </section>
      )}
      <p className="no-print text-xs text-muted">Below is exactly what the PDF contains. In the print dialog choose “Save as PDF”.</p>

      {/* ── the paper ── */}
      <article id="report-paper" className="report-paper mx-auto max-w-[210mm] bg-[#F7F1E6] rounded-shoji shadow-2xl shadow-black/30 px-8 sm:px-12 py-10 space-y-8">
        <header className="flex items-start justify-between gap-6 border-b border-[#8F877F]/40 pb-6">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-12 h-12 rounded-full bg-[#B7282E] text-[#F2E8D5] font-mincho font-bold -rotate-6 print-color" aria-hidden>SM</span>
            <div className="leading-tight"><p className={`font-mincho text-lg ${ink}`}>Social Mog</p><p className={`text-xs ${soft}`}>Influencer production &amp; campaigns</p></div>
          </div>
          <div className="flex items-center gap-3 text-right">
            <div className="leading-tight"><p className={`text-xs ${soft}`}>Prepared for</p><p className={`font-mincho text-lg ${ink}`}>{s.brand_name.replace(' (sample)', '')}</p></div>
            <BrandLogo name={s.brand_name} path={s.brand_logo_path} size={48} />
          </div>
        </header>

        <section>
          <p className={`text-xs tracking-[0.18em] uppercase ${soft}`}>Campaign report</p>
          <h1 className={`font-mincho text-3xl ${ink} mt-1`}>{s.name}</h1>
          <p className={`text-sm ${soft} mt-2`}>{[KIND_LABEL[s.kind], s.objective && `Objective: ${OBJECTIVE_LABEL[s.objective]}`, s.platforms.map(p => PLATFORM_LABEL[p] ?? p).join(', '),
            s.start_date && `${formatDate(s.start_date)}${s.end_date ? ` – ${formatDate(s.end_date)}` : ''}`].filter(Boolean).join(' · ')}</p>
          <div className="h-[3px] w-24 mt-4 rounded-full print-color" style={{ backgroundImage: 'linear-gradient(90deg,#B7282E,#E3793A 55%,#F2A93B)' }} aria-hidden />
        </section>

        <section aria-label="Results" className="grid grid-cols-3 gap-px bg-[#8F877F]/30 rounded-[6px] overflow-hidden break-inside-avoid">
          {kpis.map(([k, v], i) => (
            <div key={k} className={`bg-[#F2E8D5] px-4 py-3 ${i === 0 ? 'col-span-1' : ''}`}>
              <p className={`text-[11px] ${soft}`}>{k}</p><p className={`font-mincho text-2xl ${ink} mt-0.5`} style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</p>
            </div>
          ))}
        </section>

        {posts.length === 0 ? <p className={`text-sm ${soft}`}>No posts are live yet — numbers will appear here as posts go live.</p> : <>
          <section className="grid sm:grid-cols-2 gap-8 print:grid-cols-2">
            <BarChart title="Views by creator" unit="views" rows={creators.map(c => ({ label: c.name.replace(' (sample)', ''), value: c.views }))} />
            <BarChart title="How people engaged" unit="" rows={[
              { label: 'Likes', value: s.likes ?? 0 }, { label: 'Comments', value: s.comments ?? 0 }, { label: 'Shares', value: s.shares ?? 0 }, { label: 'Saves', value: s.saves ?? 0 }]} />
          </section>

          <section className="break-inside-avoid">
            <h2 className={`font-mincho text-[15px] ${ink} mb-3`}>Top-performing posts</h2>
            <ol className="grid grid-cols-3 gap-3">
              {top.map((d, i) => (
                <li key={d.deliverable_id} className="rounded-[6px] border border-[#8F877F]/40 p-3.5">
                  <p className="font-mincho text-[#B7282E] text-lg">#{i + 1}</p>
                  <p className={`text-sm ${ink} mt-1 leading-snug`}>{d.title.replace(' (sample)', '')}</p>
                  <p className={`text-xs ${soft} mt-0.5`}>{d.creator_name?.replace(' (sample)', '')} · {RATE_LABEL[d.deliverable_type as DeliverableType] ?? d.deliverable_type}</p>
                  <p className={`text-sm ${ink} mt-2`} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(d.views)} views · {d.engagement_rate ?? 0}% ER</p>
                  {d.live_url && <a href={d.live_url} className={`text-[11px] ${soft} underline break-all`}>{d.live_url.replace(/^https?:\/\/(www\.)?/, '')}</a>}
                </li>
              ))}
            </ol>
          </section>

          <section className="break-inside-avoid">
            <h2 className={`font-mincho text-[15px] ${ink} mb-2`}>By creator</h2>
            <table className={`w-full text-sm ${ink}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
              <thead><tr className={`text-left text-xs ${soft} border-b border-[#8F877F]/40`}>
                <th className="py-2 font-normal">Creator</th><th className="py-2 font-normal text-right">Posts</th><th className="py-2 font-normal text-right">Views</th>
                <th className="py-2 font-normal text-right">Engagement</th><th className="py-2 font-normal text-right">Clicks</th><th className="py-2 font-normal text-right">Sales / codes</th>
              </tr></thead>
              <tbody className="divide-y divide-[#8F877F]/25">
                {creators.map(c => (
                  <tr key={c.name}><td className="py-2">{c.name.replace(' (sample)', '')}</td><td className="py-2 text-right">{c.posts}</td><td className="py-2 text-right">{formatCount(c.views)}</td>
                    <td className="py-2 text-right">{c.views ? `${(c.engagements / c.views * 100).toFixed(2)}%` : '—'}</td><td className="py-2 text-right">{formatCount(c.clicks)}</td><td className="py-2 text-right">{formatCount(c.conversions)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </>}

        <footer className={`pt-4 border-t border-[#8F877F]/40 flex justify-between text-[11px] ${soft}`}>
          <span>Engagement rate = (likes + comments + shares + saves) ÷ views.{s.client_cost_per_view != null ? ' Cost per view = campaign investment ÷ views.' : ''}</span>
          <span className="shrink-0 ml-4">Social Mog · {formatDate(new Date())}</span>
        </footer>
      </article>
    </div>
  )
}
