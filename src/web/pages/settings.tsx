import { useState } from 'react';
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router';
import { formatDate } from '../../shared/dates.ts';
import { can, ROLE_LABELS, ROLES } from '../../shared/schema.ts';
import { Activity, api, Async, attempt, Badge, Card, DataTable, Details, EntityForm, fmtDateTime, invalidate, Modal, Money, PageHead, toast, useApi, useCan, useMe, type Row } from '../lib.tsx';
import { PayableTable } from './finance.tsx';

export function Settings() {
  const me = useMe();
  const admin = can(me.user.role, 'admin');
  const tabs: [string, string, boolean][] = [
    ['/settings', 'My account', true],
    ['/settings/payments', 'My payments', me.user.role === 'editor'],
    ['/settings/users', 'Users & roles', admin],
    ['/settings/finance', 'Finance rules', admin],
    ['/settings/agency', 'Agency & media kit', admin],
    ['/settings/automation', 'Automation', admin],
    ['/settings/data', 'Data & backups', admin],
    ['/settings/audit', 'Audit log', admin],
  ];
  return (
    <div className="stack">
      <div className="tabs">{tabs.filter((t) => t[2]).map(([to, l]) => <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'on' : '')}>{l}</NavLink>)}</div>
      <Routes>
        <Route index element={<Account />} />
        <Route path="payments" element={<MyPayments />} />
        <Route path="users" element={<Users />} />
        <Route path="users/:id" element={<UserPage />} />
        <Route path="finance" element={<FinanceRules />} />
        <Route path="agency" element={<Agency />} />
        <Route path="automation" element={<Automation />} />
        <Route path="data" element={<Data />} />
        <Route path="audit" element={<Audit />} />
      </Routes>
    </div>
  );
}

function Account() {
  const me = useMe();
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  return (
    <div className="grid two">
      <Card title="Profile"><dl className="kv"><dt>Name</dt><dd>{me.user.name}</dd><dt>Email</dt><dd>{me.user.email}</dd><dt>Role</dt><dd>{ROLE_LABELS[me.user.role]}</dd><dt>Timezone</dt><dd>{me.timezone}</dd><dt>Currency</dt><dd>INR (Indian number format)</dd></dl></Card>
      <Card title="Change password" hint="At least 10 characters. Other sessions are signed out.">
        <div className="stack">
          <label className="field"><span>Current password</span><input className="input" type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} /></label>
          <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} /></label>
          <label className="field"><span>Repeat new password</span><input className="input" type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} />{v.confirm && v.confirm !== v.next && <span className="error">Passwords don't match</span>}</label>
          <div><button className="btn primary" disabled={!v.current || v.next.length < 10 || v.next !== v.confirm} onClick={async () => { if (await attempt(() => api('/api/auth/password', { body: { current: v.current, next: v.next } }), 'Password changed')) setV({ current: '', next: '', confirm: '' }); }}>Change password</button></div>
        </div>
      </Card>
    </div>
  );
}

export function MyPayments() {
  const q = useApi<Row>('/api/my/payments');
  return (
    <Async q={q}>{(d) => (
      <div className="stack">
        <PageHead title="My payments" sub="What Socialmog owes you, what has been paid and any TDS deducted" />
        <div className="grid"><Card title="Owed"><Money p={d.total_owed} /></Card><Card title="Paid"><Money p={d.total_paid} /></Card><Card title="TDS deducted"><Money p={d.total_tds} /></Card><Card title="Outstanding"><Money p={d.outstanding} /></Card></div>
        <Card title="Payables" flush><PayableTable rows={d.obligations} /></Card>
        <Card title="Payments received" flush><table className="table"><tbody>{d.payments.map((p: Row) => <tr key={p.id}><td>{formatDate(p.settled_on)}</td><td>{p.description}</td><td><Badge value={p.kind} /></td><td>{p.reference ?? ''}</td><td className="num"><Money p={p.amount} /></td></tr>)}</tbody></table></Card>
      </div>
    )}</Async>
  );
}

function Users() {
  const q = useApi<{ rows: Row[] }>('/api/e/users');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  return (
    <div className="stack">
      <PageHead title="Users & roles" sub="Permissions are enforced on the server. External brand and creator users only see their portal." actions={<button className="btn primary" onClick={() => setCreating(true)}>Invite user</button>} />
      <Card title="What each role can do">
        <table className="table small">
          <thead><tr><th>Role</th><th>Access</th></tr></thead>
          <tbody>
            <tr><td>Founder / Admin</td><td>Everything, including users, settings, backups and the audit log</td></tr>
            <tr><td>Finance</td><td>Bank accounts, cash, transactions, payments, forecasts, identity & bank details; read-only on operations</td></tr>
            <tr><td>Campaign Manager</td><td>Brands, deals, campaigns, content, campaign budgets/invoices/payables (no bank balances or identity details)</td></tr>
            <tr><td>Talent Manager</td><td>Influencer roster, rates & commissions, deals, analytics (no invoices, payables or bank data)</td></tr>
            <tr><td>Editor</td><td>Only assigned content tasks, own tasks and own payment information</td></tr>
            <tr><td>Brand (external)</td><td>Portal: their campaigns, deliverables, approvals, invoices and shared documents — no margins or creator fees</td></tr>
            <tr><td>Creator (external)</td><td>Portal: their deliverables, payment status, weekly reports and shared documents</td></tr>
          </tbody>
        </table>
      </Card>
      <Async q={q}>{(d) => <DataTable rows={d.rows} viewKey="users" onRowClick={(r) => nav(`/settings/users/${r.id}`)} columns={[
        { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role', filter: true, render: (r) => ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] },
        { key: 'status', label: 'Status', filter: true, render: (r) => <Badge value={r.status} /> }, { key: 'last_login_at', label: 'Last sign-in', render: (r) => fmtDateTime(r.last_login_at) },
      ]} />}</Async>
      <Modal open={creating} onClose={() => setCreating(false)} title="Invite user"><NewUser onDone={() => (setCreating(false), q.reload())} /></Modal>
    </div>
  );
}

function NewUser({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState<Row>({ role: 'campaign_manager', status: 'active' });
  const [pw] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join(''));
  const [err, setErr] = useState('');
  const brands = useApi<{ rows: Row[] }>('/api/e/brands');
  const infs = useApi<{ rows: Row[] }>('/api/e/influencers');
  const eds = useApi<{ rows: Row[] }>('/api/e/editors');
  return (
    <div className="stack">
      {err && <div className="alert bad">{err}</div>}
      <div className="form-grid">
        <label className="field"><span>Name</span><input className="input" value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label className="field"><span>Email</span><input className="input" type="email" value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
        <label className="field"><span>Role</span><select className="input" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
        {v.role === 'brand' && <label className="field"><span>Brand</span><select className="input" value={v.brand_id ?? ''} onChange={(e) => setV({ ...v, brand_id: Number(e.target.value) })}><option value="">Choose…</option>{brands.data?.rows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        {v.role === 'creator' && <label className="field"><span>Creator profile</span><select className="input" value={v.influencer_id ?? ''} onChange={(e) => setV({ ...v, influencer_id: Number(e.target.value) })}><option value="">Choose…</option>{infs.data?.rows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        {v.role === 'editor' && <label className="field"><span>Editor profile</span><select className="input" value={v.editor_id ?? ''} onChange={(e) => setV({ ...v, editor_id: Number(e.target.value) })}><option value="">Choose…</option>{eds.data?.rows.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      </div>
      <div className="alert info small">Temporary password: <strong>{pw}</strong> — share it with them yourself (nothing is emailed). They should change it after signing in.</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={async () => {
        try {
          await api('/api/users', { body: { ...v, password: pw } });
          toast('User created');
          invalidate('/api/e/users');
          onDone();
        } catch (e) {
          setErr((e as Error).message);
        }
      }}>Create user</button></div>
    </div>
  );
}

function UserPage() {
  const { id } = useParams();
  const q = useApi<{ row: Row }>(`/api/e/users/${id}`);
  const [editing, setEditing] = useState(false);
  return (
    <Async q={q}>{({ row }) => (
      <div className="stack">
        <PageHead title={row.name} sub={`${ROLE_LABELS[row.role as keyof typeof ROLE_LABELS]} · ${row.email}`} actions={<>
          <button className="btn" onClick={() => setEditing(true)}>Edit role / status</button>
          <button className="btn" onClick={async () => {
            const pw = window.prompt('New temporary password (min 10 characters). Share it with the user yourself.');
            if (pw && (await attempt(() => api(`/api/users/${row.id}/password`, { body: { password: pw } }), 'Password reset; their sessions were signed out'))) q.reload();
          }}>Reset password</button>
        </>} />
        <Card><Details entity="users" row={row} /></Card>
        <Card title="Activity"><Activity entity="users" id={row.id} /></Card>
        <Modal open={editing} onClose={() => setEditing(false)} title="Edit user"><EntityForm entity="users" record={row} fields={['name', 'role', 'status', 'title', 'phone', 'editor_id', 'influencer_id', 'brand_id']} onSaved={() => (setEditing(false), q.reload())} /></Modal>
      </div>
    )}</Async>
  );
}

function FinanceRules() {
  const q = useApi<Row>('/api/settings');
  return (
    <Async q={q}>{(s) => {
      const rec = s.recognition ?? { basis: 'invoice', creatorPassThrough: true, assets: 'capitalise' };
      const save = (key: string, value: unknown) => attempt(() => api(`/api/settings/${key}`, { method: 'PUT', body: { value } }), 'Saved').then((ok) => ok && (q.reload(), invalidate('/api/')));
      return (
        <div className="stack">
          <PageHead title="Finance rules" sub="How earnings are recognised. Cash reports never change with these rules." />
          <Card title="Earnings recognition">
            <div className="stack">
              <label className="field"><span>Recognise agency earnings</span><select className="input" style={{ maxWidth: 420 }} value={rec.basis} onChange={(e) => save('recognition', { ...rec, basis: e.target.value })}>
                <option value="invoice">When an invoice is issued (accrual)</option><option value="cash">When money is received (cash)</option><option value="completion">When the campaign goes live (completion)</option>
              </select></label>
              <label className="check"><input type="checkbox" checked={rec.creatorPassThrough} onChange={(e) => save('recognition', { ...rec, creatorPassThrough: e.target.checked })} /> Creator fees on gross campaigns are pass-through (agency earnings = billing − creator fees)</label>
              <label className="field"><span>Asset purchases</span><select className="input" style={{ maxWidth: 420 }} value={rec.assets} onChange={(e) => save('recognition', { ...rec, assets: e.target.value })}><option value="capitalise">Capitalise (show depreciation where useful life is set)</option><option value="expense">Expense in full when paid</option></select></label>
              <p className="small muted">Formal accounting treatment (GST returns, statutory books) should be confirmed with your CA; these settings only control management reports.</p>
            </div>
          </Card>
          <Card title="Region">
            <label className="field"><span>Timezone</span><select className="input" style={{ maxWidth: 320 }} value={s.timezone ?? 'Asia/Kolkata'} onChange={(e) => save('timezone', e.target.value)}>{['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'].map((t) => <option key={t}>{t}</option>)}</select></label>
          </Card>
        </div>
      );
    }}</Async>
  );
}

function Agency() {
  const s = useApi<Row>('/api/settings');
  const [v, setV] = useState<Row | null>(null);
  const cur: Row = v ?? s.data?.agency ?? {};
  const field = (k: string, label: string, type = 'text') => <label className="field"><span>{label}</span><input className="input" type={type} value={cur[k] ?? ''} onChange={(e) => setV({ ...cur, [k]: e.target.value || null })} /></label>;
  return (
    <div className="stack">
      <PageHead title="Agency & media kit" sub="Shown on brand media kits under “Work with us”. Creator contact details are never printed on kits." />
      <Card>
        <div className="form-grid">
          {field('name', 'Agency name')}
          {field('email', 'Brand enquiries email', 'email')}
          {field('phone', 'Phone')}
          {field('website', 'Website', 'url')}
          <label className="field full"><span>Note printed on every kit</span><textarea className="input" rows={3} value={cur.kit_note ?? ''} placeholder="Prices are per deliverable, exclude GST, and depend on usage rights, exclusivity and timelines…" onChange={(e) => setV({ ...cur, kit_note: e.target.value || null })} /></label>
        </div>
        <div className="row"><span className="grow" /><button className="btn primary" disabled={!v} onClick={async () => { if (await attempt(() => api('/api/settings/agency', { method: 'PUT', body: { value: cur } }), 'Saved')) { setV(null); s.reload(); } }}>Save</button></div>
      </Card>
    </div>
  );
}

function Automation() {
  const s = useApi<Row>('/api/settings');
  const jobs = useApi<{ rows: Row[] }>('/api/admin/jobs');
  const sched = s.data?.analysis_schedule ?? { enabled: true, weekday: 1, time: '09:00' };
  const save = (value: Row) => attempt(() => api('/api/settings/analysis_schedule', { method: 'PUT', body: { value } }), 'Schedule saved').then(() => s.reload());
  return (
    <div className="stack">
      <PageHead title="Automation" sub="In-app reminders and analysis run automatically. Nothing is emailed, messaged or paid without someone clicking." />
      <Card title="Weekly influencer analysis">
        <div className="row">
          <label className="check"><input type="checkbox" checked={sched.enabled !== false} onChange={(e) => save({ ...sched, enabled: e.target.checked })} /> Enabled</label>
          <select className="input" style={{ width: 'auto' }} value={sched.weekday} onChange={(e) => save({ ...sched, weekday: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <input className="input" style={{ width: 'auto' }} type="time" value={sched.time} onChange={(e) => save({ ...sched, time: e.target.value })} />
          <span className="small muted">{s.data?.timezone ?? 'Asia/Kolkata'} · analyses the previous Monday–Sunday · one run per week (duplicates prevented), up to 3 attempts, founder notified on failure</span>
        </div>
      </Card>
      <Card title="Weekly ChatGPT analysis package" hint="Manual ChatGPT analysis: the package and prompt are prepared on the same schedule; running it in ChatGPT and importing the result stays with you.">
        <label className="check"><input type="checkbox" checked={s.data?.chatgpt_prep?.enabled !== false} onChange={(e) => attempt(() => api('/api/settings/chatgpt_prep', { method: 'PUT', body: { value: { enabled: e.target.checked } } }), 'Saved').then(() => s.reload())} /> Prepare the weekly influencer package automatically and show an in-app reminder</label>
      </Card>
      <Card title="Other scheduled jobs"><ul className="small"><li>Daily 08:00 — in-app reminders for urgent items (overdue payments, shortfalls, renewals)</li><li>Daily 02:00 — database backup kept for 14 days in the data folder</li><li>Mondays / 1st of month — report templates with a schedule</li></ul></Card>
      <Card title="Job history" flush>
        <Async q={jobs}>{(d) => <DataTable rows={d.rows} viewKey="jobs" columns={[
          { key: 'created_at', label: 'Created', render: (r) => <span className="small">{fmtDateTime(r.created_at)}</span> }, { key: 'kind', label: 'Job', filter: true },
          { key: 'unique_key', label: 'Key' }, { key: 'status', label: 'Status', filter: true, render: (r) => <Badge value={r.status} /> }, { key: 'attempts', label: 'Attempts', num: true },
          { key: 'last_error', label: 'Error', render: (r) => <span className="small neg">{r.last_error}</span> },
          { key: 'retry', label: '', render: (r) => (r.status === 'failed' ? <button className="btn sm" onClick={async () => { if (await attempt(() => api(`/api/admin/jobs/${r.id}/retry`, { body: {} }), 'Queued for retry')) jobs.reload(); }}>Retry</button> : '') },
        ]} />}</Async>
      </Card>
    </div>
  );
}

function Data() {
  const me = useMe();
  const [confirm, setConfirm] = useState('');
  return (
    <div className="stack">
      <PageHead title="Data & backups" />
      <div className="grid two">
        <Card title="Backups & export" hint="Daily automatic backups are kept for 14 days in the server's data folder. Download one before major changes.">
          <div className="row"><a className="btn" href="/api/admin/backup">Download database backup</a><a className="btn" href="/api/admin/export.json">Export all records (JSON)</a></div>
          <p className="small muted" style={{ marginTop: 8 }}>Restore: stop the server, replace data/hq.sqlite with a backup file, start again.</p>
        </Card>
        <Card title="Demo data" hint={me.demo ? 'Demo records are loaded and marked DEMO.' : 'No demo data loaded.'}>
          {me.demo ? (
            <div className="stack tight">
              <p className="small">Deletes every record flagged as demo (including demo users). Records you created yourself are kept.</p>
              <input className="input" placeholder="Type REMOVE DEMO DATA" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <div><button className="btn danger" disabled={confirm !== 'REMOVE DEMO DATA'} onClick={async () => { if (await attempt(() => api('/api/admin/demo/remove', { body: { confirm } }), 'Demo data removed')) location.reload(); }}>Remove demo data</button></div>
            </div>
          ) : <p className="small muted">Start the server with an empty database and SEED_DEMO=1 to load it again.</p>}
        </Card>
      </div>
    </div>
  );
}

function Audit() {
  const q = useApi<{ rows: Row[] }>('/api/activity');
  const canAdmin = useCan('admin');
  if (!canAdmin) return null;
  return (
    <Async q={q}>{(d) => <DataTable rows={d.rows} viewKey="audit" pageSize={50} columns={[
      { key: 'created_at', label: 'When', render: (r) => <span className="small nowrap">{fmtDateTime(r.created_at)}</span> }, { key: 'user_name', label: 'Who', filter: true },
      { key: 'action', label: 'Action', filter: true }, { key: 'entity', label: 'Record', filter: true, render: (r) => `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` },
      { key: 'note', label: 'Note' }, { key: 'after', label: 'Changes', render: (r) => <span className="small muted">{r.after ? JSON.stringify(r.after).slice(0, 140) : ''}</span>, value: (r) => JSON.stringify(r.after ?? '') },
    ]} />}</Async>
  );
}
