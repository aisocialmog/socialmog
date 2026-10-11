/**
 * Domain rules that span records: write hooks, deal → campaign conversion, roster → payables,
 * content workflow, reliability, shortlisting, campaign health and the founder dashboard.
 */
import express, { type Express, type Request } from 'express';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { addDays, diffDays, financialYearStart, formatDate, weekStart } from '../shared/dates.ts';
import { dealEconomics, mean, median, pctChange, STAGE_PROBABILITY } from '../shared/calc.ts';
import { formatINR, splitProportional } from '../shared/money.ts';
import { can, CAMPAIGN_STAGES, CONTENT_STAGES, ENTITY } from '../shared/schema.ts';
import { all, audit, decode, get, HttpError, insert, run, tx, update, type Db, type Row, type User } from './db.ts';
import { attachLabels, founders, notify, requireCap, requireInternal, requireUser, scopeFor, serialize, type AppOptions } from './app.ts';
import { campaignFinancials, cashPosition, earnings, forecastInputs, listInvoices, listObligations, payeeStatement, today } from './finance.ts';
import { forecast, SCENARIOS } from './forecast.ts';
import { chatgptDashboard } from './chatgpt.ts';

// ---------------------------------------------------------------- write hooks

const settledOf = (db: Db, col: 'invoice_id' | 'obligation_id', id: number) =>
  get(db, `SELECT COALESCE(SUM(amount),0) s FROM settlements WHERE ${col} = ? AND reversed_at IS NULL`, id)!.s as number;

export function beforeWrite(db: Db, user: User, entity: string, v: Row, existing: Row | null): void {
  const merged = { ...(existing ?? {}), ...v };
  switch (entity) {
    case 'invoices': {
      if (v.status === 'cancelled' && existing?.status !== 'cancelled') throw new HttpError(400, 'Use the Cancel action so a reason is recorded');
      if (v.status === 'issued' && existing?.status !== 'issued' && !merged.number) throw new HttpError(400, 'Use the Issue action to assign an invoice number');
      if (existing?.status === 'cancelled') throw new HttpError(400, 'Cancelled receivables cannot be edited');
      merged.total = (merged.subtotal ?? 0) + (merged.tax ?? 0);
      v.total = merged.total;
      if (!merged.expected_date) v.expected_date = merged.due_date;
      if (merged.payer_type === 'brand' && !merged.brand_id) throw new HttpError(400, 'Choose the brand that pays this');
      if (merged.payer_type === 'influencer' && !merged.influencer_id) throw new HttpError(400, 'Choose the creator that pays this');
      if (merged.payer_type === 'other' && !merged.payer_name) throw new HttpError(400, 'Enter the payer name');
      if (existing && merged.total < settledOf(db, 'invoice_id', existing.id)) throw new HttpError(400, 'Amount cannot be less than what has already been received');
      break;
    }
    case 'obligations': {
      if (v.status === 'cancelled' && existing?.status !== 'cancelled') throw new HttpError(400, 'Use the Cancel action so a reason is recorded');
      if (existing?.status === 'cancelled') throw new HttpError(400, 'Cancelled payables cannot be edited');
      if (merged.payee_type === 'influencer' && !merged.influencer_id) throw new HttpError(400, 'Choose the creator');
      if (merged.payee_type === 'editor' && !merged.editor_id) throw new HttpError(400, 'Choose the editor');
      if (existing && merged.amount < settledOf(db, 'obligation_id', existing.id)) throw new HttpError(400, 'Amount cannot be less than what has already been paid');
      if (!existing && !(merged.amount > 0)) throw new HttpError(400, 'Amount must be greater than zero');
      break;
    }
    case 'accounts':
      if (existing && ('opening_balance' in v || 'opening_date' in v) && (v.opening_balance !== existing.opening_balance || v.opening_date !== existing.opening_date)) {
        if (get(db, 'SELECT id FROM transactions WHERE account_id = ?', existing.id)) {
          throw new HttpError(400, 'This account has transactions. Record a balance adjustment transaction instead of changing the opening balance.');
        }
      }
      break;
    case 'campaigns':
      if (v.stage && v.stage !== existing?.stage) {
        if (v.stage === 'financial_closure' && existing) {
          const f = campaignFinancials(db, today(db), [existing.id]).get(existing.id)!;
          if (!f.financially_closed) {
            throw new HttpError(400, `Not financially closed: ${formatINR(f.receivable_outstanding)} still to collect and ${formatINR(f.unpaid_cost)} still to pay. Settle, write off or cancel these first.`);
          }
          v.closed_at = today(db);
        }
        if (['live', 'reporting', 'financial_closure'].includes(v.stage) && !merged.live_at) v.live_at = today(db);
      }
      break;
    case 'deals':
      if (v.stage && v.stage !== existing?.stage) {
        if (v.stage === 'lost' && !merged.loss_reason) throw new HttpError(400, 'Record why the deal was lost');
        if (!('probability' in v) || v.probability === existing?.probability) v.probability = STAGE_PROBABILITY[v.stage];
      }
      break;
    case 'content_tasks': {
      if (user.role === 'editor') {
        const allowed = ['stage', 'checklist', 'final_url', 'blocked_reason'];
        const extra = Object.keys(v).filter((k) => !allowed.includes(k));
        if (extra.length) throw new HttpError(403, `Editors can only update ${allowed.join(', ')}`);
        if (!existing) throw new HttpError(403, 'Editors cannot create content tasks');
        if (v.stage && !['footage_pending', 'editing', 'internal_review'].includes(v.stage)) throw new HttpError(403, 'Only reviewers can approve or deliver');
      }
      if (v.stage && v.stage !== existing?.stage) {
        if (['editing', 'internal_review', 'brand_review', 'approved', 'delivered'].includes(v.stage)) {
          const deps: number[] = Array.isArray(merged.depends_on) ? merged.depends_on.map(Number) : [];
          const open = deps.length ? all(db, `SELECT id, title FROM content_tasks WHERE id IN (${deps.join(',')}) AND stage NOT IN ('approved','delivered')`) : [];
          if (open.length) throw new HttpError(400, `Blocked by: ${open.map((t) => `#${t.id} ${t.title}`).join(', ')}`);
        }
        if (v.stage === 'delivered') v.delivered_at = new Date().toISOString();
      }
      break;
    }
    case 'tasks':
      if (user.role === 'editor' && merged.owner_id !== user.id) throw new HttpError(403, 'Editors can only manage their own tasks');
      if (v.status === 'done' && existing?.status !== 'done') {
        const deps: number[] = Array.isArray(merged.depends_on) ? merged.depends_on.map(Number) : [];
        const open = deps.length ? all(db, `SELECT id, title FROM tasks WHERE id IN (${deps.join(',')}) AND status <> 'done'`) : [];
        if (open.length) throw new HttpError(400, `Finish these first: ${open.map((t) => `#${t.id} ${t.title}`).join(', ')}`);
        v.completed_at = new Date().toISOString();
      }
      break;
    case 'users':
      if (existing && existing.role === 'founder' && (v.role && v.role !== 'founder' || v.status === 'disabled')) {
        const others = get(db, `SELECT COUNT(*) n FROM users WHERE role = 'founder' AND status = 'active' AND archived_at IS NULL AND id <> ?`, existing.id)!.n;
        if (!others) throw new HttpError(400, 'Keep at least one active founder account');
      }
      break;
  }
}

export function afterWrite(db: Db, user: User, entity: string, row: Row, existing: Row | null): void {
  switch (entity) {
    case 'campaign_creators':
      syncCreatorPayable(db, user, row);
      break;
    case 'content_tasks':
      syncEditorPayable(db, user, row);
      if (row.stage !== existing?.stage && existing) contentStageChanged(db, user, row, existing.stage);
      break;
    case 'tasks':
      if (row.status === 'done' && existing?.status !== 'done' && row.recurrence && row.recurrence !== 'none' && !get(db, 'SELECT id FROM tasks WHERE recurrence_of = ?', row.id)) {
        const base = row.due_date ?? today(db);
        const due = row.recurrence === 'daily' ? addDays(base, 1) : row.recurrence === 'weekly' ? addDays(base, 7) : addDays(base, 30);
        const checklist = Array.isArray(row.checklist) ? row.checklist.map((c: Row) => ({ ...c, done: false })) : null;
        insert(db, 'tasks', { title: row.title, description: row.description, owner_id: row.owner_id, status: 'todo', priority: row.priority, due_date: due, recurrence: row.recurrence, related_type: row.related_type, related_id: row.related_id, checklist, recurrence_of: row.id, created_by: user.id });
      }
      if (row.owner_id && row.owner_id !== user.id && row.owner_id !== existing?.owner_id) {
        notify(db, [row.owner_id], { kind: 'task', title: `${user.name} assigned you: ${row.title}`, link: `/tasks/${row.id}` });
      }
      break;
  }
}

/** A confirmed creator on a gross campaign is a payable. Fee changes update it; dropping cancels it if unpaid. */
function syncCreatorPayable(db: Db, user: User, cc: Row) {
  const camp = get(db, 'SELECT * FROM campaigns WHERE id = ?', cc.campaign_id)!;
  const inf = get(db, 'SELECT name FROM influencers WHERE id = ?', cc.influencer_id)!;
  const source = `cc:${cc.id}`;
  const ob = get(db, `SELECT * FROM obligations WHERE source = ? AND status <> 'cancelled'`, source);
  const wanted = camp.billing_model === 'gross' && cc.status === 'confirmed' && (cc.fee ?? 0) > 0;
  const due = cc.payout_due ?? (camp.end_date ? addDays(camp.end_date, 15) : addDays(today(db), 30));
  if (wanted && !ob) {
    insert(db, 'obligations', {
      description: `Creator fee — ${camp.name}`, category: 'creator_payout', payee_type: 'influencer', influencer_id: cc.influencer_id,
      campaign_id: cc.campaign_id, amount: cc.fee, due_date: due, status: 'committed', priority: 'high', repeat: 'none', source, created_by: user.id,
      notes: cc.payment_terms ?? null,
    });
  } else if (wanted && ob) {
    const settled = settledOf(db, 'obligation_id', ob.id);
    if (cc.fee < settled) throw new HttpError(400, `${inf.name} has already been paid ${formatINR(settled)}; the fee cannot be lower`);
    if (ob.amount !== cc.fee || ob.due_date !== due) {
      update(db, 'obligations', ob.id, { amount: cc.fee, due_date: due });
      audit(db, user.id, 'sync', 'obligations', ob.id, ob, { amount: cc.fee, due_date: due }, 'Roster fee/payout date changed');
    }
  } else if (!wanted && ob) {
    if (settledOf(db, 'obligation_id', ob.id) > 0) throw new HttpError(400, `${inf.name} has payments recorded; reverse them before dropping`);
    run(db, `UPDATE obligations SET status = 'cancelled', cancel_reason = ? WHERE id = ?`, `Roster entry ${cc.status}`, ob.id);
    audit(db, user.id, 'cancel', 'obligations', ob.id, ob, null, `Roster entry for ${inf.name} is ${cc.status}`);
  }
}

function syncEditorPayable(db: Db, user: User, t: Row) {
  const source = `ct:${t.id}`;
  const ob = get(db, `SELECT * FROM obligations WHERE source = ? AND status <> 'cancelled'`, source);
  const fee = t.editor_fee ?? 0;
  if (!t.editor_id || fee <= 0) {
    if (ob && !settledOf(db, 'obligation_id', ob.id)) run(db, `UPDATE obligations SET status = 'cancelled', cancel_reason = 'Editor fee removed' WHERE id = ?`, ob.id);
    return;
  }
  const due = addDays(t.delivered_at ? t.delivered_at.slice(0, 10) : t.due_date ?? today(db), 7);
  const status = t.stage === 'delivered' || t.stage === 'approved' ? 'approved' : 'committed';
  if (!ob) {
    insert(db, 'obligations', { description: `Editing — ${t.title}`, category: 'editor_payout', payee_type: 'editor', editor_id: t.editor_id, campaign_id: t.campaign_id, content_task_id: t.id, amount: fee, due_date: due, status, priority: 'normal', repeat: 'none', source, created_by: user.id });
  } else if (ob.amount !== fee || ob.due_date !== due || ob.status !== status || ob.editor_id !== t.editor_id) {
    if (fee < settledOf(db, 'obligation_id', ob.id)) throw new HttpError(400, 'Editor has already been paid more than this fee');
    update(db, 'obligations', ob.id, { amount: fee, due_date: due, status, editor_id: t.editor_id });
  }
}

function contentStageChanged(db: Db, user: User, t: Row, from: string) {
  insert(db, 'comments', { entity_type: 'content_tasks', entity_id: t.id, kind: 'approval', body: `${label(from)} → ${label(t.stage)}`, meta: { from, to: t.stage }, user_id: user.id, created_by: user.id });
  const link = `/content/${t.id}`;
  const editorUsers = t.editor_id ? all(db, 'SELECT id FROM users WHERE editor_id = ? AND status = ?', t.editor_id, 'active').map((r) => r.id) : [];
  if (t.stage === 'internal_review' && t.reviewer_id) notify(db, [t.reviewer_id], { kind: 'review', title: `Ready for review: ${t.title}`, link });
  if (t.stage === 'changes_requested') notify(db, editorUsers, { kind: 'review', title: `Changes requested: ${t.title}`, link });
  if (t.stage === 'approved' || t.stage === 'delivered') notify(db, editorUsers, { kind: 'review', title: `${label(t.stage)}: ${t.title}`, link });
}

const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ---------------------------------------------------------------- deal → campaign

const DELIVERABLE_WORDS: [RegExp, string][] = [
  [/reels?/i, 'reel'], [/stor(y|ies)/i, 'story'], [/carousels?/i, 'carousel'], [/posts?/i, 'post'],
  [/shorts?/i, 'short'], [/(youtube|yt)\s*(videos?|integrations?)?/i, 'youtube_video'], [/lives?/i, 'live'], [/ugc/i, 'ugc'],
];

/** "2 reels, 3 stories" -> [{type:'reel',n:2},{type:'story',n:3}] */
export function parseDeliverables(text: string): { type: string; n: number; text: string }[] {
  const out: { type: string; n: number; text: string }[] = [];
  for (const part of String(text ?? '').split(/[,+;\n]|\band\b/i).map((p) => p.trim()).filter(Boolean)) {
    const n = Number(/(\d+)/.exec(part)?.[1] ?? 1);
    const type = DELIVERABLE_WORDS.find(([re]) => re.test(part))?.[1] ?? 'other';
    out.push({ type, n: Math.min(n, 20), text: part });
  }
  return out;
}

export function convertDeal(db: Db, user: User, dealId: number): number {
  return tx(db, () => {
    const d = decode('deals', get(db, 'SELECT * FROM deals WHERE id = ?', dealId))!;
    if (!d) throw new HttpError(404, 'Deal not found');
    if (d.campaign_id) throw new HttpError(400, 'This deal already has a campaign');
    if (d.stage === 'lost') throw new HttpError(400, 'Lost deals cannot be converted');
    const creators: Row[] = (d.creators ?? []).filter((c: Row) => c.influencer_id && c.status !== 'declined');
    const gross = d.billing_model !== 'commission';
    const econ = dealEconomics(d);
    const t = today(db);
    const plan = [
      { category: 'creator', description: 'Creator fees', planned: econ.creatorCost },
      { category: 'editing', description: 'Editing', planned: d.editor_costs ?? 0 },
      { category: 'production', description: 'Other costs', planned: d.other_costs ?? 0 },
    ].filter((l) => l.planned > 0);
    const campaignId = insert(db, 'campaigns', {
      name: d.title, brand_id: d.brand_id, deal_id: d.id, owner_id: d.owner_id ?? user.id, stage: 'planning', billing_model: d.billing_model,
      objective: null, brief: d.brief, start_date: t, end_date: d.deadline ?? null, client_budget: gross ? d.brand_price ?? 0 : d.agency_fee ?? 0,
      agency_fee: econ.agencyFee, budget_plan: plan, gross_deal_value: gross ? null : d.brand_price ?? null,
      notes: [d.usage_rights && `Usage rights: ${d.usage_rights}`, d.exclusivity && `Exclusivity: ${d.exclusivity}`, d.revisions_included != null && `Revisions included: ${d.revisions_included}`].filter(Boolean).join('\n') || null,
      created_by: user.id,
    });
    for (const c of creators) {
      const ccId = insert(db, 'campaign_creators', { campaign_id: campaignId, influencer_id: Number(c.influencer_id), status: 'confirmed', fee: gross ? Number(c.fee) || 0 : 0, payment_terms: d.payment_terms ?? null, created_by: user.id });
      syncCreatorPayable(db, user, get(db, 'SELECT * FROM campaign_creators WHERE id = ?', ccId)!);
      for (const item of parseDeliverables(c.deliverables ?? d.deliverables ?? '')) {
        for (let i = 1; i <= item.n; i++) {
          insert(db, 'deliverables', { campaign_id: campaignId, influencer_id: Number(c.influencer_id), title: item.n > 1 ? `${item.text} (${i}/${item.n})` : item.text, type: item.type, platform: item.type.startsWith('youtube') || item.type === 'short' ? 'youtube' : 'instagram', status: 'planned', due_date: d.deadline ?? null, revisions_allowed: d.revisions_included ?? 2, created_by: user.id });
        }
      }
    }
    // Incoming payment milestones become scheduled receivables.
    const milestones: Row[] = (d.payment_milestones?.length ? d.payment_milestones : [{ label: 'Full payment', pct: 100, due_days: 30 }]).filter((m: Row) => Number(m.pct) > 0);
    const billTotal = gross ? d.brand_price ?? 0 : d.agency_fee ?? 0;
    const amounts = splitProportional(billTotal, milestones.map((m) => Number(m.pct)));
    const brand = get(db, 'SELECT payment_terms_days FROM brands WHERE id = ?', d.brand_id);
    milestones.forEach((m, i) => {
      if (!amounts[i]) return;
      const due = addDays(t, Number(m.due_days ?? brand?.payment_terms_days ?? 30));
      const payers = !gross && d.commission_payer === 'creator' && creators.length ? creators : [null];
      const split = splitProportional(amounts[i], payers.map((c) => (c ? Number(c.fee) || 1 : 1)));
      payers.forEach((c, j) => {
        insert(db, 'invoices', {
          label: `${m.label ?? `Milestone ${i + 1}`}${c ? ` — commission` : ''}`, kind: gross ? 'brand_billing' : 'commission', status: 'scheduled',
          payer_type: c ? 'influencer' : 'brand', brand_id: c ? null : d.brand_id, influencer_id: c ? Number(c.influencer_id) : null,
          campaign_id: campaignId, deal_id: d.id, due_date: due, expected_date: due, confidence: 'expected', subtotal: split[j], tax: 0, total: split[j], created_by: user.id,
        });
      });
    });
    update(db, 'deals', d.id, { campaign_id: campaignId, stage: 'won', probability: 100 });
    insert(db, 'tasks', { title: `Kick off campaign: ${d.title}`, owner_id: d.owner_id ?? user.id, status: 'todo', priority: 'high', due_date: addDays(t, 2), related_type: 'campaigns', related_id: campaignId, recurrence: 'none', checklist: [{ text: 'Confirm brief and deliverables with brand', done: false }, { text: 'Share brief with creators', done: false }, { text: 'Issue advance invoice', done: false }, { text: 'Assign editors', done: false }], created_by: user.id });
    audit(db, user.id, 'convert', 'deals', d.id, null, { campaign_id: campaignId });
    return campaignId;
  });
}

// ---------------------------------------------------------------- reliability & shortlisting

export function reliability(db: Db, influencerId?: number): Map<number, Row> {
  const where = influencerId ? `AND d.influencer_id = ${Number(influencerId)}` : '';
  const delivered = all(db, `SELECT d.influencer_id, d.due_date, d.publish_date FROM deliverables d WHERE d.archived_at IS NULL AND d.status = 'live' AND d.due_date IS NOT NULL AND d.publish_date IS NOT NULL ${where}`);
  const tasks = all(db, `SELECT t.id, t.influencer_id FROM content_tasks t WHERE t.archived_at IS NULL AND t.influencer_id IS NOT NULL ${influencerId ? `AND t.influencer_id = ${Number(influencerId)}` : ''}`);
  const history = tasks.length
    ? all(db, `SELECT entity_id, created_at, meta FROM comments WHERE entity_type = 'content_tasks' AND kind = 'approval' AND entity_id IN (${tasks.map((t) => t.id).join(',')}) ORDER BY created_at`)
    : [];
  const out = new Map<number, Row>();
  const ids = new Set([...delivered.map((d) => d.influencer_id), ...tasks.map((t) => t.influencer_id)]);
  for (const id of ids) {
    const mine = delivered.filter((d) => d.influencer_id === id);
    const onTime = mine.filter((d) => d.publish_date <= d.due_date).length;
    const myTasks = tasks.filter((t) => t.influencer_id === id);
    const revisions = myTasks.map((t) => history.filter((h) => h.entity_id === t.id && JSON.parse(h.meta ?? '{}').to === 'changes_requested').length);
    const turnarounds: number[] = [];
    for (const t of myTasks) {
      const h = history.filter((x) => x.entity_id === t.id).map((x) => ({ at: x.created_at, ...JSON.parse(x.meta ?? '{}') }));
      const submitted = h.find((x) => x.to === 'brand_review' || x.to === 'internal_review');
      const approved = h.find((x) => x.to === 'approved');
      if (submitted && approved && approved.at > submitted.at) turnarounds.push((Date.parse(approved.at) - Date.parse(submitted.at)) / 86_400_000);
    }
    out.set(id, {
      deliverables_measured: mine.length,
      on_time_rate: mine.length ? Math.round((onTime / mine.length) * 100) : null,
      avg_revisions: myTasks.length ? Math.round((mean(revisions) ?? 0) * 10) / 10 : null,
      approval_turnaround_days: turnarounds.length ? Math.round((mean(turnarounds) ?? 0) * 10) / 10 : null,
      tasks_measured: myTasks.length,
    });
  }
  return out;
}

export interface ShortlistQuery {
  niches?: string[];
  city?: string;
  language?: string;
  platform?: string;
  deliverable?: string;
  max_fee?: number; // paise per creator
  min_followers?: number;
  brand_id?: number;
  include_unavailable?: boolean;
}

export function shortlist(db: Db, q: ShortlistQuery, canSeeRates: boolean) {
  const brand = q.brand_id ? decode('brands', get(db, 'SELECT * FROM brands WHERE id = ?', q.brand_id)) : null;
  const rel = reliability(db);
  const past = new Map(all(db, `SELECT influencer_id, COUNT(*) n FROM campaign_creators WHERE status = 'confirmed' GROUP BY influencer_id`).map((r) => [r.influencer_id, r.n]));
  const results: Row[] = [];
  for (const raw of all(db, `SELECT * FROM influencers WHERE archived_at IS NULL AND relationship NOT IN ('inactive','agency_owned')`)) {
    const inf = decode('influencers', raw)!;
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = 0;
    const niches: string[] = (inf.niches ?? []).map((n: string) => n.toLowerCase());
    if (q.niches?.length) {
      const hit = q.niches.filter((n) => niches.includes(n.toLowerCase()));
      if (!hit.length) continue;
      score += 3 * hit.length;
      reasons.push(`Niche match: ${hit.join(', ')}`);
    }
    if (q.city) {
      if ((inf.city ?? '').toLowerCase() === q.city.toLowerCase()) {
        score += 1;
        reasons.push(`Based in ${inf.city}`);
      } else if (inf.audience?.top_cities?.some?.((c: string) => c.toLowerCase().includes(q.city!.toLowerCase()))) {
        score += 1;
        reasons.push(`Audience includes ${q.city} (${inf.audience.source ?? 'source unknown'})`);
      }
    }
    if (q.language && (inf.languages ?? []).some((l: string) => l.toLowerCase() === q.language!.toLowerCase())) {
      score += 1;
      reasons.push(`Creates in ${q.language}`);
    }
    const platforms: Row[] = inf.platforms ?? [];
    const plat = platforms.find((p) => !q.platform || p.platform === q.platform);
    if (q.platform && !plat) continue;
    if (q.min_followers) {
      if (plat?.followers == null) warnings.push('Follower count unavailable');
      else if (plat.followers < q.min_followers) continue;
      else reasons.push(`${plat.followers.toLocaleString('en-IN')} followers on ${plat.platform} (as of ${plat.updated_at ? formatDate(plat.updated_at) : 'unknown date'}, ${plat.source ?? 'source unknown'})`);
    }
    if (q.max_fee) {
      const card: Row[] = inf.rate_card ?? [];
      const rate = card.find((r) => !q.deliverable || r.deliverable === q.deliverable);
      const price = rate ? rate.negotiated_rate ?? rate.rate : null;
      if (price == null) warnings.push('No rate on file for this deliverable');
      else if (price > q.max_fee) continue;
      else {
        score += 2;
        reasons.push(canSeeRates ? `Rate ${formatINR(price)} fits budget of ${formatINR(q.max_fee)}` : 'Rate fits budget');
      }
    }
    if (inf.availability === 'unavailable' && !q.include_unavailable) continue;
    if (inf.availability === 'available') {
      score += 1;
      reasons.push('Available');
    } else warnings.push(`Availability: ${inf.availability}${inf.availability_notes ? ` (${inf.availability_notes})` : ''}`);
    const r = rel.get(inf.id);
    if (r?.on_time_rate != null) {
      if (r.on_time_rate >= 80) score += 1;
      reasons.push(`On time ${r.on_time_rate}% across ${r.deliverables_measured} deliverables`);
    }
    if (past.get(inf.id)) {
      score += Math.min(2, past.get(inf.id) * 0.5);
      reasons.push(`${past.get(inf.id)} past campaign(s) with us`);
    }
    if (brand) {
      const cats: string[] = (brand.categories ?? []).map((c: string) => c.toLowerCase());
      const unsuitable = (inf.unsuitable_categories ?? []).filter((c: string) => cats.includes(c.toLowerCase()));
      if (unsuitable.length) warnings.push(`Unsuitable category: ${unsuitable.join(', ')}`);
      const text = `${inf.conflicts ?? ''} ${inf.exclusivity_restrictions ?? ''}`.toLowerCase();
      const clash = cats.filter((c) => c && text.includes(c));
      if (clash.length) warnings.push(`Possible conflict/exclusivity: ${clash.join(', ')}`);
    }
    results.push({ id: inf.id, name: inf.name, handle: inf.handle, city: inf.city, niches: inf.niches, relationship: inf.relationship, availability: inf.availability, platforms, score: Math.round(score * 10) / 10, reasons, warnings, reliability: r ?? null });
  }
  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- roster & media kit figures

const KIT_POSTS = 10;
const LINK: Record<string, (h: string) => string> = { instagram: (h) => `https://www.instagram.com/${encodeURIComponent(h)}/`, youtube: (h) => `https://www.youtube.com/@${encodeURIComponent(h)}` };
/** Only web links reach the roster and brand PDFs (no javascript:, file: …). */
const webUrl = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const counted = (x: Row) => ['likes', 'comments', 'shares', 'saves'].every((k) => typeof x.metrics[k] === 'number');

/**
 * Per-creator figures for the roster and brand media kits: channel links, followers, previous average views
 * (last organic posts, else the profile figure with its source), engagement, brand-facing commercials, past
 * collaborations and top content. Every figure carries its basis; nothing is estimated.
 * Commercials use the rate card's brand price (falling back to the rate card); negotiated rates and commissions never appear.
 */
export function creatorStats(db: Db, ids: number[] | null, opts: { commercials: boolean }): Map<number, Row> {
  const infs = all(db, `SELECT * FROM influencers WHERE archived_at IS NULL ${ids ? `AND id IN (${ids.map(Number).join(',') || 'NULL'})` : ''}`).map((r) => decode('influencers', r)!);
  const idList = infs.map((i) => i.id).join(',') || 'NULL';
  const posts = all(db, `SELECT influencer_id, platform, permalink, published_at, format, topic, promotion, metrics FROM posts WHERE archived_at IS NULL AND published_at IS NOT NULL AND influencer_id IN (${idList}) ORDER BY published_at DESC`)
    .map((p) => ({ ...p, metrics: JSON.parse(p.metrics ?? '{}') }))
    .filter((p) => typeof p.metrics.views === 'number');
  const snaps = all(db, `SELECT influencer_id, platform, period_end, metrics, source FROM analytics_snapshots WHERE archived_at IS NULL AND influencer_id IN (${idList}) ORDER BY period_start DESC`)
    .map((x) => ({ ...x, followers: JSON.parse(x.metrics ?? '{}').followers_end ?? null }));
  const collabs = all(db, `SELECT DISTINCT cc.influencer_id, b.name FROM campaign_creators cc JOIN campaigns c ON c.id = cc.campaign_id JOIN brands b ON b.id = c.brand_id
    WHERE cc.status = 'confirmed' AND cc.archived_at IS NULL AND c.archived_at IS NULL AND c.stage IN ('live','reporting','financial_closure') AND cc.influencer_id IN (${idList}) ORDER BY b.name`);
  const out = new Map<number, Row>();
  for (const i of infs) {
    const platforms = ((i.platforms ?? []) as Row[]).map((p) => {
      const handle = p.handle ? String(p.handle).replace(/^@/, '') : null;
      // Boosted posts are left out; posts with unknown promotion are included (and the basis says so).
      const mine = posts.filter((x) => x.influencer_id === i.id && x.platform === p.platform && x.promotion !== 'paid').slice(0, KIT_POSTS);
      const enough = mine.length >= 3;
      const views = mine.map((x) => x.metrics.views as number);
      // Engagement only from posts with every interaction recorded, so missing data never reads as 0%.
      const reached = mine.filter((x) => x.metrics.reach > 0 && counted(x));
      const interactions = (x: Row) => ['likes', 'comments', 'shares', 'saves'].reduce((a, k) => a + x.metrics[k], 0);
      const snap = snaps.find((x) => x.influencer_id === i.id && x.platform === p.platform && x.followers != null);
      const fromSnap = !!snap && (p.followers == null || !p.updated_at || snap.period_end >= String(p.updated_at).slice(0, 10));
      const profileBasis = `${p.source ?? 'Profile entry'}${p.updated_at ? `, as of ${formatDate(p.updated_at)}` : ''}`;
      return {
        platform: p.platform, handle, url: webUrl(p.url) ?? (handle && LINK[p.platform] ? LINK[p.platform](handle) : null),
        followers: fromSnap ? snap!.followers : p.followers ?? null,
        followers_basis: fromSnap ? `Weekly snapshot, week ending ${formatDate(snap!.period_end)}` : p.followers != null ? profileBasis : null,
        avg_views: enough ? Math.round(mean(views)!) : p.avg_views ?? null,
        median_views: enough ? Math.round(median(views)!) : p.median_views ?? null,
        views_basis: enough ? `Last ${mine.length} posts (boosted posts excluded), ${formatDate(mine[mine.length - 1].published_at)} – ${formatDate(mine[0].published_at)}` : p.avg_views != null ? profileBasis : null,
        engagement_rate: reached.length >= 3 ? Math.round((reached.reduce((a, x) => a + interactions(x), 0) / reached.reduce((a, x) => a + x.metrics.reach, 0)) * 10_000) / 100 : p.engagement_rate ?? null,
        engagement_basis: reached.length >= 3 ? `(likes + comments + shares + saves) ÷ reach, last ${reached.length} posts (boosted excluded)` : p.engagement_rate != null ? profileBasis : null,
      };
    });
    const commercials = opts.commercials
      ? ((i.rate_card ?? []) as Row[]).map((r) => ({ deliverable: r.deliverable ?? null, platform: r.platform ?? null, price: r.brand_rate ?? r.rate ?? null })).filter((r) => typeof r.price === 'number')
      : null;
    out.set(i.id, {
      id: i.id, name: i.name, handle: i.handle, photo: !!i.photo_file, photo_url: i.photo_url ?? null, updated_at: i.updated_at ?? i.created_at,
      niches: i.niches ?? [], city: i.city, state: i.state, languages: i.languages ?? [], availability: i.availability, relationship: i.relationship,
      audience: i.audience ?? null, platforms,
      commercials, starting_price: commercials?.length ? Math.min(...commercials.map((c) => c.price)) : null,
      collaborations: collabs.filter((c) => c.influencer_id === i.id).map((c) => c.name),
      top_content: posts.filter((x) => x.influencer_id === i.id && x.promotion !== 'paid' && webUrl(x.permalink)).sort((a, b) => b.metrics.views - a.metrics.views).slice(0, 3)
        .map((x) => ({ url: x.permalink, platform: x.platform, format: x.format, topic: x.topic, views: x.metrics.views, published_at: x.published_at })),
    });
  }
  return out;
}

/** Uploaded creator photo (PNG/JPEG only, so PDFs can embed it). */
export function photoPath(dataDir: string, inf: Row): string | null {
  if (!inf?.photo_file) return null;
  const p = join(dataDir, 'uploads', 'photos', inf.photo_file);
  return existsSync(p) ? p : null;
}

export const PHOTO_MAX = 512 * 1024;

/** Drops JPEG metadata (EXIF incl. GPS and device, XMP, IPTC, comments); keeps JFIF, ICC and Adobe colour segments. Throws if malformed. */
export function stripJpegMetadata(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  let frame = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('Malformed JPEG');
    const m = b[i + 1];
    if (m === 0xff) {
      i++; // fill byte
      continue;
    }
    if (m === 0xda) {
      if (!frame) throw new Error('Malformed JPEG');
      out.push(b.subarray(i)); // start of scan: the rest is image data
      return Buffer.concat(out);
    }
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new Error('Truncated JPEG');
    if ((m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)) frame = true;
    const metadata = m === 0xe1 || (m >= 0xe3 && m <= 0xed) || m === 0xef || m === 0xfe;
    if (!metadata) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  throw new Error('Truncated JPEG');
}

const PDFKit = createRequire(import.meta.url)('@foliojs-fork/pdfkit');
/** Cleans and checks a photo so a damaged or crafted file can never break PDF generation. Returns the bytes to store/embed. */
export function safePhoto(body: Buffer): { bytes: Buffer; ext: 'png' | 'jpg' } {
  const png = body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (!png && !jpg) throw new HttpError(400, 'Upload a PNG or JPEG image');
  try {
    const bytes = jpg ? stripJpegMetadata(body) : body;
    const img = new PDFKit().openImage(bytes);
    if (png) inflateSync(img.image.imgData); // pdfkit inflates PNG data asynchronously later; fail here instead
    return { bytes, ext: png ? 'png' : 'jpg' };
  } catch {
    throw new HttpError(400, 'That image file is damaged or incomplete');
  }
}

// ---------------------------------------------------------------- campaign health

export function campaignHealth(db: Db, t: string, withFinance: boolean): Row[] {
  const campaigns = all(db, `SELECT c.*, b.name AS brand_name FROM campaigns c LEFT JOIN brands b ON b.id = c.brand_id WHERE c.archived_at IS NULL AND c.stage <> 'financial_closure'`);
  if (!campaigns.length) return [];
  const fin = withFinance ? campaignFinancials(db, t) : new Map();
  const deliverables = all(db, `SELECT * FROM deliverables WHERE archived_at IS NULL AND campaign_id IN (${campaigns.map((c) => c.id).join(',')})`);
  const tasks = all(db, `SELECT * FROM content_tasks WHERE archived_at IS NULL AND campaign_id IN (${campaigns.map((c) => c.id).join(',')})`);
  return campaigns.map((c) => {
    const d = deliverables.filter((x) => x.campaign_id === c.id);
    const overdue = d.filter((x) => x.due_date && x.due_date < t && !['live', 'cancelled'].includes(x.status));
    const pendingApprovals = tasks.filter((x) => x.campaign_id === c.id && ['internal_review', 'brand_review'].includes(x.stage));
    const live = d.filter((x) => x.status === 'live').length;
    const f = fin.get(c.id);
    const flags: { level: 'red' | 'amber'; text: string }[] = [];
    if (overdue.length) flags.push({ level: 'red', text: `${overdue.length} deliverable(s) overdue` });
    if (pendingApprovals.length) flags.push({ level: 'amber', text: `${pendingApprovals.length} awaiting approval` });
    if (c.end_date && c.end_date < t && !['live', 'reporting'].includes(c.stage)) flags.push({ level: 'red', text: `End date ${formatDate(c.end_date)} passed in ${label(c.stage)}` });
    if (f?.over_budget) flags.push({ level: 'red', text: `Costs ${formatINR(f.committed_cost)} exceed client budget ${formatINR(f.client_budget)}` });
    if (f && f.margin_bps !== null && f.margin_bps < 1000) flags.push({ level: 'amber', text: `Margin ${(f.margin_bps / 100).toFixed(1)}%` });
    if (f?.payment_exposure) flags.push({ level: 'amber', text: `${formatINR(f.payment_exposure)} of payouts not yet covered by this campaign's collections` });
    if (f && ['live', 'reporting'].includes(c.stage) && (f.receivable_outstanding || f.unpaid_cost)) flags.push({ level: 'amber', text: 'Live but not financially closed' });
    const targets = decode('campaigns', c)!.kpi_targets;
    return {
      id: c.id, name: c.name, brand_name: c.brand_name, stage: c.stage, end_date: c.end_date,
      deliverables: d.length, live, overdue: overdue.length, pending_approvals: pendingApprovals.length,
      targets, finance: f ?? null, flags,
      health: flags.some((x) => x.level === 'red') ? 'red' : flags.length ? 'amber' : 'green',
    };
  });
}

// ---------------------------------------------------------------- editor workload

export function editorWorkload(db: Db, t: string): Row[] {
  const editors = all(db, `SELECT * FROM editors WHERE archived_at IS NULL ORDER BY name`);
  const tasks = all(db, `SELECT * FROM content_tasks WHERE archived_at IS NULL AND editor_id IS NOT NULL`);
  const hist = all(db, `SELECT entity_id, meta FROM comments WHERE entity_type = 'content_tasks' AND kind = 'approval'`);
  const weekEnd = addDays(weekStart(t), 6);
  return editors.map((e) => {
    const mine = tasks.filter((x) => x.editor_id === e.id);
    const open = mine.filter((x) => !['approved', 'delivered'].includes(x.stage));
    const done = mine.filter((x) => x.delivered_at);
    const turnaround = median(done.map((x) => (Date.parse(x.delivered_at) - Date.parse(x.created_at)) / 86_400_000));
    const revisions = mine.map((x) => hist.filter((h) => h.entity_id === x.id && JSON.parse(h.meta ?? '{}').to === 'changes_requested').length);
    return {
      id: e.id, name: e.name, availability: e.availability, capacity: e.capacity_per_week ?? null,
      open: open.length,
      due_this_week: open.filter((x) => x.due_date && x.due_date <= weekEnd).length,
      overdue: open.filter((x) => x.due_date && x.due_date < t).length,
      blocked: open.filter((x) => x.blocked_reason).length,
      blocked_tasks: open.filter((x) => x.blocked_reason).map((x) => ({ id: x.id, title: x.title, reason: x.blocked_reason })),
      delivered: done.length,
      median_turnaround_days: turnaround === null ? null : Math.round(turnaround * 10) / 10,
      avg_revisions: mine.length ? Math.round((mean(revisions) ?? 0) * 10) / 10 : null,
      utilisation: e.capacity_per_week ? Math.round((open.filter((x) => x.due_date && x.due_date <= weekEnd).length / e.capacity_per_week) * 100) : null,
    };
  });
}

// ---------------------------------------------------------------- influencer trend (from weekly snapshots)

export function influencerTrends(db: Db): Row[] {
  const rows = all(db, `SELECT s.*, i.name FROM analytics_snapshots s JOIN influencers i ON i.id = s.influencer_id WHERE i.archived_at IS NULL AND s.archived_at IS NULL ORDER BY s.period_start DESC`);
  const byInf = new Map<number, Row[]>();
  for (const r of rows) {
    const key = r.influencer_id;
    if (!byInf.has(key)) byInf.set(key, []);
    byInf.get(key)!.push({ ...r, metrics: JSON.parse(r.metrics ?? '{}') });
  }
  const out: Row[] = [];
  for (const [id, snaps] of byInf) {
    const primary = snaps.filter((s) => s.platform === snaps[0].platform);
    const [cur, ...prev] = primary;
    const base = prev.slice(0, 4);
    const views = pctChange(cur.metrics.views ?? null, mean(base.map((s) => s.metrics.views)));
    const growth = cur.metrics.followers_end != null && cur.metrics.followers_start ? ((cur.metrics.followers_end - cur.metrics.followers_start) / cur.metrics.followers_start) * 100 : null;
    const eng = pctChange(cur.metrics.engagement_rate ?? null, mean(base.map((s) => s.metrics.engagement_rate)));
    const signal = views ?? eng;
    out.push({
      influencer_id: id, name: cur.name, platform: cur.platform, period_start: cur.period_start, source: cur.source, updated_at: cur.updated_at ?? cur.created_at,
      views_vs_baseline: views, engagement_vs_baseline: eng, follower_growth_pct: growth, baseline_weeks: base.length,
      direction: signal === null ? 'unknown' : signal >= 10 ? 'improving' : signal <= -10 ? 'declining' : 'steady',
    });
  }
  return out;
}

// ---------------------------------------------------------------- dashboard

export function dashboard(db: Db, user: User) {
  const t = today(db);
  const fin = can(user.role, 'finance');
  const campFin = can(user.role, 'campaign_finance');
  const attention: Row[] = [];
  const add = (severity: 'high' | 'medium' | 'low', kind: string, title: string, detail: string, link: string, amount?: number) => attention.push({ severity, kind, title, detail, link, amount });

  let finance: Row | null = null;
  if (fin) {
    const position = cashPosition(db, t, { horizonDays: 30, reserves: 'protected' });
    const inputs = forecastInputs(db, t, 90);
    const base = forecast({ today: t, horizonDays: 90, ...inputs, scenario: SCENARIOS.base });
    const conservative = forecast({ today: t, horizonDays: 90, ...inputs, scenario: SCENARIOS.conservative });
    const fy = earnings(db, financialYearStart(t), t, t);
    finance = {
      cash: position.cash,
      accounts: position.accounts,
      receivables: { total: position.receivables.total, overdue: position.receivables.overdue, byConfidence: position.receivables.byConfidence },
      payables: { total: position.payables.total, overdue: position.payables.overdue, due7: position.payables.due7, due14: position.payables.due14, due30: position.payables.due30, byCategory: position.payables.byCategory },
      earmarks: position.earmarks,
      unallocated: position.unallocated,
      afterCommitments: position.afterCommitments,
      selection: position.selection,
      forecast: {
        base: { earliestShortfall: base.earliestShortfall, fundingRequired: base.fundingRequired, minBalance: base.minBalance, minBalanceDate: base.minBalanceDate, recoveryDate: base.recoveryDate, daily: base.daily.filter((_, i) => i % 3 === 0) },
        conservative: { earliestShortfall: conservative.earliestShortfall, fundingRequired: conservative.fundingRequired, minBalance: conservative.minBalance, minBalanceDate: conservative.minBalanceDate },
      },
      earnings: {
        from: fy.from, to: fy.to, basis: fy.basis.basis, agency_earnings: fy.agency_earnings, cash_collected: fy.cash_collected,
        contribution_margin: fy.contribution_margin, opex: fy.opex, gross_billings: fy.gross_billings, operating_result: fy.operating_result, capex: fy.capex,
      },
    };
    for (const o of position.payables.items.filter((x) => x.days_overdue > 0 && x.status !== 'on_hold')) add('high', 'payable_overdue', `Overdue: ${o.description}`, `${o.payee ?? ''} · ${formatINR(o.outstanding)} · due ${formatDate(o.due_date)}`, `/finance/payables/${o.id}`, o.outstanding);
    for (const o of position.payables.items.filter((x) => x.days_overdue === 0 && x.status !== 'on_hold' && x.due_date <= addDays(t, 7) && x.unfunded > 0)) add('medium', 'payable_due', `Due ${formatDate(o.due_date)}: ${o.description}`, `${o.payee ?? ''} · ${formatINR(o.unfunded)} not earmarked`, `/finance/payables/${o.id}`, o.outstanding);
    if (base.earliestShortfall) add('high', 'shortfall', `Projected cash shortfall on ${formatDate(base.earliestShortfall.date)}`, `${base.earliestShortfall.label} · funding required ${formatINR(base.fundingRequired)} (base scenario)`, '/finance/forecast', base.fundingRequired);
    else if (conservative.earliestShortfall) add('medium', 'shortfall', `Conservative scenario: shortfall on ${formatDate(conservative.earliestShortfall.date)}`, `Funding required ${formatINR(conservative.fundingRequired)} if collections slip`, '/finance/forecast?scenario=conservative', conservative.fundingRequired);
    for (const r of position.receivables.items.filter((x) => x.days_overdue > 0)) add(r.days_overdue > 30 ? 'high' : 'medium', 'receivable_overdue', `${r.payer ?? 'Payer'} owes ${formatINR(r.outstanding)}`, `${r.label}${r.number ? ` (${r.number})` : ''} · ${r.days_overdue} days overdue`, `/finance/receivables/${r.id}`, r.outstanding);
    for (const r of position.receivables.items.filter((x) => x.confidence === 'at_risk' && x.days_overdue === 0)) add('medium', 'receivable_risk', `At risk: ${r.label}`, `${r.payer ?? ''} · ${formatINR(r.outstanding)} expected ${formatDate(r.expected_date)}`, `/finance/receivables/${r.id}`, r.outstanding);
    const unclassified = get(db, `SELECT COUNT(*) n FROM transactions WHERE category IN ('uncategorised_in','uncategorised_out') AND reversed_by_id IS NULL`)!.n;
    if (unclassified) add('medium', 'uncategorised', `${unclassified} imported transaction(s) to categorise`, 'Uncategorised money is left out of earnings reports', '/finance/transactions?category=uncategorised');
    // TDS brands withheld from us: remind to check 26AS/AIS once the brand's quarterly TDS return should be filed.
    for (const c of all(db, `SELECT * FROM tds_credits WHERE owner <> 'creator' AND status IN ('expected','not_received')`)) {
      if (c.status === 'not_received') add('high', 'tds', `TDS missing from 26AS: ${c.payer_name}`, `${formatINR(c.amount)} · ${c.quarter} FY ${c.fy} — ask the brand to file or correct its TDS return`, '/finance/tds', c.amount);
      else if (addDays(c.return_due, 15) < t) add('medium', 'tds', `Check 26AS/AIS for TDS from ${c.payer_name}`, `${formatINR(c.amount)} · ${c.quarter} FY ${c.fy} · their TDS return was due ${formatDate(c.return_due)}`, '/finance/tds', c.amount);
    }
    if (position.unallocated < 0) add('high', 'over_allocated', 'Earmarks exceed cash', `Earmarked ${formatINR(position.earmarks.total)} vs cash ${formatINR(position.cash)}`, '/finance/allocations');
  }

  const health = campaignHealth(db, t, campFin);
  const deals = all(db, `SELECT d.*, b.name AS brand_name FROM deals d LEFT JOIN brands b ON b.id = d.brand_id WHERE d.archived_at IS NULL AND d.stage NOT IN ('won','lost')`).map((r) => decode('deals', r)!);
  const followUps = deals
    .filter((d) => !d.next_action_date || d.next_action_date <= t)
    .map((d) => ({ id: d.id, title: d.title, brand_name: d.brand_name, stage: d.stage, next_action: d.next_action, next_action_date: d.next_action_date, expected_fee: can(user.role, 'rates') ? dealEconomics(d).agencyFee : null, probability: d.probability }));
  for (const d of followUps.filter((x) => x.next_action_date)) add('medium', 'deal_follow_up', `Follow up: ${d.title}`, `${d.brand_name ?? ''} · ${d.next_action ?? 'No next action'} (${formatDate(d.next_action_date)})${d.expected_fee ? ` · fee ${formatINR(d.expected_fee)}` : ''}`, `/deals/${d.id}`);
  for (const d of followUps.filter((x) => !x.next_action_date)) add('low', 'deal_no_action', `No next action: ${d.title}`, d.brand_name ?? '', `/deals/${d.id}`);
  for (const b of all(db, `SELECT id, name, follow_up_date FROM brands WHERE archived_at IS NULL AND follow_up_date IS NOT NULL AND follow_up_date <= ?`, t)) add('medium', 'brand_follow_up', `Follow up with ${b.name}`, `Due ${formatDate(b.follow_up_date)}`, `/brands/${b.id}`);

  const overdueDeliverables = all(db, `SELECT d.*, c.name AS campaign_name, i.name AS influencer_name FROM deliverables d JOIN campaigns c ON c.id = d.campaign_id LEFT JOIN influencers i ON i.id = d.influencer_id WHERE d.archived_at IS NULL AND d.due_date < ? AND d.status NOT IN ('live','cancelled')`, t);
  for (const d of overdueDeliverables) add('high', 'deliverable_overdue', `Overdue deliverable: ${d.title}`, `${d.influencer_name ?? ''} · ${d.campaign_name} · due ${formatDate(d.due_date)}`, `/campaigns/${d.campaign_id}`);
  const pending = all(db, `SELECT t.id, t.title, t.stage, t.due_date, c.name AS campaign_name FROM content_tasks t LEFT JOIN campaigns c ON c.id = t.campaign_id WHERE t.archived_at IS NULL AND t.stage IN ('internal_review','brand_review')`);
  for (const p of pending.filter((x) => x.stage === 'internal_review')) add('medium', 'approval', `Review: ${p.title}`, `${p.campaign_name ?? ''} · waiting for internal review`, `/content/${p.id}`);
  for (const c of health.filter((x) => x.finance?.over_budget)) add('high', 'over_budget', `Over budget: ${c.name}`, c.flags.find((f: Row) => f.text.startsWith('Costs'))?.text ?? '', `/campaigns/${c.id}`);

  for (const i of all(db, `SELECT id, name, agreement_end, renewal_reminder_days FROM influencers WHERE archived_at IS NULL AND agreement_end IS NOT NULL AND relationship IN ('exclusive','non_exclusive')`)) {
    if (i.agreement_end <= addDays(t, i.renewal_reminder_days ?? 30)) add(i.agreement_end < t ? 'high' : 'medium', 'renewal', `Agreement ${i.agreement_end < t ? 'expired' : 'expiring'}: ${i.name}`, `Ends ${formatDate(i.agreement_end)}`, `/influencers/${i.id}`);
  }
  for (const d of all(db, `SELECT id, title, expiry_date, reminder_days FROM documents WHERE archived_at IS NULL AND expiry_date IS NOT NULL`)) {
    if (d.expiry_date <= addDays(t, d.reminder_days ?? 30)) add('medium', 'document_expiry', `Document ${d.expiry_date < t ? 'expired' : 'expiring'}: ${d.title}`, `Expiry ${formatDate(d.expiry_date)}`, `/documents/${d.id}`);
  }
  for (const a of all(db, `SELECT id, name, warranty_until, next_maintenance, renewal_date FROM assets WHERE archived_at IS NULL AND status = 'active'`)) {
    for (const [k, l] of [['renewal_date', 'Renewal'], ['next_maintenance', 'Maintenance'], ['warranty_until', 'Warranty ends']] as const) {
      if (a[k] && a[k] >= t && a[k] <= addDays(t, 30)) add('low', 'asset', `${l}: ${a.name}`, formatDate(a[k]), `/assets/${a.id}`);
    }
  }
  for (const tk of all(db, `SELECT id, title, due_date FROM tasks WHERE archived_at IS NULL AND status <> 'done' AND owner_id = ? AND due_date <= ?`, user.id, t)) add(tk.due_date < t ? 'high' : 'medium', 'task', `Your task: ${tk.title}`, `Due ${formatDate(tk.due_date)}`, `/tasks/${tk.id}`);
  for (const j of all(db, `SELECT * FROM jobs WHERE status = 'failed' AND finished_at >= ?`, addDays(t, -7))) add('high', 'job_failed', `Automation failed: ${j.kind.replace(/_/g, ' ')}`, j.last_error ?? '', '/settings/automation');
  for (const s of all(db, `SELECT a.id, a.username, a.status, i.name FROM social_accounts a LEFT JOIN influencers i ON i.id = a.influencer_id WHERE a.status IN ('expired','error')`)) add('medium', 'connection', `Reconnect Instagram: ${s.name ?? s.username}`, `Status: ${s.status}`, '/analytics/connections');

  const chatgpt = chatgptDashboard(db, user);
  if (chatgpt?.weekly && chatgpt.weekly.status !== 'imported') add('low', 'chatgpt', 'Weekly ChatGPT analysis not imported yet', `${chatgpt.label}: package for ${formatDate(chatgpt.weekly.period.from)} – ${formatDate(chatgpt.weekly.period.to)} is ready`, `/chatgpt/exports/${chatgpt.weekly.export_key}`);

  const order = { high: 0, medium: 1, low: 2 };
  attention.sort((a, b) => order[a.severity as 'high'] - order[b.severity as 'high'] || (b.amount ?? 0) - (a.amount ?? 0));

  const active = health.filter((c) => !['planning'].includes(c.stage));
  return {
    today: t,
    finance,
    campaigns: {
      active: health.length,
      in_production: active.length,
      pending_approvals: pending.length,
      overdue_deliverables: overdueDeliverables.length,
      over_budget: health.filter((c) => c.finance?.over_budget).length,
      list: health.map((c) => ({ ...c, finance: campFin && c.finance ? { revenue: c.finance.revenue, contribution_margin: c.finance.contribution_margin, margin_bps: c.finance.margin_bps, receivable_outstanding: c.finance.receivable_outstanding, unpaid_cost: c.finance.unpaid_cost, over_budget: c.finance.over_budget } : null })),
    },
    deals: {
      open: deals.length,
      weighted_margin: can(user.role, 'rates') ? deals.reduce((s, d) => s + dealEconomics(d).weightedMargin, 0) : null,
      follow_ups: followUps,
    },
    influencers: influencerTrends(db).filter((x) => x.direction === 'improving' || x.direction === 'declining'),
    editors: editorWorkload(db, t),
    attention,
    chatgpt,
  };
}

// ---------------------------------------------------------------- routes

export function domainRoutes(app: Express, opts: AppOptions) {
  app.get('/api/dashboard', (req, res) => {
    const u = requireInternal(req);
    if (u.role === 'editor') throw new HttpError(403, 'Editors use the content workspace');
    res.json(dashboard(req.db, u));
  });

  app.post('/api/deals/:id/convert', (req, res) => {
    const u = requireCap(req, 'campaigns');
    res.status(201).json({ campaign_id: convertDeal(req.db, u, Number(req.params.id)) });
  });

  app.post('/api/shortlist', (req, res) => {
    const u = requireCap(req, 'staff');
    if (u.role === 'editor') throw new HttpError(403, 'Not available');
    res.json({ rows: shortlist(req.db, req.body ?? {}, can(u.role, 'rates')) });
  });

  app.get('/api/influencers/stats', (req, res) => {
    const u = requireInternal(req);
    if (u.role === 'editor' || !scopeFor(u, ENTITY.influencers)) throw new HttpError(403, 'Not allowed');
    res.json({ rows: [...creatorStats(req.db, null, { commercials: can(u.role, 'rates') }).values()] });
  });

  // Creator photo / logo for the roster and media kits.
  const photoDir = join(opts.dataDir, 'uploads', 'photos');
  app.post('/api/influencers/:id/photo', express.raw({ type: () => true, limit: PHOTO_MAX }), (req, res) => {
    const u = requireCap(req, 'talent');
    const inf = get(req.db, 'SELECT * FROM influencers WHERE id = ? AND archived_at IS NULL', Number(req.params.id));
    if (!inf) throw new HttpError(404, 'Creator not found');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Empty file');
    // Checks the bytes (not the declared type) and strips location/device metadata before anything is stored.
    const { bytes, ext } = safePhoto(body);
    mkdirSync(photoDir, { recursive: true });
    if (inf.photo_file) rmSync(join(photoDir, inf.photo_file), { force: true });
    const file = `influencer-${inf.id}-${Date.now()}.${ext}`;
    writeFileSync(join(photoDir, file), bytes);
    update(req.db, 'influencers', inf.id, { photo_file: file });
    audit(req.db, u.id, 'upload', 'influencers', inf.id, { photo_file: inf.photo_file }, { photo_file: file, size: bytes.length });
    res.json({ ok: true });
  });

  app.delete('/api/influencers/:id/photo', (req, res) => {
    const u = requireCap(req, 'talent');
    const inf = get(req.db, 'SELECT * FROM influencers WHERE id = ?', Number(req.params.id));
    if (!inf) throw new HttpError(404, 'Creator not found');
    if (inf.photo_file) rmSync(join(photoDir, inf.photo_file), { force: true });
    update(req.db, 'influencers', inf.id, { photo_file: null });
    audit(req.db, u.id, 'delete', 'influencers', inf.id, { photo_file: inf.photo_file }, { photo_file: null });
    res.json({ ok: true });
  });

  app.get('/api/influencers/:id/photo', (req, res) => {
    const u = requireInternal(req);
    if (u.role === 'editor' || !scopeFor(u, ENTITY.influencers)) throw new HttpError(403, 'Not allowed');
    const path = photoPath(opts.dataDir, get(req.db, 'SELECT photo_file FROM influencers WHERE id = ?', Number(req.params.id)) ?? {});
    if (!path) throw new HttpError(404, 'No photo');
    res.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(readFileSync(path));
  });

  app.get('/api/influencers/:id/overview', (req, res) => {
    const u = requireInternal(req);
    if (!scopeFor(u, ENTITY.influencers)) throw new HttpError(403, 'Not allowed');
    const db = req.db;
    const id = Number(req.params.id);
    const row = get(db, 'SELECT * FROM influencers WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Influencer not found');
    const t = today(db);
    const deals = all(db, `SELECT d.id, d.title, d.stage, d.expected_close, b.name AS brand_name FROM deals d LEFT JOIN brands b ON b.id = d.brand_id WHERE d.archived_at IS NULL AND EXISTS (SELECT 1 FROM json_each(COALESCE(d.creators,'[]')) j WHERE json_extract(j.value, '$.influencer_id') = ?) ORDER BY d.id DESC`, id);
    const campaigns = all(db, `SELECT c.id, c.name, c.stage, c.start_date, c.end_date, cc.status AS roster_status, ${can(u.role, 'rates') ? 'cc.fee,' : ''} b.name AS brand_name FROM campaign_creators cc JOIN campaigns c ON c.id = cc.campaign_id LEFT JOIN brands b ON b.id = c.brand_id WHERE cc.influencer_id = ? ORDER BY c.start_date DESC`, id);
    const deliverables = all(db, `SELECT d.*, c.name AS campaign_name FROM deliverables d JOIN campaigns c ON c.id = d.campaign_id WHERE d.influencer_id = ? AND d.archived_at IS NULL ORDER BY d.due_date DESC`, id).map((r) => decode('deliverables', r));
    const payments = can(u.role, 'campaign_finance') ? payeeStatement(db, t, 'influencer', id) : null;
    const commissions = can(u.role, 'campaign_finance') ? listInvoices(db, t, { influencer_id: id }) : null;
    const connections = all(db, `SELECT id, platform, username, status, last_sync_at, last_sync_status, last_error, available_metrics FROM social_accounts WHERE influencer_id = ?`, id);
    res.json({
      row: attachLabels(db, ENTITY.influencers, [serialize(ENTITY.influencers, row, u)])[0],
      reliability: reliability(db, id).get(id) ?? null,
      deals, campaigns, deliverables, payments, commissions, connections,
      documents: all(db, `SELECT id, title, kind, expiry_date, url, file FROM documents WHERE archived_at IS NULL AND entity_type = 'influencers' AND entity_id = ?`, id),
    });
  });

  app.get('/api/brands/:id/overview', (req, res) => {
    const u = requireInternal(req);
    if (!scopeFor(u, ENTITY.brands)) throw new HttpError(403, 'Not allowed');
    const db = req.db;
    const id = Number(req.params.id);
    const row = get(db, 'SELECT * FROM brands WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Brand not found');
    const t = today(db);
    res.json({
      row: attachLabels(db, ENTITY.brands, [serialize(ENTITY.brands, row, u)])[0],
      contacts: all(db, 'SELECT * FROM contacts WHERE brand_id = ? AND archived_at IS NULL ORDER BY is_primary DESC, name', id),
      deals: all(db, 'SELECT id, title, stage, brand_price, probability, expected_close, next_action, next_action_date, campaign_id FROM deals WHERE brand_id = ? AND archived_at IS NULL ORDER BY id DESC', id).map((d) => (can(u.role, 'rates') ? d : { ...d, brand_price: undefined })),
      campaigns: all(db, 'SELECT id, name, stage, start_date, end_date FROM campaigns WHERE brand_id = ? AND archived_at IS NULL ORDER BY start_date DESC', id),
      invoices: can(u.role, 'campaign_finance') ? listInvoices(db, t, { brand_id: id }) : null,
      documents: all(db, `SELECT id, title, kind, expiry_date, url, file FROM documents WHERE archived_at IS NULL AND entity_type = 'brands' AND entity_id = ?`, id),
    });
  });

  app.get('/api/campaigns/:id/overview', (req, res) => {
    const u = requireInternal(req);
    if (!scopeFor(u, ENTITY.campaigns)) throw new HttpError(403, 'Not allowed');
    const db = req.db;
    const id = Number(req.params.id);
    const row = get(db, 'SELECT * FROM campaigns WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Campaign not found');
    const t = today(db);
    const cf = can(u.role, 'campaign_finance');
    const roster = all(db, `SELECT cc.*, i.name AS influencer_name, i.handle FROM campaign_creators cc JOIN influencers i ON i.id = cc.influencer_id WHERE cc.campaign_id = ? AND cc.archived_at IS NULL`, id).map((r) => serialize(ENTITY.campaign_creators, r, u));
    const deliverables = attachLabels(db, ENTITY.deliverables, all(db, `SELECT * FROM deliverables WHERE campaign_id = ? AND archived_at IS NULL ORDER BY due_date`, id).map((r) => serialize(ENTITY.deliverables, r, u)));
    const tasks = attachLabels(db, ENTITY.content_tasks, all(db, `SELECT * FROM content_tasks WHERE campaign_id = ? AND archived_at IS NULL ORDER BY due_date`, id).map((r) => serialize(ENTITY.content_tasks, r, u)));
    const approvals = tasks.length ? all(db, `SELECT c.*, u.name AS user_name, t.title FROM comments c JOIN content_tasks t ON t.id = c.entity_id LEFT JOIN users u ON u.id = c.user_id WHERE c.entity_type = 'content_tasks' AND c.kind = 'approval' AND t.campaign_id = ? ORDER BY c.created_at DESC LIMIT 100`, id) : [];
    res.json({
      row: attachLabels(db, ENTITY.campaigns, [serialize(ENTITY.campaigns, row, u)])[0],
      finance: cf ? campaignFinancials(db, t, [id]).get(id) : null,
      health: campaignHealth(db, t, cf).find((h) => h.id === id) ?? null,
      roster, deliverables, tasks, approvals,
      invoices: cf ? listInvoices(db, t, { campaign_id: id }) : null,
      obligations: cf ? listObligations(db, t, { campaign_id: id }) : null,
      earmarks: can(u.role, 'finance') ? all(db, `SELECT * FROM earmarks WHERE status = 'active' AND (campaign_id = ? OR obligation_id IN (SELECT id FROM obligations WHERE campaign_id = ?))`, id, id) : null,
      documents: all(db, `SELECT id, title, kind, url, file, visibility FROM documents WHERE archived_at IS NULL AND entity_type = 'campaigns' AND entity_id = ?`, id),
      posts: all(db, `SELECT p.*, i.name AS influencer_name FROM posts p JOIN influencers i ON i.id = p.influencer_id WHERE p.campaign_id = ? AND p.archived_at IS NULL`, id).map((r) => decode('posts', r)),
    });
  });

  app.get('/api/campaigns-health', (req, res) => {
    const u = requireInternal(req);
    if (!scopeFor(u, ENTITY.campaigns)) throw new HttpError(403, 'Not allowed');
    res.json({ rows: campaignHealth(req.db, today(req.db), can(u.role, 'campaign_finance')) });
  });

  app.get('/api/editors-workload', (req, res) => {
    const u = requireInternal(req);
    if (!scopeFor(u, ENTITY.editors) || u.role === 'editor') throw new HttpError(403, 'Not allowed');
    res.json({ rows: editorWorkload(req.db, today(req.db)) });
  });

  app.get('/api/influencer-trends', (req, res) => {
    requireCap(req, 'staff');
    res.json({ rows: influencerTrends(req.db) });
  });

  // ---- content workspace: script/caption, versions, review decisions
  const loadTask = (req: Request) => {
    const u = requireUser(req);
    const s = scopeFor(u, ENTITY.content_tasks);
    if (!s) throw new HttpError(403, 'Not allowed');
    const row = get(req.db, `SELECT * FROM content_tasks x WHERE x.id = ? AND (${s.where})`, Number(req.params.id), ...s.params);
    if (!row) throw new HttpError(404, 'Task not found');
    return { u, task: decode('content_tasks', row)! };
  };

  app.put('/api/content/:id/script', (req, res) => {
    const { u, task } = loadTask(req);
    const script = typeof req.body?.script === 'string' ? req.body.script.slice(0, 100_000) : task.script;
    const caption = typeof req.body?.caption === 'string' ? req.body.caption.slice(0, 10_000) : task.caption;
    update(req.db, 'content_tasks', task.id, { script, caption });
    audit(req.db, u.id, 'update', 'content_tasks', task.id, { script: task.script, caption: task.caption }, { script, caption });
    res.json({ ok: true });
  });

  app.post('/api/content/:id/versions', (req, res) => {
    const { u, task } = loadTask(req);
    const url = String(req.body?.url ?? '').trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new HttpError(400, 'Version link must start with http(s)://');
    const versions: Row[] = task.versions ?? [];
    const v = { no: versions.length + 1, url: url || null, notes: String(req.body?.notes ?? '').slice(0, 2000), script: task.script ?? null, caption: task.caption ?? null, at: new Date().toISOString(), by: u.name };
    update(req.db, 'content_tasks', task.id, { versions: [...versions, v] });
    audit(req.db, u.id, 'version', 'content_tasks', task.id, null, v);
    res.status(201).json({ version: v });
  });

  app.post('/api/content/:id/review', (req, res) => {
    const { u, task } = loadTask(req);
    if (u.role === 'editor') throw new HttpError(403, 'Editors cannot approve their own work');
    if (!can(u.role, 'content')) throw new HttpError(403, 'Not allowed');
    const decision = String(req.body?.decision);
    const next: Record<string, string> = { approve_internal: 'brand_review', request_changes: 'changes_requested', brand_approved: 'approved', deliver: 'delivered' };
    if (!next[decision]) throw new HttpError(400, 'Unknown decision');
    if (decision === 'request_changes' && !req.body?.comment?.trim()) throw new HttpError(400, 'Describe the changes needed');
    const revisions = all(req.db, `SELECT meta FROM comments WHERE entity_type = 'content_tasks' AND entity_id = ? AND kind = 'approval'`, task.id).filter((r) => JSON.parse(r.meta ?? '{}').to === 'changes_requested').length;
    tx(req.db, () => {
      beforeWrite(req.db, u, 'content_tasks', { stage: next[decision] }, task);
      update(req.db, 'content_tasks', task.id, { stage: next[decision], ...(next[decision] === 'delivered' ? { delivered_at: new Date().toISOString() } : {}) });
      const after = decode('content_tasks', get(req.db, 'SELECT * FROM content_tasks WHERE id = ?', task.id))!;
      afterWrite(req.db, u, 'content_tasks', after, task);
      if (req.body?.comment?.trim()) insert(req.db, 'comments', { entity_type: 'content_tasks', entity_id: task.id, kind: 'feedback', body: req.body.comment.trim(), meta: { version: (task.versions ?? []).length || null, timestamp_sec: Number.isFinite(req.body?.timestamp_sec) ? req.body.timestamp_sec : null, decision }, user_id: u.id, created_by: u.id });
      audit(req.db, u.id, decision, 'content_tasks', task.id, { stage: task.stage }, { stage: next[decision] }, req.body?.comment);
    });
    const allowance = task.revision_allowance ?? 2;
    res.json({ ok: true, revisions_used: revisions + (decision === 'request_changes' ? 1 : 0), allowance, extra_revision: decision === 'request_changes' && revisions + 1 > allowance ? { cost: task.extra_revision_cost ?? null } : null });
  });

  // Own payment information for editors and creators.
  app.get('/api/my/payments', (req, res) => {
    const u = requireUser(req);
    const t = today(req.db);
    if (u.role === 'editor' && u.editor_id) return res.json(payeeStatement(req.db, t, 'editor', u.editor_id));
    if (u.role === 'creator' && u.influencer_id) return res.json(payeeStatement(req.db, t, 'influencer', u.influencer_id));
    throw new HttpError(404, 'No payee profile linked to your account');
  });

  app.post('/api/assets/:id/events', (req, res) => {
    const u = requireCap(req, 'finance');
    const a = decode('assets', get(req.db, 'SELECT * FROM assets WHERE id = ?', Number(req.params.id)));
    if (!a) throw new HttpError(404, 'Asset not found');
    const { date, kind, notes } = req.body ?? {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new HttpError(400, 'Choose a date');
    const event = { date, kind: String(kind ?? 'other').slice(0, 40), notes: String(notes ?? '').slice(0, 1000), by: u.name };
    update(req.db, 'assets', a.id, { events: [...(a.events ?? []), event] });
    audit(req.db, u.id, 'asset_event', 'assets', a.id, null, event);
    res.status(201).json({ ok: true });
  });

  app.get('/api/meta/stages', (_req, res) => res.json({ campaign: CAMPAIGN_STAGES, content: CONTENT_STAGES }));
}
