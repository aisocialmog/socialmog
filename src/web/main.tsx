import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import {
  BarChart3, Bell, Building2, Clapperboard, FileText, Handshake, HardDrive, LayoutDashboard, ListChecks, LogOut, Megaphone, Menu, Plus,
  Settings as SettingsIcon, Users, Wallet, FileBarChart,
} from 'lucide-react';
import { can, ENTITY, INTERNAL_ROLES, ROLE_LABELS, type Cap } from '../shared/schema.ts';
import { api, ThemeToggle, ArchiveButton, Async, Card, ConfirmHost, Details, EntityForm, fmtDateTime, MeContext, Modal, PageHead, REF_PATHS, Timeline, Activity, Toasts, useApi, useMe, type Me, type Row, Tabs, DemoTag } from './lib.tsx';
import { Overview } from './pages/overview.tsx';
import { Finance } from './pages/finance.tsx';
import { Influencers, InfluencerPage } from './pages/influencers.tsx';
import { Brands, BrandPage, Deals, DealPage } from './pages/crm.tsx';
import { Campaigns, CampaignPage } from './pages/campaigns.tsx';
import { Content, ContentTaskPage, Editors, EditorPage } from './pages/content.tsx';
import { Tasks, TaskPage, Documents, DocumentPage, Assets, AssetPage } from './pages/work.tsx';
import { Analytics } from './pages/analytics.tsx';
import { Reports } from './pages/reports.tsx';
import { Settings } from './pages/settings.tsx';
import { Portal } from './pages/portal.tsx';
import './styles.css';

const NAV: { to: string; label: string; icon: typeof Users; cap: Cap; notEditor?: boolean }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, cap: 'staff', notEditor: true },
  { to: '/influencers', label: 'Influencers', icon: Users, cap: 'staff', notEditor: true },
  { to: '/brands', label: 'Brands & Leads', icon: Building2, cap: 'staff', notEditor: true },
  { to: '/deals', label: 'Deals', icon: Handshake, cap: 'staff', notEditor: true },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone, cap: 'staff', notEditor: true },
  { to: '/content', label: 'Content & Editors', icon: Clapperboard, cap: 'content' },
  { to: '/finance', label: 'Finance', icon: Wallet, cap: 'campaign_finance' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, cap: 'staff', notEditor: true },
  { to: '/reports', label: 'Reports', icon: FileBarChart, cap: 'staff', notEditor: true },
  { to: '/tasks', label: 'Tasks', icon: ListChecks, cap: 'staff' },
  { to: '/documents', label: 'Documents', icon: FileText, cap: 'staff', notEditor: true },
  { to: '/assets', label: 'Assets', icon: HardDrive, cap: 'staff', notEditor: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, cap: 'staff' },
];

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const load = () => api<Me & { user: Me['user'] | null }>('/api/auth/me').then((m) => setMe(m.user ? m : null)).catch(() => setMe(null));
  useEffect(() => {
    load();
    const out = () => setMe(null);
    window.addEventListener('hq:logout', out);
    return () => window.removeEventListener('hq:logout', out);
  }, []);
  if (me === undefined) return <div className="login"><div className="skeleton" style={{ width: 200, height: 20 }} /></div>;
  if (me === null) return <Login onDone={load} />;
  return (
    <MeContext.Provider value={me}>
      <BrowserRouter>
        {INTERNAL_ROLES.includes(me.user.role) ? <Shell /> : <Portal />}
      </BrowserRouter>
      <Toasts />
      <ConfirmHost />
    </MeContext.Provider>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form className="card stack" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await api('/api/auth/login', { body: { email, password } });
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        <div className="brand" style={{ padding: 0 }}><span className="brand-mark">S</span> Socialmog HQ</div>
        <p className="muted">Sign in to the agency workspace.</p>
        {error && <div className="alert bad" role="alert">{error}</div>}
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted">Brands and creators with portal access sign in here too.</p>
      </form>
    </div>
  );
}

function Shell() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const editor = me.user.role === 'editor';
  return (
    <div className="shell">
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Main">
        <div className="brand"><span className="brand-mark">S</span> Socialmog HQ</div>
        {NAV.filter((n) => can(me.user.role, n.cap) && !(editor && n.notEditor)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><n.icon /> {n.label}</NavLink>
        ))}
        <span className="grow" />
        <div className="small muted" style={{ padding: '8px 10px' }}>{me.user.name}<br />{ROLE_LABELS[me.user.role]}</div>
        <button className="nav-link btn ghost" style={{ justifyContent: 'flex-start' }} onClick={async () => { await api('/api/auth/logout', { body: {} }); location.href = '/'; }}><LogOut /> Sign out</button>
      </nav>
      <div className="main">
        {me.demo && <div className="demo-banner">DEMO DATA LOADED — figures are illustrative. Remove it from Settings → Data before entering real records.</div>}
        <header className="topbar">
          <button className="btn ghost sm menu-btn" aria-label="Open menu" onClick={() => setOpen(!open)}><Menu /></button>
          {!editor && <Search />}
          <span className="grow" />
          {!editor && <QuickAdd />}
          <Notifications />
          <ThemeToggle />
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={editor ? <Navigate to="/content" replace /> : <Overview />} />
            <Route path="/finance/*" element={<Finance />} />
            <Route path="/influencers" element={<Influencers />} />
            <Route path="/influencers/:id" element={<InfluencerPage />} />
            <Route path="/brands" element={<Brands />} />
            <Route path="/brands/:id" element={<BrandPage />} />
            <Route path="/deals" element={<Deals />} />
            <Route path="/deals/:id" element={<DealPage />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/:id" element={<CampaignPage />} />
            <Route path="/content" element={<Content />} />
            <Route path="/content/:id" element={<ContentTaskPage />} />
            <Route path="/editors" element={<Editors />} />
            <Route path="/editors/:id" element={<EditorPage />} />
            <Route path="/analytics/*" element={<Analytics />} />
            <Route path="/reports/*" element={<Reports />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/tasks/:id" element={<TaskPage />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/documents/:id" element={<DocumentPage />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/assets/:id" element={<AssetPage />} />
            <Route path="/settings/*" element={<Settings />} />
            <Route path="/r/:entity/:id" element={<RecordPage />} />
            <Route path="*" element={<Card><p>Page not found. <Link to="/">Go to overview</Link></p></Card>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Search() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const timer = useRef<number>(0);
  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) return setRes([]);
    timer.current = window.setTimeout(() => api(`/api/search?q=${encodeURIComponent(q)}`).then((d) => (setRes(d.results), setActive(0))).catch(() => setRes([])), 180);
  }, [q]);
  return (
    <div className="searchbox">
      <input className="input" placeholder="Search creators, brands, deals, campaigns…" value={q} aria-label="Global search"
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive(Math.min(active + 1, res.length - 1));
          if (e.key === 'ArrowUp') setActive(Math.max(active - 1, 0));
          if (e.key === 'Enter' && res[active]) { nav(res[active].link); setQ(''); }
        }} />
      {open && q.length >= 2 && (
        <div className="search-results">
          {res.length ? res.map((r, i) => (
            <a key={`${r.entity}${r.id}`} href={r.link} className={i === active ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); nav(r.link); setQ(''); }}>
              <span className="ellipsis">{r.title}</span><span className="badge">{r.label}</span>
            </a>
          )) : <div className="empty small">No matches</div>}
        </div>
      )}
    </div>
  );
}

const QUICK: { entity: string; cap: Cap; label: string }[] = [
  { entity: 'tasks', cap: 'staff', label: 'Task' },
  { entity: 'influencers', cap: 'talent', label: 'Influencer' },
  { entity: 'brands', cap: 'sales', label: 'Brand / lead' },
  { entity: 'deals', cap: 'sales', label: 'Deal' },
  { entity: 'campaigns', cap: 'campaigns', label: 'Campaign' },
  { entity: 'content_tasks', cap: 'campaigns', label: 'Content task' },
  { entity: 'invoices', cap: 'finance', label: 'Receivable / invoice' },
  { entity: 'obligations', cap: 'finance', label: 'Payable' },
  { entity: 'documents', cap: 'staff', label: 'Document' },
  { entity: 'assets', cap: 'finance', label: 'Asset' },
];

function QuickAdd() {
  const me = useMe();
  const [menu, setMenu] = useState(false);
  const [entity, setEntity] = useState<string | null>(null);
  const nav = useNavigate();
  const items = QUICK.filter((q) => can(me.user.role, q.cap));
  return (
    <div className="rel">
      <button className="btn primary sm" onClick={() => setMenu(!menu)} aria-expanded={menu}><Plus /> <span className="hide-mobile">New</span></button>
      {menu && (
        <div className="popover" style={{ width: 220, padding: 6 }} onMouseLeave={() => setMenu(false)}>
          {items.map((q) => <button key={q.entity} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => (setEntity(q.entity), setMenu(false))}>{q.label}</button>)}
          {can(me.user.role, 'finance') && <button className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => (nav('/finance/transactions?new=1'), setMenu(false))}>Record payment / receipt</button>}
        </div>
      )}
      <Modal open={!!entity} onClose={() => setEntity(null)} title={entity ? `New ${ENTITY[entity].label.toLowerCase()}` : ''}>
        {entity && <EntityForm entity={entity} onSaved={(r) => { const e = entity; setEntity(null); nav(`/${REF_PATHS[e] ?? `r/${e}`}/${r.id}`); }} />}
      </Modal>
    </div>
  );
}

function Notifications() {
  const q = useApi<{ rows: Row[] }>('/api/notifications');
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    const t = setInterval(q.reload, 60_000);
    return () => clearInterval(t);
  }, []);
  const unread = q.data?.rows.filter((n) => !n.read_at).length ?? 0;
  return (
    <div className="rel">
      <button className="btn ghost sm" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen(!open)}>
        <Bell />{unread > 0 && <span className="badge bad" style={{ padding: '0 6px' }}>{unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <div className="row between" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <strong>Notifications</strong>
            {unread > 0 && <button className="btn ghost sm" onClick={async () => { await api('/api/notifications/read', { body: {} }); q.reload(); }}>Mark all read</button>}
          </div>
          {q.data?.rows.length ? q.data.rows.slice(0, 30).map((n) => (
            <button key={n.id} className="attention-item btn ghost" style={{ width: '100%', height: 'auto', textAlign: 'left', borderRadius: 0, fontWeight: n.read_at ? 400 : 600 }} onClick={async () => {
              await api('/api/notifications/read', { body: { ids: [n.id] } });
              setOpen(false);
              q.reload();
              if (n.link) nav(n.link);
            }}>
              <span className="stack tight" style={{ gap: 2 }}><span>{n.title}</span>{n.body && <span className="small muted">{n.body}</span>}<span className="small muted">{fmtDateTime(n.created_at)}</span></span>
            </button>
          )) : <div className="empty small">You're all caught up</div>}
        </div>
      )}
    </div>
  );
}

/** Generic record page for entities without a dedicated screen. */
function RecordPage() {
  const { entity = '', id = '' } = useParams();
  const e = ENTITY[entity];
  const q = useApi<{ row: Row }>(e ? `/api/e/${entity}/${id}` : null);
  const [tab, setTab] = useState('details');
  const [editing, setEditing] = useState(false);
  const me = useMe();
  if (!e) return <Card>Unknown record type.</Card>;
  return (
    <Async q={q}>
      {({ row }) => (
        <div className="stack">
          <PageHead title={<>{String(row[e.title] ?? row[`${e.title}_label`] ?? `${e.label} #${row.id}`)} <DemoTag row={row} /></>} sub={e.label}
            actions={<>{can(me.user.role, e.write) && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}<ArchiveButton entity={entity} row={row} onDone={q.reload} /></>} />
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'details', label: 'Details' }, { key: 'notes', label: 'Notes' }, { key: 'activity', label: 'Activity' }]} />
          {tab === 'details' && <Card><Details entity={entity} row={row} /></Card>}
          {tab === 'notes' && <Card><Timeline entity={entity} id={row.id} /></Card>}
          {tab === 'activity' && <Card><Activity entity={entity} id={row.id} /></Card>}
          <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${e.label.toLowerCase()}`}>
            <EntityForm entity={entity} record={row} onSaved={() => (setEditing(false), q.reload())} />
          </Modal>
        </div>
      )}
    </Async>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
