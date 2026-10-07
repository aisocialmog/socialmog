import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ExternalLink, Users } from 'lucide-react';
import { formatDate } from '../../shared/dates.ts';
import { formatINR, formatNumberIN } from '../../shared/money.ts';
import { can, ENTITY, fieldLabel, humanize, PLATFORMS, visibleFields } from '../../shared/schema.ts';
import {
  Activity, api, ArchiveButton, Async, attempt, Badge, Card, DataTable, DemoTag, Details, Empty, EntityForm, EntityTable, invalidate, Modal, Money, MoneyField,
  PageHead, Stat, Tabs, Timeline, toast, useApi, useCan, useMe, useOptions, type Row,
} from '../lib.tsx';
import { PayableTable } from './finance.tsx';

export function PlatformLinks({ platforms }: { platforms: Row[] | null }) {
  if (!platforms?.length) return <span className="muted">—</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      {platforms.map((p, i) => (
        <a key={i} href={p.url} target="_blank" rel="noreferrer" className="badge" onClick={(e) => e.stopPropagation()} title={`${p.handle ?? ''} · source: ${p.source ?? 'unknown'}${p.updated_at ? `, as of ${formatDate(p.updated_at)}` : ''}`}>
          {humanize(p.platform)} {p.followers != null ? formatNumberIN(p.followers, { compact: true }) : '—'} <ExternalLink size={11} />
        </a>
      ))}
    </span>
  );
}

export function Influencers() {
  const [shortlist, setShortlist] = useState(false);
  const [exporting, setExporting] = useState(false);
  return (
    <div className="stack">
      <PageHead title="Influencer roster" sub="Creators we manage, work with or are scouting" actions={<><button className="btn" onClick={() => setExporting(true)}>Shareable export</button><button className="btn primary" onClick={() => setShortlist(true)}><Users /> Shortlist for a campaign</button></>} />
      <EntityTable entity="influencers" overrides={{
        name: { render: (r) => <span className="row nowrap-row"><Avatar r={r} /><span><strong>{r.name}</strong> <DemoTag row={r} /><div className="small muted">{r.handle}</div></span></span> },
        platforms: { hidden: false, label: 'Platforms', render: (r) => <PlatformLinks platforms={r.platforms} />, value: (r) => Math.max(0, ...(r.platforms ?? []).map((p: Row) => p.followers ?? 0)) },
        handle: { hidden: true },
      }} />
      <Modal open={shortlist} onClose={() => setShortlist(false)} title="Shortlist creators" size="drawer">{shortlist && <Shortlist />}</Modal>
      <Modal open={exporting} onClose={() => setExporting(false)} title="Shareable roster export">{exporting && <RosterExport />}</Modal>
    </div>
  );
}

function Avatar({ r, size = 34 }: { r: Row; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size }}>{r.photo_url ? <img src={r.photo_url} alt="" /> : (r.name ?? '?').slice(0, 1)}</span>;
}

function RosterExport() {
  const me = useMe();
  const fields = visibleFields(ENTITY.influencers, me.user.role).filter((f) => !['photo_url'].includes(f.key));
  const [picked, setPicked] = useState<string[]>(['name', 'handle', 'city', 'niches', 'languages', 'platforms', 'audience', 'availability']);
  return (
    <div className="stack">
      <div className="alert info small">Commissions, rates, identity details and internal notes are left out unless you tick them. Exports are logged.</div>
      <div className="form-grid">
        {fields.map((f) => (
          <label key={f.key} className="check small">
            <input type="checkbox" checked={picked.includes(f.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, f.key] : picked.filter((k) => k !== f.key))} />
            {fieldLabel(f)} {(f.sensitive || /notes/.test(f.key)) && <Badge tone="warn">internal</Badge>}
          </label>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Link className="btn" to="/reports?type=roster">Branded PDF roster</Link>
        <a className="btn primary" href={`/api/e/influencers/export.csv?fields=${picked.join(',')}`}>Download CSV</a>
      </div>
    </div>
  );
}

function Shortlist({ preset }: { preset?: Row }) {
  const brands = useOptions('brands');
  const deals = useApi<{ rows: Row[] }>('/api/e/deals');
  const campaigns = useOptions('campaigns');
  const canRates = useCan('rates');
  const [q, setQ] = useState<Row>({ niches: [], include_unavailable: false, ...preset });
  const [res, setRes] = useState<Row[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState('');
  const run = async () => attempt(async () => setRes((await api('/api/shortlist', { body: q })).rows));
  const add = async () => {
    const [kind, id] = target.split(':');
    const picked = (res ?? []).filter((r) => sel.has(r.id));
    if (kind === 'deal') {
      const deal = deals.data!.rows.find((d) => d.id === Number(id))!;
      const existing: Row[] = deal.creators ?? [];
      const creators = [...existing, ...picked.filter((p) => !existing.some((e) => e.influencer_id === p.id)).map((p) => ({ influencer_id: p.id, status: 'proposed' }))];
      if (await attempt(() => api(`/api/e/deals/${id}`, { method: 'PATCH', body: { creators } }), `Added ${picked.length} to the deal`)) invalidate('/api/e/deals');
    } else if (kind === 'campaign') {
      let ok = 0;
      for (const p of picked) if (await attempt(() => api('/api/e/campaign_creators', { body: { campaign_id: Number(id), influencer_id: p.id, status: 'proposed' } }))) ok++;
      toast(`Added ${ok} to the campaign roster as proposed`);
    }
  };
  return (
    <div className="stack">
      <div className="form-grid">
        <label className="field"><span>Niches</span><input className="input" placeholder="beauty, skincare" defaultValue={(q.niches ?? []).join(', ')} onChange={(e) => setQ({ ...q, niches: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
        <label className="field"><span>City / audience location</span><input className="input" value={q.city ?? ''} onChange={(e) => setQ({ ...q, city: e.target.value })} /></label>
        <label className="field"><span>Language</span><input className="input" value={q.language ?? ''} onChange={(e) => setQ({ ...q, language: e.target.value })} /></label>
        <label className="field"><span>Platform</span><select className="input" value={q.platform ?? ''} onChange={(e) => setQ({ ...q, platform: e.target.value || undefined })}><option value="">Any</option>{PLATFORMS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select></label>
        <label className="field"><span>Deliverable</span><select className="input" value={q.deliverable ?? ''} onChange={(e) => setQ({ ...q, deliverable: e.target.value || undefined })}><option value="">Any</option>{['reel', 'story', 'post', 'carousel', 'youtube_video', 'short'].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select></label>
        <label className="field"><span>Budget per creator</span><MoneyField value={q.max_fee ?? null} onChange={(p) => setQ({ ...q, max_fee: p ?? undefined })} /></label>
        <label className="field"><span>Min followers</span><input className="input" type="number" value={q.min_followers ?? ''} onChange={(e) => setQ({ ...q, min_followers: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <label className="field"><span>Brand (conflict check)</span><select className="input" value={q.brand_id ?? ''} onChange={(e) => setQ({ ...q, brand_id: e.target.value ? Number(e.target.value) : undefined })}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
        <label className="check small"><input type="checkbox" checked={q.include_unavailable} onChange={(e) => setQ({ ...q, include_unavailable: e.target.checked })} /> Include unavailable</label>
      </div>
      <div><button className="btn primary" onClick={run}>Find creators</button></div>
      {res && (res.length ? (
        <div className="stack">
          {res.map((r) => (
            <label key={r.id} className="card row nowrap-row" style={{ alignItems: 'flex-start', padding: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.has(r.id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(r.id) : s.delete(r.id); setSel(s); }} />
              <div className="grow stack tight">
                <div className="row between"><span><Link to={`/influencers/${r.id}`} target="_blank"><strong>{r.name}</strong></Link> <span className="muted small">{r.handle} · {r.city}</span></span><Badge tone="info">Score {r.score}</Badge></div>
                <PlatformLinks platforms={r.platforms} />
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.reasons.map((x: string) => <li key={x}>{x}</li>)}</ul>
                {r.warnings.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>⚠ {r.warnings.join(' · ')}</div>}
              </div>
            </label>
          ))}
          {!canRates && <p className="small muted">Rates are hidden for your role.</p>}
          <div className="row">
            <select className="input" style={{ width: 'auto' }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Add selected to">
              <option value="">Add {sel.size} selected to…</option>
              <optgroup label="Deals">{deals.data?.rows.filter((d) => !['won', 'lost'].includes(d.stage)).map((d) => <option key={d.id} value={`deal:${d.id}`}>{d.title}</option>)}</optgroup>
              <optgroup label="Campaigns">{campaigns.map((c) => <option key={c.id} value={`campaign:${c.id}`}>{c.label}</option>)}</optgroup>
            </select>
            <button className="btn primary" disabled={!sel.size || !target} onClick={add}>Add</button>
          </div>
        </div>
      ) : <Empty title="No creators match" hint="Relax a filter — for example budget or follower minimum." />)}
    </div>
  );
}

export function InfluencerPage() {
  const { id } = useParams();
  const q = useApi<Row>(`/api/influencers/${id}/overview`);
  const [tab, setTab] = useState('profile');
  const [editing, setEditing] = useState(false);
  const me = useMe();
  const nav = useNavigate();
  const canEdit = can(me.user.role, 'talent');
  return (
    <Async q={q}>
      {(d) => {
        const r = d.row;
        const rel = d.reliability;
        return (
          <div className="stack">
            <div className="page-head">
              <div className="row nowrap-row" style={{ alignItems: 'flex-start' }}>
                <Avatar r={r} size={56} />
                <div>
                  <h1>{r.name} <DemoTag row={r} /></h1>
                  <div className="row small" style={{ marginTop: 4 }}><span className="muted">{r.handle}</span><Badge value={r.relationship} /><Badge value={r.availability} />{r.city && <span className="muted">{r.city}{r.state ? `, ${r.state}` : ''}</span>}{r.manager_id_label && <span className="muted">· managed by {r.manager_id_label}</span>}</div>
                  <div style={{ marginTop: 6 }}><PlatformLinks platforms={r.platforms} /></div>
                </div>
              </div>
              <div className="row">
                <Link className="btn" to={`/analytics/influencer/${r.id}`}>Weekly analysis</Link>
                {canEdit && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
                <ArchiveButton entity="influencers" row={r} onDone={() => nav('/influencers')} />
              </div>
            </div>
            <div className="grid">
              <Stat label="On-time delivery" value={rel?.on_time_rate != null ? `${rel.on_time_rate}%` : 'Unavailable'} foot={rel ? `${rel.deliverables_measured} live deliverables measured` : 'No delivered work yet'} />
              <Stat label="Revisions per task" value={rel?.avg_revisions ?? 'Unavailable'} foot={rel ? `${rel.tasks_measured} content tasks` : undefined} />
              <Stat label="Approval turnaround" value={rel?.approval_turnaround_days != null ? `${rel.approval_turnaround_days} days` : 'Unavailable'} foot="Submission → approval" />
              <Stat label="Campaigns with us" value={d.campaigns.length} foot={`${d.deals.length} deals`} />
              {r.agreement_end && <Stat label="Agreement ends" value={formatDate(r.agreement_end)} foot={`Reminder ${r.renewal_reminder_days ?? 30} days before`} />}
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[
              { key: 'profile', label: 'Profile' }, { key: 'platforms', label: 'Platforms & rates' }, { key: 'work', label: 'Deals & campaigns' },
              ...(d.payments ? [{ key: 'payments', label: 'Payments' }] : []), { key: 'notes', label: 'Notes & timeline' }, { key: 'documents', label: 'Documents' }, { key: 'activity', label: 'Activity' },
            ]} />
            {tab === 'profile' && (
              <div className="grid two">
                <Card title="Details"><Details entity="influencers" row={r} skip={['name', 'handle', 'photo_url']} /></Card>
                <Card title="Audience" hint={r.audience?.source ? `Source: ${r.audience.source}${r.audience.as_of ? ` · as of ${formatDate(r.audience.as_of)}` : ''}` : 'Source unavailable'}>
                  {r.audience ? <dl className="kv"><dt>Summary</dt><dd>{r.audience.summary ?? '—'}</dd><dt>Top cities</dt><dd>{(r.audience.top_cities ?? []).join(', ') || '—'}</dd></dl> : <Empty title="No audience data recorded" hint="Add it from a screenshot or the creator's insights; record the source." />}
                </Card>
              </div>
            )}
            {tab === 'platforms' && (
              <div className="stack">
                <Card title="Platforms" hint="Each figure shows where it came from and when" flush>
                  <table className="table">
                    <thead><tr><th>Platform</th><th>Handle</th><th className="num">Followers</th><th className="num">Avg views</th><th className="num">Median views</th><th className="num">Engagement</th><th>Source</th><th>As of</th></tr></thead>
                    <tbody>{(r.platforms ?? []).map((p: Row, i: number) => (
                      <tr key={i}><td><a href={p.url} target="_blank" rel="noreferrer">{humanize(p.platform)} <ExternalLink size={11} /></a></td><td>{p.handle}</td>
                        {['followers', 'avg_views', 'median_views'].map((k) => <td key={k} className="num">{p[k] != null ? formatNumberIN(p[k]) : <span className="muted">Unavailable</span>}</td>)}
                        <td className="num">{p.engagement_rate != null ? `${p.engagement_rate}%` : <span className="muted">Unavailable</span>}</td><td className="small">{p.source ?? 'Unknown'}</td><td className="small">{p.updated_at ? formatDate(p.updated_at) : '—'}</td></tr>
                    ))}</tbody>
                  </table>
                  {!r.platforms?.length && <Empty title="No platforms added" />}
                </Card>
                {r.rate_card !== undefined && (
                  <Card title="Rate card & commission" flush>
                    <table className="table">
                      <thead><tr><th>Deliverable</th><th>Platform</th><th className="num">Rate card</th><th className="num">Negotiated</th><th>Notes</th></tr></thead>
                      <tbody>{(r.rate_card ?? []).map((c: Row, i: number) => <tr key={i}><td>{humanize(c.deliverable ?? '')}</td><td>{humanize(c.platform ?? '')}</td><td className="num"><Money p={c.rate} /></td><td className="num"><Money p={c.negotiated_rate} /></td><td className="small">{c.notes}</td></tr>)}</tbody>
                    </table>
                    <div style={{ padding: 12 }} className="small">Commission: {r.commission_type === 'percentage' ? `${(r.commission_rate ?? 0) / 100}%` : r.commission_type === 'fixed' ? formatINR(r.commission_fixed) : 'None'}{r.commission_notes ? ` · ${r.commission_notes}` : ''}</div>
                  </Card>
                )}
              </div>
            )}
            {tab === 'work' && (
              <div className="grid two">
                <Card title="Deals" flush>{d.deals.length ? <table className="table"><tbody>{d.deals.map((x: Row) => <tr key={x.id}><td><Link to={`/deals/${x.id}`}>{x.title}</Link><div className="small muted">{x.brand_name}</div></td><td><Badge value={x.stage} /></td></tr>)}</tbody></table> : <Empty title="No deals yet" />}</Card>
                <Card title="Campaigns" flush>{d.campaigns.length ? <table className="table"><tbody>{d.campaigns.map((x: Row) => <tr key={x.id}><td><Link to={`/campaigns/${x.id}`}>{x.name}</Link><div className="small muted">{x.brand_name} · {formatDate(x.start_date)}</div></td><td><Badge value={x.stage} /></td>{x.fee !== undefined && <td className="num"><Money p={x.fee} /></td>}</tr>)}</tbody></table> : <Empty title="No campaigns yet" />}</Card>
                <Card title="Deliverables" flush>
                  <DataTable rows={d.deliverables} viewKey="influencer-deliverables" columns={[
                    { key: 'title', label: 'Deliverable', render: (x) => <>{x.title}<div className="small muted">{x.campaign_name}</div></> },
                    { key: 'status', label: 'Status', filter: true, render: (x) => <Badge value={x.status} /> },
                    { key: 'due_date', label: 'Due', render: (x) => formatDate(x.due_date) },
                    { key: 'publish_date', label: 'Published', render: (x) => (x.publish_date ? <span className={x.due_date && x.publish_date > x.due_date ? 'neg' : ''}>{formatDate(x.publish_date)}</span> : '—') },
                    { key: 'live_url', label: 'Link', render: (x) => (x.live_url ? <a href={x.live_url} target="_blank" rel="noreferrer">Open</a> : '—') },
                    { key: 'views', label: 'Views', num: true, value: (x) => x.metrics?.views ?? null, render: (x) => (x.metrics?.views != null ? formatNumberIN(x.metrics.views) : <span className="muted">Unavailable</span>) },
                  ]} />
                </Card>
              </div>
            )}
            {tab === 'payments' && d.payments && (
              <div className="stack">
                <div className="grid"><Stat label="Owed (all time)" value={<Money p={d.payments.total_owed} />} /><Stat label="Paid" value={<Money p={d.payments.total_paid} />} /><Stat label="TDS deducted" value={<Money p={d.payments.total_tds} />} /><Stat label="Outstanding" value={<Money p={d.payments.outstanding} />} /></div>
                <Card title="Payouts" flush><PayableTable rows={d.payments.obligations} /></Card>
                {d.commissions?.length > 0 && <Card title="Commission invoices to this creator" flush><table className="table"><tbody>{d.commissions.map((c: Row) => <tr key={c.id}><td><Link to={`/finance/receivables/${c.id}`}>{c.label}</Link> <span className="small muted">{c.number}</span></td><td><Badge value={c.payment_state} /></td><td className="num"><Money p={c.total} /></td><td className="num"><Money p={c.outstanding} /></td></tr>)}</tbody></table></Card>}
              </div>
            )}
            {tab === 'notes' && <Card><Timeline entity="influencers" id={r.id} /></Card>}
            {tab === 'documents' && <LinkedDocuments entity="influencers" id={r.id} docs={d.documents} />}
            {tab === 'activity' && <Card><Activity entity="influencers" id={r.id} /></Card>}
            <Modal open={editing} onClose={() => setEditing(false)} title="Edit influencer"><EntityForm entity="influencers" record={r} onSaved={() => (setEditing(false), q.reload())} /></Modal>
          </div>
        );
      }}
    </Async>
  );
}

export function LinkedDocuments({ entity, id, docs }: { entity: string; id: number; docs: Row[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <Card title="Documents" actions={<button className="btn sm" onClick={() => setAdding(true)}>Add document</button>} flush>
      {docs.length ? <table className="table"><tbody>{docs.map((x) => <tr key={x.id}><td><Link to={`/documents/${x.id}`}>{x.title}</Link></td><td><Badge value={x.kind} /></td><td>{x.expiry_date ? `Expires ${formatDate(x.expiry_date)}` : ''}</td><td>{x.file ? <a href={`/api/documents/${x.id}/file`} target="_blank" rel="noreferrer">File</a> : x.url ? <a href={x.url} target="_blank" rel="noreferrer">Link</a> : '—'}</td></tr>)}</tbody></table> : <Empty title="No documents linked" />}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add document">{adding && <EntityForm entity="documents" initial={{ entity_type: entity, entity_id: id }} onSaved={() => (setAdding(false), invalidate('/api/'))} />}</Modal>
    </Card>
  );
}

export { Shortlist, Avatar };
