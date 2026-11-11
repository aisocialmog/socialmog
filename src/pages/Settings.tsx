import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../components/ui/Avatar'
import { Card, EmptyState, MoreMenu, Pill } from '../components/ui/kit'
import { Icon } from '../components/ui/Icon'
import { Modal } from '../components/ui/Modal'
import { EnsoSpinner } from '../components/art/Ink'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { isStaff, ROLE_HELP, ROLE_LABEL, type Role } from '../lib/access'
import { formatDate, formatINR, istToday } from '../lib/format'
import { downloadCSV } from '../lib/csv'
import { FormError, FormNote } from './auth/AuthLayout'

interface TeamRow {
  id: string; name: string; email: string; phone: string | null; title: string | null; photo_path: string | null
  role: Role; status: 'active' | 'inactive'; joined_date: string; monthly_cost: number | null
  user_id: string | null; invited_at: string | null; first_signed_in_at: string | null
}
const ROLES: Role[] = ['founder', 'manager', 'team_member', 'freelancer']

export function Settings() {
  const { role } = useAuth()
  const [tab, setTab] = useState<'profile' | 'team'>('profile')
  const tabs = isStaff(role) ? (['profile', 'team'] as const) : (['profile'] as const)
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow mb-2"><span lang="ja" className="font-mincho text-accent-ink normal-case tracking-normal text-sm mr-2">設</span>Settings</p>
        <h1 className="font-mincho text-3xl text-ink">Settings</h1>
      </header>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-line/25">
          {tabs.map(t => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`relative px-4 h-11 text-sm ${tab === t ? 'text-ink' : 'text-muted hover:text-ink'}`}>
              {t === 'profile' ? 'My profile' : 'Team'}
              {tab === t && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-accent rounded-full" />}
            </button>
          ))}
        </div>
      )}
      {tab === 'profile' ? <Profile /> : <Team />}
      {role === 'founder' && (
        <Link to="/settings/opening" className="shoji shoji-pad flex items-center justify-between gap-4 hover:bg-raised/60 transition-colors duration-calm">
          <span className="min-w-0">
            <span className="block text-ink font-medium">Opening balances &amp; import — one-time setup</span>
            <span className="block text-sm text-muted mt-0.5">Set the go-live date, opening capital, account balances and unpaid items from before. Founders only.</span>
          </span>
          <Icon name="chevronRight" className="text-muted shrink-0" />
        </Link>
      )}
      {(role === 'founder' || role === 'manager') && [
        ['/settings/automations', 'Automations', 'What the system does by itself: on/off, last run, results, run now. Task templates and messages to approve.'],
        ['/settings/ai', 'AI providers', 'Provider order, models and daily usage.'],
        ...(role === 'founder' ? [['/settings/integrations', 'Integrations — Ops Board', 'API key, allowed website, webhooks and the API document.']] : []),
      ].map(([to, title, about]) => (
        <Link key={to} to={to} className="shoji shoji-pad flex items-center justify-between gap-4 hover:bg-raised/60 transition-colors duration-calm">
          <span className="min-w-0"><span className="block text-ink font-medium">{title}</span><span className="block text-sm text-muted mt-0.5">{about}</span></span>
          <Icon name="chevronRight" className="text-muted shrink-0" />
        </Link>))}
      <p className="text-xs text-muted">Company details, security and backups arrive with feature 13.</p>
    </div>
  )
}

// ─── My profile ──────────────────────────────────────────────
function Profile() {
  const { member, refreshMember, isPreview } = useAuth()
  const [name, setName] = useState(member?.name ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')
  const [title, setTitle] = useState(member?.title ?? '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  if (!member) return null

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !member) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('team_members')
      .update({ name: name.trim(), phone: phone.trim() || null, title: title.trim() || null }).eq('id', member.id)
    setBusy(false)
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Saved.' })
    if (!error) refreshMember()
  }

  async function upload(file: File) {
    if (!supabase || !member) return
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { setMsg({ ok: false, text: 'Use a PNG, JPG or WebP image.' }); return }
    if (file.size > 3 * 1024 * 1024) { setMsg({ ok: false, text: 'Keep the photo under 3 MB.' }); return }
    setBusy(true); setMsg(null)
    const path = `${member.id}/avatar-${Date.now()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`
    const up = await supabase.storage.from('avatars').upload(path, file, { upsert: false, contentType: file.type })
    const err = up.error ?? (await supabase.from('team_members').update({ photo_path: path }).eq('id', member.id)).error
    setBusy(false)
    setMsg(err ? { ok: false, text: err.message } : { ok: true, text: 'Photo updated.' })
    if (!err) refreshMember()
  }

  return (
    <Card className="shoji-pad max-w-2xl">
      <div className="flex items-center gap-5">
        <Avatar name={member.name} path={member.photo_path} size={72} />
        <div>
          <p className="text-ink text-lg">{member.name}</p>
          <p className="text-sm text-muted">{ROLE_LABEL[member.role]} · joined {formatDate(member.joined_date)}</p>
          <label className={`btn-ghost h-9 text-sm mt-3 cursor-pointer ${isPreview ? 'opacity-50 pointer-events-none' : ''}`}>
            Change photo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={isPreview || busy}
                   onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
      </div>
      <form onSubmit={save} className="mt-6 grid sm:grid-cols-2 gap-4">
        <label className="text-sm text-muted sm:col-span-2">Name<input className="field mt-1.5" value={name} onChange={e => setName(e.target.value)} required /></label>
        <label className="text-sm text-muted">Phone<input className="field mt-1.5" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91" /></label>
        <label className="text-sm text-muted">Title<input className="field mt-1.5" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Video editor" /></label>
        <label className="text-sm text-muted sm:col-span-2">Email<input className="field mt-1.5 opacity-70" value={member.email} readOnly aria-describedby="email-help" />
          <span id="email-help" className="block text-xs mt-1">Only a founder can change the email a login uses.</span></label>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button className="btn-primary" disabled={busy || isPreview}>{busy ? 'Saving…' : 'Save profile'}</button>
          {msg && (msg.ok ? <span role="status" className="text-sm text-muted">{msg.text}</span> : <FormError>{msg.text}</FormError>)}
          {isPreview && <span className="text-xs text-muted">Saving needs the database.</span>}
        </div>
      </form>
    </Card>
  )
}

// ─── Team (founders manage; managers can look) ───────────────
function Team() {
  const { role, isPreview, member } = useAuth()
  const founder = role === 'founder'
  const [rows, setRows] = useState<TeamRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<TeamRow | null>(null)

  const load = useCallback(async () => {
    if (!supabase) {
      setRows(isPreview && member ? [
        { ...member, monthly_cost: null, user_id: 'x', invited_at: null, first_signed_in_at: '2026-11-01T00:00:00Z' } as TeamRow,
        { ...member, id: 'p2', name: '[Founder 2 name]', email: 'founder2@example.com', user_id: null, monthly_cost: null, invited_at: '2026-11-01T00:00:00Z', first_signed_in_at: null } as TeamRow,
      ] : [])
      return
    }
    const { data, error } = await supabase.from('team_members')
      .select('id, name, email, phone, title, photo_path, role, status, joined_date, monthly_cost, user_id, invited_at, first_signed_in_at')
      .eq('is_archived', false).order('status').order('name')
    if (error) setError(error.message)
    setRows((data as TeamRow[]) ?? [])
  }, [isPreview, member])
  useEffect(() => { load() }, [load])

  const stateOf = (r: TeamRow) => r.status === 'inactive' ? 'Inactive' : r.first_signed_in_at ? 'Active' : 'Invited'
  const exportCsv = () => rows && downloadCSV(`team-${istToday()}.csv`, rows, [
    { header: 'Name', value: r => r.name }, { header: 'Email', value: r => r.email }, { header: 'Phone', value: r => r.phone },
    { header: 'Role', value: r => ROLE_LABEL[r.role] }, { header: 'Status', value: stateOf },
    { header: 'Joined', value: r => formatDate(r.joined_date) }, { header: 'Monthly cost (INR)', value: r => r.monthly_cost },
  ])
  const payroll = (rows ?? []).filter(r => r.status === 'active').reduce((s, r) => s + (Number(r.monthly_cost) || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted num">{rows?.filter(r => r.status === 'active').length ?? 0} active · monthly team cost {formatINR(payroll)}</p>
        <div className="flex items-center gap-1">
          {founder && <button className="btn-primary" onClick={() => setInviting(true)}><Icon name="plus" /> Invite person</button>}
          <MoreMenu items={[{ label: 'Export team (CSV)', onSelect: exportCsv }]} />
        </div>
      </div>
      {!founder && <FormNote>Only founders can invite people or change roles.</FormNote>}
      {error && <FormError>{error}</FormError>}
      {inviting && <InviteForm onClose={() => setInviting(false)} onDone={() => { setInviting(false); load() }} />}

      {rows === null ? <div className="p-6"><EnsoSpinner /></div> : rows.length === 0 ? (
        <div className="shoji"><EmptyState line="Still water. Invite your first teammate." /></div>
      ) : (
        <ul className="shoji divide-y divide-line/15">
          {rows.map(r => (
            <li key={r.id} className="p-4 sm:px-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Avatar name={r.name} path={r.photo_path} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-ink truncate">{r.name} {r.id === member?.id && <span className="text-xs text-muted">(you)</span>}</p>
                <p className="text-xs text-muted truncate">{r.email}{r.title ? ` · ${r.title}` : ''}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone={r.role === 'founder' ? 'accent' : 'quiet'}>{ROLE_LABEL[r.role]}</Pill>
                <Pill tone={stateOf(r) === 'Inactive' ? 'alert' : stateOf(r) === 'Invited' ? 'warm' : 'quiet'}>{stateOf(r)}</Pill>
              </div>
              <div className="text-right text-xs text-muted w-28 hidden sm:block">
                <p>Joined {formatDate(r.joined_date)}</p>
                <p className="num text-ink">{r.monthly_cost != null ? `${formatINR(r.monthly_cost)}/mo` : '—'}</p>
              </div>
              {founder && <button className="icon-btn" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Icon name="edit" /></button>}
            </li>
          ))}
        </ul>
      )}
      {editing && <EditMember row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />}
    </div>
  )
}

function RolePicker({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm text-muted mb-2">Role</legend>
      <div className="grid sm:grid-cols-2 gap-2">
        {ROLES.map(r => (
          <label key={r} className={`rounded-shoji border px-3 py-2.5 cursor-pointer ${value === r ? 'border-accent bg-raised' : 'border-line/30'}`}>
            <span className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="role" value={r} checked={value === r} onChange={() => onChange(r)} className="accent-[#E3793A]" />{ROLE_LABEL[r]}
            </span>
            <span className="block text-xs text-muted mt-1">{ROLE_HELP[r]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function InviteForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { isPreview } = useAuth()
  const [f, setF] = useState({ name: '', email: '', phone: '', title: '', role: 'team_member' as Role, monthly_cost: '', joined_date: istToday() })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true); setError(null)
    const { error } = await supabase.functions.invoke('invite-member', { body: f })
    setBusy(false)
    if (error) {
      let text = error.message
      try { text = (await (error as { context?: Response }).context?.json())?.error ?? text } catch { /* keep generic */ }
      setError(text)
    } else onDone()
  }

  return (
    <Modal title="Invite someone" onClose={onClose}>
      <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
        {error && <div className="sm:col-span-2"><FormError>{error}</FormError></div>}
        <label className="text-sm text-muted">Name<input className="field mt-1.5" required value={f.name} onChange={set('name')} /></label>
        <label className="text-sm text-muted">Email<input className="field mt-1.5" type="email" required value={f.email} onChange={set('email')} /></label>
        <label className="text-sm text-muted">Phone<input className="field mt-1.5" type="tel" value={f.phone} onChange={set('phone')} placeholder="+91" /></label>
        <label className="text-sm text-muted">Title<input className="field mt-1.5" value={f.title} onChange={set('title')} placeholder="e.g. Video editor" /></label>
        <label className="text-sm text-muted">Joined<input className="field mt-1.5 num" type="date" value={f.joined_date} onChange={set('joined_date')} /></label>
        <label className="text-sm text-muted">Monthly cost (₹, if salaried)<input className="field mt-1.5 num" type="number" min="0" step="1" inputMode="numeric" value={f.monthly_cost} onChange={set('monthly_cost')} /></label>
        <RolePicker value={f.role} onChange={role => setF({ ...f, role })} />
        <p className="sm:col-span-2 text-xs text-muted">They get an email to set a password. They can also sign in with Google using this same email.</p>
        <div className="sm:col-span-2 flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || isPreview || !f.name || !f.email}>{busy ? 'Sending…' : 'Send invite'}</button>
        </div>
      </form>
    </Modal>
  )
}

function EditMember({ row, onClose, onDone }: { row: TeamRow; onClose: () => void; onDone: () => void }) {
  const { isPreview } = useAuth()
  const [f, setF] = useState({ role: row.role, status: row.status, monthly_cost: row.monthly_cost?.toString() ?? '', joined_date: row.joined_date, title: row.title ?? '', phone: row.phone ?? '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true); setError(null)
    const { error } = await supabase.from('team_members').update({
      role: f.role, status: f.status, joined_date: f.joined_date, title: f.title || null, phone: f.phone || null,
      monthly_cost: f.monthly_cost === '' ? null : Number(f.monthly_cost),
    }).eq('id', row.id)
    setBusy(false)
    if (error) setError(error.message); else onDone()
  }
  async function resend() {
    if (!supabase) return
    setBusy(true); setError(null)
    const { error } = await supabase.functions.invoke('invite-member', { body: { name: row.name, email: row.email, role: row.role, resend: true } })
    setBusy(false)
    if (error) setError('Could not resend the invite.'); else onDone()
  }

  return (
    <Modal title={row.name} onClose={onClose}>
      <form onSubmit={save} className="grid sm:grid-cols-2 gap-4">
        {error && <div className="sm:col-span-2"><FormError>{error}</FormError></div>}
        <RolePicker value={f.role} onChange={role => setF({ ...f, role })} />
        <label className="text-sm text-muted">Status
          <select className="field mt-1.5" value={f.status} onChange={e => setF({ ...f, status: e.target.value as TeamRow['status'] })}>
            <option value="active">Active — can sign in</option><option value="inactive">Inactive — no access</option>
          </select>
        </label>
        <label className="text-sm text-muted">Joined<input className="field mt-1.5 num" type="date" value={f.joined_date} onChange={e => setF({ ...f, joined_date: e.target.value })} /></label>
        <label className="text-sm text-muted">Monthly cost (₹)<input className="field mt-1.5 num" type="number" min="0" value={f.monthly_cost} onChange={e => setF({ ...f, monthly_cost: e.target.value })} /></label>
        <label className="text-sm text-muted">Phone<input className="field mt-1.5" type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
        <label className="text-sm text-muted sm:col-span-2">Title<input className="field mt-1.5" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <div className="sm:col-span-2 flex flex-wrap gap-2 justify-end">
          {!row.first_signed_in_at && <button type="button" className="btn-ghost mr-auto" onClick={resend} disabled={busy || isPreview}>Resend invite</button>}
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || isPreview}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}
