/**
 * Restricted external portals. Brand and creator users can only reach these routes, and each
 * response is built field by field — margins, creator fees of others, commissions and internal
 * notes are never selected.
 */
import type { Express, Request } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { all, audit, decode, get, HttpError, insert, update, type Row, type User } from './db.ts';
import { founders, notify, requireUser } from './app.ts';
import { listInvoices, listObligations, today } from './finance.ts';
import { afterWrite, beforeWrite } from './domain.ts';

function brandUser(req: Request): User {
  const u = requireUser(req);
  if (u.role !== 'brand' || !u.brand_id) throw new HttpError(403, 'Brand portal only');
  return u;
}

function creatorUser(req: Request): User {
  const u = requireUser(req);
  if (u.role !== 'creator' || !u.influencer_id) throw new HttpError(403, 'Creator portal only');
  return u;
}

const publicDeliverable = (d: Row) => ({ id: d.id, title: d.title, type: d.type, platform: d.platform, status: d.status, due_date: d.due_date, publish_date: d.publish_date, live_url: d.live_url, creator: d.creator, campaign: d.campaign, metrics: d.metrics ? JSON.parse(d.metrics) : null });

export function portalRoutes(app: Express, dataDir: string) {
  app.get('/api/portal/brand', (req, res) => {
    const u = brandUser(req);
    const db = req.db;
    const brand = get(db, 'SELECT id, name FROM brands WHERE id = ?', u.brand_id);
    const campaigns = all(db, `SELECT id, name, objective, stage, start_date, end_date, kpi_targets FROM campaigns WHERE brand_id = ? AND archived_at IS NULL ORDER BY start_date DESC`, u.brand_id).map((c) => ({ ...c, kpi_targets: JSON.parse(c.kpi_targets ?? 'null') }));
    const ids = campaigns.map((c) => c.id);
    const inList = ids.length ? ids.join(',') : 'NULL';
    const deliverables = all(db, `SELECT d.*, i.name AS creator, c.name AS campaign FROM deliverables d JOIN influencers i ON i.id = d.influencer_id JOIN campaigns c ON c.id = d.campaign_id WHERE d.campaign_id IN (${inList}) AND d.archived_at IS NULL AND d.status <> 'cancelled' ORDER BY d.due_date`).map(publicDeliverable);
    // Only content that has been sent for the brand's review (or already approved) is visible.
    const approvals = all(db, `SELECT t.id, t.title, t.stage, t.due_date, t.caption, t.versions, c.name AS campaign, i.name AS creator FROM content_tasks t LEFT JOIN campaigns c ON c.id = t.campaign_id LEFT JOIN influencers i ON i.id = t.influencer_id WHERE t.campaign_id IN (${inList}) AND t.archived_at IS NULL AND t.stage IN ('brand_review','approved','delivered')`)
      .map((t) => {
        const versions = JSON.parse(t.versions ?? '[]');
        const latest = versions[versions.length - 1];
        return { id: t.id, title: t.title, stage: t.stage, due_date: t.due_date, campaign: t.campaign, creator: t.creator, caption: t.caption, latest_version: latest ? { no: latest.no, url: latest.url, notes: latest.notes, at: latest.at } : null };
      });
    const invoices = listInvoices(db, today(db), { brand_id: u.brand_id! })
      .filter((i) => i.status === 'issued')
      .map((i) => ({ id: i.id, number: i.number, label: i.label, campaign: i.campaign_name, issue_date: i.issue_date, due_date: i.due_date, total: i.total, received: i.paid + i.tds, outstanding: i.outstanding, state: i.payment_state }));
    const documents = all(db, `SELECT id, title, kind, url, file FROM documents WHERE archived_at IS NULL AND visibility = 'brand' AND ((entity_type = 'brands' AND entity_id = ?) OR (entity_type = 'campaigns' AND entity_id IN (${inList})))`, u.brand_id);
    res.json({ brand, campaigns, deliverables, approvals, invoices, documents });
  });

  app.post('/api/portal/content/:id/review', (req, res) => {
    const u = brandUser(req);
    const db = req.db;
    const t = decode('content_tasks', get(db, `SELECT t.* FROM content_tasks t JOIN campaigns c ON c.id = t.campaign_id WHERE t.id = ? AND c.brand_id = ? AND t.stage = 'brand_review'`, Number(req.params.id), u.brand_id));
    if (!t) throw new HttpError(404, 'Nothing awaiting your review here');
    const decision = req.body?.decision;
    const comment = String(req.body?.comment ?? '').trim().slice(0, 5000);
    if (!['approve', 'changes'].includes(decision)) throw new HttpError(400, 'Choose approve or request changes');
    if (decision === 'changes' && !comment) throw new HttpError(400, 'Describe the changes needed');
    const stage = decision === 'approve' ? 'approved' : 'changes_requested';
    beforeWrite(db, u, 'content_tasks', { stage }, t);
    update(db, 'content_tasks', t.id, { stage });
    afterWrite(db, u, 'content_tasks', { ...t, stage }, t);
    if (comment) insert(db, 'comments', { entity_type: 'content_tasks', entity_id: t.id, kind: 'feedback', body: `${u.name} (brand): ${comment}`, meta: { decision, version: (t.versions ?? []).length || null, from_portal: true }, user_id: u.id });
    audit(db, u.id, `brand_${decision}`, 'content_tasks', t.id, { stage: t.stage }, { stage }, comment);
    const owner = get(db, 'SELECT owner_id FROM campaigns WHERE id = ?', t.campaign_id)?.owner_id;
    notify(db, [...founders(db), ...(owner ? [owner] : [])], { kind: 'review', title: `Brand ${decision === 'approve' ? 'approved' : 'requested changes on'}: ${t.title}`, body: comment || undefined, link: `/content/${t.id}` });
    res.json({ ok: true });
  });

  app.get('/api/portal/creator', (req, res) => {
    const u = creatorUser(req);
    const db = req.db;
    const me = get(db, 'SELECT id, name, handle FROM influencers WHERE id = ?', u.influencer_id);
    const deliverables = all(db, `SELECT d.*, i.name AS creator, c.name AS campaign FROM deliverables d JOIN influencers i ON i.id = d.influencer_id JOIN campaigns c ON c.id = d.campaign_id WHERE d.influencer_id = ? AND d.archived_at IS NULL AND d.status <> 'cancelled' ORDER BY d.due_date`, u.influencer_id).map(publicDeliverable);
    const payments = listObligations(db, today(db), { influencer_id: u.influencer_id! })
      .filter((o) => o.status !== 'cancelled' && o.category === 'creator_payout')
      .map((o) => ({ id: o.id, description: o.description, campaign: o.campaign_name, amount: o.amount, paid: o.paid, tds_deducted: o.tds, outstanding: o.outstanding, due_date: o.due_date, state: o.payment_state }));
    const reports = all(db, `SELECT id, period_start, content FROM weekly_reports WHERE influencer_id = ? ORDER BY period_start DESC, version DESC LIMIT 8`, u.influencer_id).map((r) => {
      const c = JSON.parse(r.content);
      return { id: r.id, period_start: r.period_start, summary: c.summary, metrics: c.metrics, recommendations: c.recommendations, source: c.source };
    });
    const documents = all(db, `SELECT id, title, kind, url, file FROM documents WHERE archived_at IS NULL AND visibility = 'creator' AND entity_type = 'influencers' AND entity_id = ?`, u.influencer_id);
    res.json({ me, deliverables, payments, reports: reports.filter((r, i, a) => a.findIndex((x) => x.period_start === r.period_start) === i), documents });
  });

  app.post('/api/portal/deliverables/:id/live', (req, res) => {
    const u = creatorUser(req);
    const d = get(req.db, 'SELECT * FROM deliverables WHERE id = ? AND influencer_id = ?', Number(req.params.id), u.influencer_id);
    if (!d) throw new HttpError(404, 'Deliverable not found');
    const url = String(req.body?.live_url ?? '').trim();
    if (!/^https?:\/\/\S+$/.test(url)) throw new HttpError(400, 'Paste the full post link (https://…)');
    update(req.db, 'deliverables', d.id, { live_url: url, publish_date: d.publish_date ?? today(req.db) });
    audit(req.db, u.id, 'creator_live_link', 'deliverables', d.id, { live_url: d.live_url }, { live_url: url });
    notify(req.db, founders(req.db), { kind: 'deliverable', title: `${u.name} posted: ${d.title}`, body: url, link: `/campaigns/${d.campaign_id}` });
    res.json({ ok: true });
  });

  // Portal users may open only documents explicitly shared with them.
  app.get('/api/portal/documents/:id', (req, res) => {
    const u = requireUser(req);
    const doc = get(req.db, 'SELECT * FROM documents WHERE id = ? AND archived_at IS NULL', Number(req.params.id));
    const ok = doc && ((u.role === 'brand' && doc.visibility === 'brand' && (doc.entity_type === 'brands' ? doc.entity_id === u.brand_id : !!get(req.db, 'SELECT id FROM campaigns WHERE id = ? AND brand_id = ?', doc.entity_id, u.brand_id)))
      || (u.role === 'creator' && doc.visibility === 'creator' && doc.entity_type === 'influencers' && doc.entity_id === u.influencer_id));
    if (!ok) throw new HttpError(404, 'Document not found');
    if (!doc.file) return doc.url ? res.redirect(doc.url) : res.status(404).json({ error: 'No file attached' });
    const path = join(dataDir, 'uploads', doc.file);
    if (!existsSync(path)) throw new HttpError(404, 'File missing from storage');
    audit(req.db, u.id, 'portal_download', 'documents', doc.id);
    res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${doc.file.replace(/^\d+-\d+-/, '')}"`);
    res.send(readFileSync(path));
  });
}
