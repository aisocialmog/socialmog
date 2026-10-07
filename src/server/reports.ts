/**
 * PDF reporting centre. Every figure is computed from stored records by the same functions the
 * app uses; AI text (if any) only appears inside weekly-analysis narratives. Reports are generated
 * in the background, archived with a data snapshot and version, and re-checked for permission on download.
 */
import type { Express, Request } from 'express';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, addMonths, financialYearStart, formatDate, formatDateTime, formatPeriod, isIsoDate, monthStart, partsInTz, weekStart } from '../shared/dates.ts';
import { formatINR, formatNumberIN, paiseToRupeesString } from '../shared/money.ts';
import { barChart, lineChart, SERIES_LIGHT, THEME_PRINT } from '../shared/charts.ts';
import { dealEconomics } from '../shared/calc.ts';
import { can, humanize, type Cap } from '../shared/schema.ts';
import { all, audit, decode, get, HttpError, insert, run, update, type Db, type Row, type User } from './db.ts';
import { founders, notify, requireUser, toCsv } from './app.ts';
import { accountBalances, ageing, campaignFinancials, cashflowByPeriod, earnings, forecastInputs, listInvoices, listObligations, payeeStatement, today } from './finance.ts';
import { forecast, SCENARIOS } from './forecast.ts';
import { campaignHealth, dashboard, editorWorkload, influencerTrends } from './domain.ts';
import { analyseWeek, enrich } from './analytics.ts';
import { enqueue, onTick, registerJob, runDueJobs } from './jobs.ts';

const require = createRequire(import.meta.url);
const PdfPrinter = require('pdfmake');
const vfsRaw = require('pdfmake/build/vfs_fonts.js');
const vfs = vfsRaw.pdfMake?.vfs ?? vfsRaw;
const font = (n: string) => Buffer.from(vfs[n], 'base64');
const printer = new PdfPrinter({ Roboto: { normal: font('Roboto-Regular.ttf'), bold: font('Roboto-Medium.ttf'), italics: font('Roboto-Italic.ttf'), bolditalics: font('Roboto-MediumItalic.ttf') } });

const ACCENT = '#2747d8';
const MUTED = '#64748b';
const W = 515; // A4 width minus margins, in points

type Content = any;
interface Col { label: string; key: string; money?: boolean; num?: boolean; width?: string | number; link?: string }
interface Built { title: string; subtitle: string; summary: string[]; content: Content[]; csv: { name: string; columns: Col[]; rows: Row[] }[]; data: Row; recipient?: string }
interface Ctx { db: Db; params: Row; audience: 'internal' | 'external'; today: string; user: User | null; from: string; to: string; sections: (k: string) => boolean }

// ---------------------------------------------------------------- pdf building blocks

const h2 = (text: string): Content => ({ text, style: 'h2', tocItem: false });
const p = (text: any, extra: Row = {}): Content => (typeof text === 'object' && !Array.isArray(text) ? { margin: [0, 0, 0, 6], ...text, ...extra } : { text, margin: [0, 0, 0, 6], ...extra });
const muted = (text: string): Content => ({ text, style: 'muted', margin: [0, 0, 0, 6] });
const bullets = (items: string[]): Content => (items.length ? { ul: items, margin: [0, 0, 0, 8] } : muted('None.'));
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatINR(n));
const n0 = (n: number | null | undefined) => (n === null || n === undefined ? 'Unavailable' : formatNumberIN(n));
const pctTxt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);

function table(cols: Col[], rows: Row[], opts: { total?: Row; fontSize?: number } = {}): Content {
  if (!rows.length) return muted('No records for this selection.');
  const cell = (c: Col, r: Row) => {
    const v = r[c.key];
    const text = c.money ? money(v) : c.num ? (v == null ? '—' : formatNumberIN(v)) : v === null || v === undefined || v === '' ? '—' : String(v);
    return { text, alignment: c.money || c.num ? 'right' : 'left', ...(c.link && r[c.link] ? { link: r[c.link], color: ACCENT } : {}) };
  };
  const body: any[][] = [cols.map((c) => ({ text: c.label, style: 'th', alignment: c.money || c.num ? 'right' : 'left' })), ...rows.map((r) => cols.map((c) => cell(c, r)))];
  if (opts.total) body.push(cols.map((c, i) => ({ ...(i === 0 ? { text: 'Total' } : cell(c, opts.total!)), bold: true, fillColor: '#f8f9fb' })));
  return {
    table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: cols.map((c) => c.width ?? (c.money || c.num ? 'auto' : '*')), body },
    layout: { hLineWidth: (i: number) => (i === 0 ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => '#e5e7eb', paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 4, paddingRight: () => 4 },
    fontSize: opts.fontSize ?? (cols.length > 6 ? 7.5 : 8.5),
    margin: [0, 2, 0, 10],
  };
}

function kv(rows: [string, string][]): Content {
  return { table: { widths: [180, '*'], body: rows.map(([k, v]) => [{ text: k, color: MUTED }, { text: v, alignment: 'right', bold: true }]) }, layout: 'noBorders', margin: [0, 0, 0, 10] };
}

const chart = (svg: string): Content => ({ svg, width: W, margin: [0, 4, 0, 10] });

function summaryBox(lines: string[]): Content {
  return { table: { widths: ['*'], body: [[{ stack: [{ text: 'Executive summary', bold: true, color: ACCENT, margin: [0, 0, 0, 4] }, { ul: lines.length ? lines : ['No data in this period.'] }], fillColor: '#eef2ff', margin: [8, 8, 8, 8] }]] }, layout: 'noBorders', margin: [0, 6, 0, 10] };
}

export async function renderPdf(b: Built, meta: { audience: string; generatedAt: string; version: number; period: string }): Promise<Buffer> {
  const doc = printer.createPdfKitDocument({
    pageSize: 'A4',
    pageMargins: [40, 62, 40, 54],
    info: { title: b.title, author: 'Socialmog', subject: b.subtitle, creator: 'Socialmog HQ', producer: 'Socialmog HQ' },
    header: () => ({ columns: [{ text: [{ text: 'SOCIAL', bold: true, color: '#0f172a' }, { text: 'MOG', bold: true, color: ACCENT }], fontSize: 12 }, { text: b.title, alignment: 'right', fontSize: 8, color: MUTED, margin: [0, 3, 0, 0] }], margin: [40, 24, 40, 0] }),
    footer: (page: number, pages: number) => ({
      columns: [
        { text: `${meta.audience === 'external' ? `Prepared for ${b.recipient ?? 'client'}` : 'Internal — confidential'} · v${meta.version} · ${meta.generatedAt}`, fontSize: 7, color: MUTED, width: '*' },
        { text: `Page ${page} of ${pages}`, alignment: 'right', fontSize: 7.5, color: MUTED, width: 70 },
      ],
      margin: [40, 18, 40, 0],
    }),
    content: [
      { text: b.title, style: 'h1' },
      { text: b.subtitle, color: MUTED, margin: [0, 0, 0, 2] },
      { text: `Reporting period: ${meta.period}   ·   Generated ${meta.generatedAt}`, fontSize: 8, color: MUTED, margin: [0, 0, 0, 6] },
      summaryBox(b.summary),
      ...b.content,
    ],
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: '#0f172a', lineHeight: 1.2 },
    styles: { h1: { fontSize: 19, bold: true, margin: [0, 0, 0, 2] }, h2: { fontSize: 12.5, bold: true, color: '#1e3a8a', margin: [0, 12, 0, 6] }, muted: { fontSize: 8, color: MUTED }, th: { bold: true, fillColor: '#eef2ff', color: '#1e3a8a' } },
  });
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ---------------------------------------------------------------- report definitions

interface ReportDef { label: string; internalCap: Cap; externalCap?: Cap; sections: string[]; build: (c: Ctx) => Built }

const fyOrParams = (c: Ctx) => formatPeriod(c.from, c.to);

export const REPORTS: Record<string, ReportDef> = {
  finance: {
    label: 'Finance report',
    internalCap: 'finance',
    sections: ['cash', 'receivables', 'payables', 'campaigns', 'earnings', 'forecast'],
    build: (c) => {
      const { db } = c;
      const opening = accountBalances(db, addDays(c.from, -1)).filter((a) => a.active);
      const closing = accountBalances(db, c.to).filter((a) => a.active);
      const sum = (rows: Row[], k = 'balance') => rows.reduce((s, r) => s + r[k], 0);
      const flows = cashflowByPeriod(db, c.from, c.to);
      const cashIn = sum(flows, 'cash_in');
      const cashOut = sum(flows, 'cash_out');
      const rec = listInvoices(db, c.today, { open: true });
      const pay = listObligations(db, c.today, { open: true });
      const fin = [...campaignFinancials(db, c.today).values()];
      const e = earnings(db, c.from, c.to, c.today);
      const inputs = forecastInputs(db, c.today, 90);
      const base = forecast({ today: c.today, horizonDays: 90, ...inputs, scenario: SCENARIOS.base });
      const cons = forecast({ today: c.today, horizonDays: 90, ...inputs, scenario: SCENARIOS.conservative });
      const content: Content[] = [];
      if (c.sections('cash')) {
        const newAccounts = closing.filter((a) => a.opening_date >= c.from && a.opening_date <= c.to).reduce((s, a) => s + a.opening_balance, 0);
        content.push(h2('Cash position'), kv([
          [`Opening cash (${formatDate(addDays(c.from, -1))})`, money(sum(opening))], ...(newAccounts ? [['Opening balances of accounts added in period', money(newAccounts)] as [string, string]] : []), ['Cash received in period', money(cashIn)], ['Cash paid in period', money(cashOut)],
          ['Transfers between own accounts (excluded)', money(sum(flows, 'transfers') / 2)], [`Closing cash (${formatDate(c.to)})`, money(sum(closing))],
        ]), table([{ label: 'Account', key: 'name' }, { label: 'Type', key: 'type' }, { label: 'Opening', key: 'opening', money: true }, { label: 'Closing', key: 'balance', money: true }], closing.map((a) => ({ ...a, opening: opening.find((o) => o.id === a.id)?.balance ?? 0 })), { total: { opening: sum(opening), balance: sum(closing) } }));
        if (flows.length > 1) content.push(chart(barChart({ categories: flows.map((f) => f.period), series: [{ name: 'Cash in', color: SERIES_LIGHT[0], values: flows.map((f) => f.cash_in) }, { name: 'Cash out', color: SERIES_LIGHT[1], values: flows.map((f) => f.cash_out) }], yFormat: (n) => formatINR(n, { compact: true }), theme: THEME_PRINT, width: W, height: 200 })));
      }
      if (c.sections('receivables')) {
        content.push(h2('Outstanding brand receivables'), muted(`As of ${formatDate(c.today)}. Scheduled milestones are expected but not yet invoiced. None of this is cash until received.`),
          table([{ label: 'Payer', key: 'payer' }, { label: 'Milestone', key: 'label' }, { label: 'Invoice', key: 'number' }, { label: 'Due', key: 'due' }, { label: 'Confidence', key: 'confidence' }, { label: 'Outstanding', key: 'outstanding', money: true }, { label: 'Days overdue', key: 'days_overdue', num: true }],
            rec.map((r) => ({ ...r, due: formatDate(r.due_date), confidence: humanize(r.confidence) })), { total: { outstanding: sum(rec, 'outstanding') } }),
          table([{ label: 'Overdue by', key: 'bucket' }, { label: 'Items', key: 'count', num: true }, { label: 'Outstanding', key: 'total', money: true }], ageing(rec)));
      }
      if (c.sections('payables')) {
        content.push(h2('Creator, editor, vendor and other payables'),
          table([{ label: 'Payee', key: 'payee' }, { label: 'For', key: 'description' }, { label: 'Category', key: 'cat' }, { label: 'Due', key: 'due' }, { label: 'Status', key: 'st' }, { label: 'Outstanding', key: 'outstanding', money: true }, { label: 'Days overdue', key: 'days_overdue', num: true }],
            pay.map((o) => ({ ...o, cat: humanize(o.category), due: formatDate(o.due_date), st: humanize(o.status) })), { total: { outstanding: sum(pay, 'outstanding') } }),
          kv([['Overdue now', money(sum(pay.filter((o) => o.days_overdue > 0), 'outstanding'))], ['Due in next 30 days (incl. overdue)', money(sum(pay.filter((o) => o.due_date <= addDays(c.today, 30)), 'outstanding'))]]));
      }
      if (c.sections('campaigns')) {
        content.push(h2('Campaign budgets, costs and margins'), muted('Revenue excludes GST. Committed cost = payables + direct spend not linked to a payable (payouts counted once). Planned is the budget allocation, shown for comparison only.'),
          table([{ label: 'Campaign', key: 'name' }, { label: 'Budget', key: 'client_budget', money: true }, { label: 'Revenue', key: 'revenue', money: true }, { label: 'Planned', key: 'planned_cost', money: true }, { label: 'Committed', key: 'committed_cost', money: true }, { label: 'Paid', key: 'paid_cost', money: true }, { label: 'Margin', key: 'contribution_margin', money: true }, { label: 'Margin %', key: 'm' }],
            fin.map((f) => ({ ...f, m: f.margin_bps === null ? '—' : `${(f.margin_bps / 100).toFixed(1)}%` })), { total: { client_budget: sum(fin, 'client_budget'), revenue: sum(fin, 'revenue'), planned_cost: sum(fin, 'planned_cost'), committed_cost: sum(fin, 'committed_cost'), paid_cost: sum(fin, 'paid_cost'), contribution_margin: sum(fin, 'contribution_margin') } }));
      }
      if (c.sections('earnings')) {
        content.push(h2('Billings, earnings and operating results'), kv([
          ['Gross billings (invoices issued, excl. GST)', money(e.gross_billings)], ['Commission billed', money(e.commission_billed)], ['Cash collected (incl. GST, pass-through)', money(e.cash_collected)],
          [`Agency earnings (${e.basis.basis} basis)`, money(e.agency_earnings)], ['Campaign contribution margin', money(e.contribution_margin)], ['Operating expenses (paid)', money(e.opex)],
          [e.basis.assets === 'capitalise' ? 'Depreciation' : 'Asset purchases expensed', money(e.basis.assets === 'capitalise' ? e.depreciation : e.capex)], ['Operating result (profit before tax)', money(e.operating_result)],
        ]), h2('Shown separately (not operating results)'), kv([['Asset purchases (cash)', money(e.capex)], ['Taxes paid (GST/TDS remitted)', money(e.taxes_paid)], ['Founder contributions', money(e.financing.founder_contributions)], ['Founder withdrawals', money(e.financing.founder_withdrawals)], ['Loans received', money(e.financing.loans_received)], ['Loan repayments', money(e.financing.loan_repayments)]]),
        p({ text: 'Calculation basis', bold: true }), bullets(e.explanation));
      }
      if (c.sections('forecast')) {
        content.push(h2('Cash forecast — next 90 days'), chart(lineChart({ labels: base.daily.map((d) => formatDate(d.date, { year: false })), series: [{ name: 'Base scenario', color: SERIES_LIGHT[0], values: base.daily.map((d) => d.closing) }, { name: 'Conservative', color: SERIES_LIGHT[1], values: cons.daily.map((d) => d.closing) }], reference: { value: 0, label: 'Zero' }, yFormat: (n) => formatINR(n, { compact: true }), theme: THEME_PRINT, width: W, height: 210 })),
          kv([['Base: lowest balance', `${money(base.minBalance)} on ${formatDate(base.minBalanceDate)}`], ['Base: earliest shortfall', base.earliestShortfall ? `${formatDate(base.earliestShortfall.date)} — ${base.earliestShortfall.label}` : 'None'], ['Base: funding required', money(base.fundingRequired)], ['Conservative: earliest shortfall', cons.earliestShortfall ? `${formatDate(cons.earliestShortfall.date)} (funding ${money(cons.fundingRequired)})` : 'None']]),
          p({ text: 'Assumptions (base scenario)', bold: true }), bullets(base.assumptions),
          p({ text: 'Upcoming obligations (next 30 days)', bold: true }), table([{ label: 'Date', key: 'd' }, { label: 'Item', key: 'label' }, { label: 'Amount', key: 'amount', money: true }, { label: 'Payable on date?', key: 'ok' }], base.events.filter((x) => x.direction === 'out' && x.date <= addDays(c.today, 30)).map((x) => ({ ...x, d: formatDate(x.date), ok: x.payable === 'yes' ? 'Yes' : `${x.payable === 'partial' ? 'Partly' : 'No'} (short ${money(x.shortBy)})` }))));
      }
      return {
        title: 'Finance report',
        subtitle: 'Cash, receivables, payables, campaign economics and forecast',
        summary: [
          `Cash moved from ${money(sum(opening))} to ${money(sum(closing))}: ${money(cashIn)} received, ${money(cashOut)} paid.`,
          `Brands and creators owe ${money(sum(rec, 'outstanding'))} (${money(sum(rec.filter((r) => r.days_overdue > 0), 'outstanding'))} overdue); we owe ${money(sum(pay, 'outstanding'))}.`,
          `Agency earnings ${money(e.agency_earnings)} vs gross billings ${money(e.gross_billings)} and cash collected ${money(e.cash_collected)} — three different figures.`,
          `Operating result ${money(e.operating_result)} after ${money(e.opex)} operating expenses.`,
          base.earliestShortfall ? `Base forecast shows a shortfall on ${formatDate(base.earliestShortfall.date)}; funding required ${money(base.fundingRequired)}.` : cons.earliestShortfall ? `No shortfall in the base forecast; the conservative scenario runs short on ${formatDate(cons.earliestShortfall.date)}.` : 'No projected shortfall in base or conservative scenarios over 90 days.',
        ],
        content,
        csv: [
          { name: 'Receivables', columns: [{ label: 'Payer', key: 'payer' }, { label: 'Milestone', key: 'label' }, { label: 'Due', key: 'due_date' }, { label: 'Outstanding', key: 'outstanding', money: true }], rows: rec },
          { name: 'Payables', columns: [{ label: 'Payee', key: 'payee' }, { label: 'For', key: 'description' }, { label: 'Due', key: 'due_date' }, { label: 'Outstanding', key: 'outstanding', money: true }], rows: pay },
          { name: 'Campaigns', columns: [{ label: 'Campaign', key: 'name' }, { label: 'Revenue', key: 'revenue', money: true }, { label: 'Committed cost', key: 'committed_cost', money: true }, { label: 'Paid cost', key: 'paid_cost', money: true }, { label: 'Margin', key: 'contribution_margin', money: true }], rows: fin },
        ],
        data: { opening: sum(opening), closing: sum(closing), cashIn, cashOut, receivables: sum(rec, 'outstanding'), payables: sum(pay, 'outstanding'), earnings: e, forecast: { base: { min: base.minBalance, shortfall: base.earliestShortfall }, conservative: { shortfall: cons.earliestShortfall } } },
      };
    },
  },

  founder: {
    label: 'Founder report',
    internalCap: 'finance',
    sections: ['finance', 'campaigns', 'influencers', 'pipeline', 'editors', 'priorities'],
    build: (c) => {
      const { db } = c;
      const d = dashboard(db, c.user ?? (get(db, `SELECT id, name, email, role, editor_id, influencer_id, brand_id FROM users WHERE role = 'founder' LIMIT 1`) as User));
      const f = d.finance!;
      const content: Content[] = [];
      if (c.sections('finance')) content.push(h2('Financial position & upcoming cash needs'), kv([['Cash across accounts', money(f.cash)], ['Expected incoming', money(f.receivables.total)], ['Overdue from brands', money(f.receivables.overdue)], ['Payables (all unpaid)', money(f.payables.total)], ['Due in 7 / 14 / 30 days', `${money(f.payables.due7)} / ${money(f.payables.due14)} / ${money(f.payables.due30)}`], ['Earmarked (internal allocations)', money(f.earmarks.total)], ['Left after 30-day commitments & protected reserves', money(f.afterCommitments)], ['Projected shortfall (base)', f.forecast.base.earliestShortfall ? `${formatDate(f.forecast.base.earliestShortfall.date)} · ${money(f.forecast.base.fundingRequired)}` : 'None in 90 days'], [`Agency earnings FY (${f.earnings.basis})`, money(f.earnings.agency_earnings)], ['Operating result FY', money(f.earnings.operating_result)]]));
      if (c.sections('campaigns')) content.push(h2('Campaign progress & risks'), table([{ label: 'Campaign', key: 'name' }, { label: 'Stage', key: 'st' }, { label: 'Health', key: 'health' }, { label: 'Issues', key: 'issues' }], d.campaigns.list.map((x: Row) => ({ ...x, st: humanize(x.stage), issues: x.flags.map((fl: Row) => fl.text).join('; ') || '—' }))));
      if (c.sections('influencers')) content.push(h2('Influencer growth'), table([{ label: 'Creator', key: 'name' }, { label: 'Week of', key: 'w' }, { label: 'Views vs 4-wk', key: 'v' }, { label: 'Follower growth', key: 'g' }, { label: 'Direction', key: 'direction' }], influencerTrends(db).map((t) => ({ ...t, w: formatDate(t.period_start), v: pctTxt(t.views_vs_baseline), g: pctTxt(t.follower_growth_pct) }))));
      if (c.sections('pipeline')) content.push(h2('Deal pipeline — follow-ups'), table([{ label: 'Deal', key: 'title' }, { label: 'Stage', key: 'st' }, { label: 'Next action', key: 'next_action' }, { label: 'When', key: 'w' }, { label: 'Expected fee', key: 'expected_fee', money: true }], d.deals.follow_ups.map((x: Row) => ({ ...x, st: humanize(x.stage), w: formatDate(x.next_action_date) }))));
      if (c.sections('editors')) content.push(h2('Editor workload & delivery'), table([{ label: 'Editor', key: 'name' }, { label: 'Open', key: 'open', num: true }, { label: 'Due this week', key: 'due_this_week', num: true }, { label: 'Overdue', key: 'overdue', num: true }, { label: 'Blocked', key: 'blocked', num: true }, { label: 'Median turnaround (days)', key: 'median_turnaround_days', num: true }], d.editors));
      if (c.sections('priorities')) content.push(h2('Decisions & priorities for the coming week'), bullets(d.attention.slice(0, 15).map((a: Row) => `[${a.severity}] ${a.title} — ${a.detail}`)));
      return {
        title: 'Founder weekly report',
        subtitle: 'Finance, campaigns, creators, pipeline and team in one view',
        summary: [
          `Cash ${money(f.cash)}; ${money(f.payables.due14)} due in 14 days against ${money(f.receivables.total)} expected incoming.`,
          f.forecast.base.earliestShortfall ? `Projected shortfall ${formatDate(f.forecast.base.earliestShortfall.date)} (base).` : 'No projected shortfall in the base scenario.',
          `${d.campaigns.active} active campaigns · ${d.campaigns.overdue_deliverables} overdue deliverables · ${d.campaigns.pending_approvals} awaiting approval.`,
          `${d.deals.follow_ups.length} deals need follow-up; ${d.attention.filter((a: Row) => a.severity === 'high').length} urgent items need decisions.`,
        ],
        content,
        csv: [{ name: 'Attention', columns: [{ label: 'Severity', key: 'severity' }, { label: 'Item', key: 'title' }, { label: 'Detail', key: 'detail' }], rows: d.attention }],
        data: { finance: f, campaigns: d.campaigns, deals: d.deals.follow_ups, attention: d.attention },
      };
    },
  },

  campaign: {
    label: 'Campaign report',
    internalCap: 'campaign_finance',
    externalCap: 'campaigns',
    sections: ['overview', 'roster', 'deliverables', 'results', 'costs', 'lessons'],
    build: (c) => {
      const { db } = c;
      const camp = decode('campaigns', get(db, `SELECT c.*, b.name AS brand_name FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = ?`, Number(c.params.campaign_id)));
      if (!camp) throw new HttpError(400, 'Choose a campaign');
      const ext = c.audience === 'external';
      const roster = all(db, `SELECT cc.*, i.name, i.handle, i.platforms FROM campaign_creators cc JOIN influencers i ON i.id = cc.influencer_id WHERE cc.campaign_id = ? AND cc.status <> 'dropped' AND cc.archived_at IS NULL`, camp.id).map((r) => ({ ...r, platforms: JSON.parse(r.platforms ?? '[]') }));
      const dels = all(db, `SELECT d.*, i.name AS creator FROM deliverables d JOIN influencers i ON i.id = d.influencer_id WHERE d.campaign_id = ? AND d.archived_at IS NULL ORDER BY d.due_date`, camp.id).map((r) => decode('deliverables', r)!);
      const f = campaignFinancials(db, c.today, [camp.id]).get(camp.id)!;
      const metricSum = (k: string) => {
        const v = dels.map((x) => x.metrics?.[k]).filter((x) => typeof x === 'number');
        return v.length ? v.reduce((a: number, b: number) => a + b, 0) : null;
      };
      const content: Content[] = [];
      if (c.sections('overview')) content.push(h2('Campaign overview'), kv([['Brand', camp.brand_name], ['Objective', camp.objective ?? '—'], ['Dates', `${formatDate(camp.start_date)} – ${formatDate(camp.end_date)}`], ['Stage', humanize(camp.stage)], ...(camp.client_budget != null ? [['Client budget', money(camp.client_budget)] as [string, string]] : [])]), ...(camp.brief ? [p({ text: 'Brief', bold: true }), p(camp.brief)] : []));
      if (c.sections('roster')) content.push(h2('Creator roster'), table([{ label: 'Creator', key: 'name' }, { label: 'Handle', key: 'handle' }, { label: 'Profile', key: 'url_text', link: 'url' }, ...(ext ? [] : [{ label: 'Status', key: 'status' }, { label: 'Negotiated cost', key: 'fee', money: true }])], roster.map((r) => ({ ...r, url: r.platforms?.[0]?.url, url_text: r.platforms?.[0]?.url ? `${humanize(r.platforms[0].platform)} profile` : '—' }))));
      if (c.sections('deliverables')) content.push(h2('Deliverables, approvals and published links'), table([{ label: 'Deliverable', key: 'title' }, { label: 'Creator', key: 'creator' }, { label: 'Status', key: 'st' }, { label: 'Due', key: 'due' }, { label: 'Published', key: 'pub' }, { label: 'Link', key: 'lt', link: 'live_url' }], dels.map((x) => ({ ...x, st: humanize(x.status), due: formatDate(x.due_date), pub: formatDate(x.publish_date), lt: x.live_url ? 'Open post' : '—' }))));
      if (c.sections('results')) {
        const targets = camp.kpi_targets ?? {};
        content.push(h2('Results against agreed targets'), muted('Views and interactions are totals of counted events. Reach is unique people per creator and is not summed because audiences overlap. Sales/ROI are shown only when conversions and revenue were recorded with a source.'),
          table([{ label: 'Metric', key: 'm' }, { label: 'Target', key: 't', num: true }, { label: 'Actual', key: 'a', num: true }, { label: '% of target', key: 'p' }], ['views', 'clicks', 'conversions'].map((k) => {
            const a = metricSum(k);
            return { m: humanize(k), t: targets[k] ?? null, a, p: a !== null && targets[k] ? `${Math.round((a / targets[k]) * 100)}%` : 'Unavailable' };
          })),
          table([{ label: 'Deliverable', key: 'title' }, { label: 'Creator', key: 'creator' }, { label: 'Reach', key: 'reach', num: true }, { label: 'Views', key: 'views', num: true }, { label: 'Likes', key: 'likes', num: true }, { label: 'Comments', key: 'comments', num: true }, { label: 'Shares', key: 'shares', num: true }, { label: 'Source', key: 'source' }], dels.filter((x) => x.metrics).map((x) => ({ ...x, ...x.metrics, source: `${x.metrics.source ?? 'Unknown'}${x.metrics.as_of ? `, ${formatDate(x.metrics.as_of)}` : ''}` }))));
        const conv = metricSum('conversions');
        const revenue = metricSum('revenue');
        content.push(conv !== null && revenue !== null && camp.client_budget ? p(`Attributed: ${formatNumberIN(conv)} conversions and ${money(revenue)} revenue as recorded by the brand/tracking link. ROI on client budget: ${(((revenue - camp.client_budget) / camp.client_budget) * 100).toFixed(0)}%. Attribution follows the tracking source noted per deliverable.`) : muted('Sales attribution unavailable: conversions and revenue were not recorded with a reliable source, so ROI is not shown.'));
      }
      if (c.sections('costs') && !ext) content.push(h2('Planned vs actual costs and payment status'), table([{ label: 'Category', key: 'cat' }, { label: 'Planned', key: 'planned', money: true }, { label: 'Committed', key: 'committed', money: true }, { label: 'Paid', key: 'paid', money: true }], ['creator', 'editing', 'production', 'other'].map((k) => ({ cat: humanize(k), planned: f.planned_by[k], committed: f.committed_by[k], paid: f.paid_by[k] })), { total: { planned: f.planned_cost, committed: f.committed_cost, paid: f.paid_cost } }),
        kv([['Revenue (ex-GST)', money(f.revenue)], ['Collected from brand', money(f.collected)], ['Still to collect', money(f.receivable_outstanding)], ['Still to pay out', money(f.unpaid_cost)], ['Contribution margin', `${money(f.contribution_margin)}${f.margin_bps !== null ? ` (${(f.margin_bps / 100).toFixed(1)}%)` : ''}`]]));
      if (c.sections('lessons')) content.push(h2('Lessons and recommended next steps'), p(camp.lessons ?? 'Not yet recorded.'));
      const views = metricSum('views');
      return {
        title: `Campaign report — ${camp.name}`,
        subtitle: `${camp.brand_name} · ${humanize(camp.stage)}`,
        recipient: camp.brand_name,
        summary: [
          `${dels.filter((x) => x.status === 'live').length} of ${dels.length} deliverables live across ${roster.length} creators.`,
          views !== null ? `${formatNumberIN(views)} total views recorded${camp.kpi_targets?.views ? ` against a target of ${formatNumberIN(camp.kpi_targets.views)}` : ''}.` : 'Performance results not yet recorded.',
          ...(ext ? [] : [`Revenue ${money(f.revenue)}, committed costs ${money(f.committed_cost)}, margin ${money(f.contribution_margin)}; ${money(f.receivable_outstanding)} to collect and ${money(f.unpaid_cost)} to pay.`]),
        ],
        content,
        csv: [{ name: 'Deliverables', columns: [{ label: 'Deliverable', key: 'title' }, { label: 'Creator', key: 'creator' }, { label: 'Status', key: 'status' }, { label: 'Due', key: 'due_date' }, { label: 'Published', key: 'publish_date' }, { label: 'Link', key: 'live_url' }, { label: 'Views', key: 'views' }], rows: dels.map((x) => ({ ...x, views: x.metrics?.views ?? null })) }],
        data: { campaign: { id: camp.id, name: camp.name }, deliverables: dels.length, finance: ext ? null : f },
      };
    },
  },

  influencer_growth: {
    label: 'Influencer growth report',
    internalCap: 'staff',
    externalCap: 'staff',
    sections: ['profile', 'metrics', 'content', 'findings', 'history'],
    build: (c) => {
      const { db } = c;
      const inf = decode('influencers', get(db, 'SELECT * FROM influencers WHERE id = ?', Number(c.params.influencer_id)));
      if (!inf) throw new HttpError(400, 'Choose a creator');
      const week = weekStart(c.to);
      const a = analyseWeek(db, inf.id, get(db, `SELECT period_start FROM analytics_snapshots WHERE influencer_id = ? AND period_start <= ? ORDER BY period_start DESC LIMIT 1`, inf.id, week)?.period_start ?? week);
      const report = get(db, `SELECT * FROM weekly_reports WHERE influencer_id = ? AND period_start = ? ORDER BY version DESC LIMIT 1`, inf.id, a.period.start);
      const stored = report ? JSON.parse(report.content) : null;
      const hist = all(db, `SELECT * FROM analytics_snapshots WHERE influencer_id = ? AND platform = ? AND period_start BETWEEN ? AND ? ORDER BY period_start`, inf.id, a.platform, c.from, c.to).map((s) => ({ ...s, metrics: enrich(JSON.parse(s.metrics ?? '{}')) }));
      const content: Content[] = [];
      if (c.sections('profile')) content.push(h2('Creator profile'), kv([['Creator', `${inf.name} (${inf.handle ?? '—'})`], ['Niches', (inf.niches ?? []).join(', ') || '—'], ['Location', inf.city ?? '—']]), table([{ label: 'Platform', key: 'pl' }, { label: 'Link', key: 'handle', link: 'url' }, { label: 'Followers', key: 'followers', num: true }, { label: 'Source / as of', key: 'src' }], (inf.platforms ?? []).map((pl: Row) => ({ ...pl, pl: humanize(pl.platform), src: `${pl.source ?? 'Unknown'}${pl.updated_at ? `, ${formatDate(pl.updated_at)}` : ''}` }))));
      if (c.sections('metrics')) content.push(h2(`Week of ${formatDate(a.period.start)} — ${a.platform}`), muted(`Source: ${a.source ?? 'no data recorded'}${a.updated_at ? ` · last updated ${formatDateTime(a.updated_at)}` : ''}. "Unavailable" means the metric was not provided; nothing is estimated.`),
        table([{ label: 'Metric', key: 'label' }, { label: 'This week', key: 'c' }, { label: 'Last week', key: 'p' }, { label: 'Change', key: 'ch' }, { label: '4-week avg', key: 'b' }, { label: 'vs 4-week', key: 'vb' }], a.metrics.map((m) => ({ label: m.label, c: m.current === null ? 'Unavailable' : formatNumberIN(m.current, { decimals: m.key === 'engagement_rate' ? 2 : 0 }), p: m.previous === null ? '—' : formatNumberIN(m.previous, { decimals: m.key === 'engagement_rate' ? 2 : 0 }), ch: pctTxt(m.change_pct), b: m.baseline === null ? '—' : formatNumberIN(m.baseline, { decimals: m.key === 'engagement_rate' ? 2 : 0 }), vb: pctTxt(m.change_vs_baseline_pct) }))),
        kv([['Median views per post', a.median_views.value === null ? 'Unavailable' : `${formatNumberIN(a.median_views.value)} (${a.median_views.basis})`], ['Average views per post', n0(a.avg_views)], ...(a.organic_vs_paid ? [['Organic / paid post views', `${n0(a.organic_vs_paid.organic_post_views)} / ${n0(a.organic_vs_paid.paid_post_views)}`] as [string, string]] : [])]));
      if (c.sections('content')) content.push(h2('Top content'), table([{ label: 'Post', key: 't', link: 'permalink' }, { label: 'Format', key: 'format' }, { label: 'Topic', key: 'topic' }, { label: 'Views', key: 'views', num: true }, { label: 'Eng. %', key: 'engagement_rate' }, { label: 'Paid?', key: 'promotion' }], a.top_content.map((x) => ({ ...x, t: 'Open post' }))), ...(a.weak_content.length ? [p({ text: 'Weakest content', bold: true }), table([{ label: 'Post', key: 't', link: 'permalink' }, { label: 'Format', key: 'format' }, { label: 'Views', key: 'views', num: true }], a.weak_content.map((x) => ({ ...x, t: 'Open post' })))] : []));
      if (c.sections('findings')) {
        const recs = (stored?.recommendations ?? a.recommendations) as Row[];
        content.push(h2('Findings'), p({ text: 'Observed in the data', bold: true }), bullets([...a.observations, ...a.patterns]), p({ text: 'Hypotheses (not proven by the data)', bold: true }), bullets(stored?.hypotheses ?? a.hypotheses),
          p({ text: `Recommended actions for next week${stored?.recommendations_source === 'ai' ? ' (AI-drafted from the numbers above, reviewed by the team)' : ''}`, bold: true }), { ol: recs.map((r) => `${r.action} — ${r.rationale}`), margin: [0, 0, 0, 8] },
          ...(a.previous_review.length ? [p({ text: 'Last week’s recommendations vs results', bold: true }), bullets(a.previous_review.map((r) => `${r.action}: ${r.outcome}`))] : []),
          p({ text: 'Limitations', bold: true }), bullets(a.flags.map((f) => f.text)), ...(report?.manager_notes && c.audience === 'internal' ? [p({ text: 'Manager notes', bold: true }), p(report.manager_notes)] : []));
      }
      if (c.sections('history') && hist.length > 1) {
        const labels = hist.map((s) => formatDate(s.period_start, { year: false }));
        content.push(h2('Historical growth'), p({ text: 'Followers at week end', bold: true }), chart(lineChart({ labels, series: [{ name: 'Followers', color: SERIES_LIGHT[0], values: hist.map((s) => s.metrics.followers_end ?? null) }], theme: THEME_PRINT, width: W, height: 170, yFormat: (n) => formatNumberIN(n, { compact: true }) })),
          p({ text: 'Weekly views', bold: true }), chart(barChart({ categories: labels, series: [{ name: 'Views', color: SERIES_LIGHT[0], values: hist.map((s) => s.metrics.views ?? null) }], theme: THEME_PRINT, width: W, height: 170, yFormat: (n) => formatNumberIN(n, { compact: true }) })));
      }
      return {
        title: `Growth report — ${inf.name}`,
        subtitle: `${inf.handle ?? ''} · ${a.platform}`,
        recipient: inf.name,
        summary: [stored?.summary ?? a.summary, ...a.observations.slice(1, 3), a.flags.some((f) => f.level === 'high') ? `Data issue: ${a.flags.find((f) => f.level === 'high')!.text}` : ''].filter(Boolean),
        content,
        csv: [{ name: 'Weekly snapshots', columns: [{ label: 'Week', key: 'period_start' }, { label: 'Followers', key: 'followers_end' }, { label: 'Views', key: 'views' }, { label: 'Reach', key: 'reach' }, { label: 'Engagement %', key: 'engagement_rate' }, { label: 'Source', key: 'source' }], rows: hist.map((s) => ({ period_start: s.period_start, source: s.source, ...s.metrics })) }],
        data: { influencer_id: inf.id, analysis: a, weeks: hist.length },
      };
    },
  },

  brand_statement: {
    label: 'Brand statement',
    internalCap: 'campaign_finance',
    externalCap: 'campaign_finance',
    sections: ['invoices'],
    build: (c) => {
      const brand = get(c.db, 'SELECT * FROM brands WHERE id = ?', Number(c.params.brand_id));
      if (!brand) throw new HttpError(400, 'Choose a brand');
      const inv = listInvoices(c.db, c.today, { brand_id: brand.id }).filter((i) => i.status === 'issued');
      const pays = all(c.db, `SELECT s.settled_on, s.amount, s.kind, i.number, t.reference FROM settlements s JOIN invoices i ON i.id = s.invoice_id LEFT JOIN transactions t ON t.id = s.transaction_id WHERE i.brand_id = ? AND s.reversed_at IS NULL AND s.settled_on BETWEEN ? AND ? ORDER BY s.settled_on`, brand.id, c.from, c.to);
      const sum = (r: Row[], k: string) => r.reduce((s, x) => s + x[k], 0);
      return {
        title: `Statement of account — ${brand.name}`,
        subtitle: 'Invoices issued by Socialmog and payments received',
        recipient: brand.name,
        summary: [`Invoiced ${money(sum(inv, 'total'))}; received ${money(sum(inv, 'paid'))}; TDS ${money(sum(inv, 'tds'))}; outstanding ${money(sum(inv, 'outstanding'))}.`],
        content: [h2('Invoices'), table([{ label: 'Invoice', key: 'number' }, { label: 'Description', key: 'label' }, { label: 'Campaign', key: 'campaign_name' }, { label: 'Issued', key: 'i' }, { label: 'Due', key: 'd' }, { label: 'Total', key: 'total', money: true }, { label: 'Received', key: 'paid', money: true }, { label: 'TDS', key: 'tds', money: true }, { label: 'Outstanding', key: 'outstanding', money: true }], inv.map((x) => ({ ...x, i: formatDate(x.issue_date), d: formatDate(x.due_date) })), { total: { total: sum(inv, 'total'), paid: sum(inv, 'paid'), tds: sum(inv, 'tds'), outstanding: sum(inv, 'outstanding') } }),
          h2('Payments received in period'), table([{ label: 'Date', key: 'd' }, { label: 'Invoice', key: 'number' }, { label: 'Type', key: 'k' }, { label: 'Reference', key: 'reference' }, { label: 'Amount', key: 'amount', money: true }], pays.map((x) => ({ ...x, d: formatDate(x.settled_on), k: x.kind === 'tds' ? 'TDS withheld' : 'Payment' })))],
        csv: [{ name: 'Invoices', columns: [{ label: 'Invoice', key: 'number' }, { label: 'Due', key: 'due_date' }, { label: 'Total', key: 'total', money: true }, { label: 'Received', key: 'paid', money: true }, { label: 'Outstanding', key: 'outstanding', money: true }], rows: inv }],
        data: { brand_id: brand.id, invoiced: sum(inv, 'total'), outstanding: sum(inv, 'outstanding') },
      };
    },
  },

  creator_statement: {
    label: 'Creator payment statement',
    internalCap: 'campaign_finance',
    externalCap: 'campaign_finance',
    sections: ['payments'],
    build: (c) => payeeReport(c, 'influencer'),
  },

  editor_summary: {
    label: 'Editor payment summary',
    internalCap: 'campaign_finance',
    externalCap: 'campaign_finance',
    sections: ['payments', 'work'],
    build: (c) => payeeReport(c, 'editor'),
  },

  expenses: {
    label: 'Expense report',
    internalCap: 'finance',
    sections: ['breakdown', 'detail'],
    build: (c) => {
      const rows = all(c.db, `SELECT t.*, a.name AS account FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.txn_date BETWEEN ? AND ? AND t.category IN ('operating_expense','bank_charges','asset_purchase') ORDER BY t.txn_date`, c.from, c.to)
        .map((t) => ({ ...t, signed: t.direction === 'out' ? t.amount : -t.amount, d: formatDate(t.txn_date), cat: humanize(t.category) }));
      const by = new Map<string, number>();
      for (const r of rows) by.set(r.cat, (by.get(r.cat) ?? 0) + r.signed);
      const opex = rows.filter((r) => r.category !== 'asset_purchase').reduce((s, r) => s + r.signed, 0);
      const capex = rows.filter((r) => r.category === 'asset_purchase').reduce((s, r) => s + r.signed, 0);
      return {
        title: 'Expense report',
        subtitle: 'Operating expenses with asset purchases shown separately',
        summary: [`Operating expenses ${money(opex)}; asset purchases ${money(capex)} (capital, reported separately).`],
        content: [h2('By category'), table([{ label: 'Category', key: 'k' }, { label: 'Total', key: 'v', money: true }], [...by].map(([k, v]) => ({ k, v }))), h2('All expense transactions'), table([{ label: 'Date', key: 'd' }, { label: 'Description', key: 'description' }, { label: 'Category', key: 'cat' }, { label: 'Paid to', key: 'counterparty_name' }, { label: 'Account', key: 'account' }, { label: 'Amount', key: 'signed', money: true }], rows)],
        csv: [{ name: 'Expenses', columns: [{ label: 'Date', key: 'txn_date' }, { label: 'Description', key: 'description' }, { label: 'Category', key: 'category' }, { label: 'Amount', key: 'signed', money: true }], rows }],
        data: { opex, capex, count: rows.length },
      };
    },
  },

  asset_register: {
    label: 'Asset register',
    internalCap: 'finance',
    sections: ['register'],
    build: (c) => {
      const rows = all(c.db, `SELECT * FROM assets WHERE archived_at IS NULL ORDER BY purchase_date`).map((a) => ({ ...a, cat: humanize(a.category ?? ''), st: humanize(a.status ?? ''), d: formatDate(a.purchase_date), w: formatDate(a.warranty_until), r: formatDate(a.renewal_date) }));
      return {
        title: 'Asset register',
        subtitle: 'Equipment and subscriptions owned by Socialmog',
        summary: [`${rows.filter((r) => r.status === 'active').length} active assets; total cost ${money(rows.reduce((s, r) => s + (r.cost ?? 0), 0))}.`],
        content: [table([{ label: 'Asset', key: 'name' }, { label: 'Category', key: 'cat' }, { label: 'Status', key: 'st' }, { label: 'Bought', key: 'd' }, { label: 'Cost', key: 'cost', money: true }, { label: 'Custodian', key: 'custodian' }, { label: 'Warranty', key: 'w' }, { label: 'Renewal', key: 'r' }], rows)],
        csv: [{ name: 'Assets', columns: [{ label: 'Asset', key: 'name' }, { label: 'Category', key: 'category' }, { label: 'Status', key: 'status' }, { label: 'Purchase date', key: 'purchase_date' }, { label: 'Cost', key: 'cost', money: true }, { label: 'Custodian', key: 'custodian' }, { label: 'Serial', key: 'serial_number' }], rows }],
        data: { count: rows.length },
      };
    },
  },

  deal_pipeline: {
    label: 'Deal pipeline report',
    internalCap: 'rates',
    sections: ['pipeline'],
    build: (c) => {
      const deals = all(c.db, `SELECT d.*, b.name AS brand FROM deals d LEFT JOIN brands b ON b.id = d.brand_id WHERE d.archived_at IS NULL ORDER BY d.stage, d.expected_close`).map((r) => decode('deals', r)!).map((d) => ({ ...d, ...dealEconomics(d), st: humanize(d.stage), close: formatDate(d.expected_close), next: `${d.next_action ?? '—'}${d.next_action_date ? ` (${formatDate(d.next_action_date)})` : ''}` }));
      const open = deals.filter((d) => !['won', 'lost'].includes(d.stage));
      return {
        title: 'Deal pipeline',
        subtitle: 'Open deals, expected agency fees and next actions',
        summary: [`${open.length} open deals; expected agency fee ${money(open.reduce((s, d) => s + d.agencyFee, 0))}; probability-weighted margin ${money(open.reduce((s, d) => s + d.weightedMargin, 0))}.`, `Won ${deals.filter((d) => d.stage === 'won').length}, lost ${deals.filter((d) => d.stage === 'lost').length}.`],
        content: [table([{ label: 'Deal', key: 'title' }, { label: 'Brand', key: 'brand' }, { label: 'Stage', key: 'st' }, { label: 'Agency fee', key: 'agencyFee', money: true }, { label: 'Margin', key: 'margin', money: true }, { label: 'Prob.', key: 'probability', num: true }, { label: 'Close', key: 'close' }, { label: 'Next action', key: 'next' }], open), ...(deals.some((d) => d.stage === 'lost') ? [h2('Lost deals'), table([{ label: 'Deal', key: 'title' }, { label: 'Reason', key: 'loss_reason' }], deals.filter((d) => d.stage === 'lost'))] : [])],
        csv: [{ name: 'Deals', columns: [{ label: 'Deal', key: 'title' }, { label: 'Stage', key: 'stage' }, { label: 'Agency fee', key: 'agencyFee', money: true }, { label: 'Probability', key: 'probability' }], rows: deals }],
        data: { open: open.length },
      };
    },
  },

  roster: {
    label: 'Shareable creator roster',
    internalCap: 'staff',
    externalCap: 'staff',
    sections: ['roster'],
    build: (c) => {
      const ids: number[] = Array.isArray(c.params.influencer_ids) ? c.params.influencer_ids.map(Number) : [];
      const rows = all(c.db, `SELECT * FROM influencers WHERE archived_at IS NULL AND relationship NOT IN ('inactive','prospect','agency_owned') ${ids.length ? `AND id IN (${ids.join(',')})` : ''} ORDER BY name`).map((r) => decode('influencers', r)!);
      // Public fields only: never commissions, rates, identity or internal notes.
      const content: Content[] = rows.map((r) => ({
        stack: [
          { text: `${r.name}  ${r.handle ?? ''}`, bold: true, fontSize: 11 },
          { text: [r.city, (r.niches ?? []).join(', '), (r.languages ?? []).join(', ')].filter(Boolean).join(' · '), color: MUTED, fontSize: 8.5 },
          table([{ label: 'Platform', key: 'pl', link: 'url' }, { label: 'Followers', key: 'followers', num: true }, { label: 'Avg views', key: 'avg_views', num: true }, { label: 'Engagement', key: 'er' }, { label: 'Source / as of', key: 'src' }], (r.platforms ?? []).map((p: Row) => ({ ...p, pl: humanize(p.platform), er: p.engagement_rate != null ? `${p.engagement_rate}%` : 'Unavailable', src: `${p.source ?? 'Unknown'}${p.updated_at ? `, ${formatDate(p.updated_at)}` : ''}` }))),
          ...(r.audience?.summary ? [{ text: `Audience: ${r.audience.summary} (${r.audience.source ?? 'source unknown'})`, fontSize: 8.5, margin: [0, 0, 0, 4] }] : []),
        ],
        margin: [0, 0, 0, 10],
        unbreakable: true,
      }));
      return {
        title: 'Socialmog creator roster',
        subtitle: 'Creators available for brand collaborations',
        recipient: c.params.recipient ?? 'brand partners',
        summary: [`${rows.length} creators. Metrics show their source and date; unavailable figures are marked as such.`],
        content,
        csv: [{ name: 'Roster', columns: [{ label: 'Name', key: 'name' }, { label: 'Handle', key: 'handle' }, { label: 'City', key: 'city' }, { label: 'Niches', key: 'niches' }], rows }],
        data: { creators: rows.length },
      };
    },
  },
};

function payeeReport(c: Ctx, kind: 'influencer' | 'editor'): Built {
  const id = Number(c.params[kind === 'influencer' ? 'influencer_id' : 'editor_id']);
  const who = get(c.db, `SELECT name FROM ${kind === 'influencer' ? 'influencers' : 'editors'} WHERE id = ?`, id);
  if (!who) throw new HttpError(400, `Choose the ${kind === 'influencer' ? 'creator' : 'editor'}`);
  const s = payeeStatement(c.db, c.today, kind, id);
  const paysInPeriod = s.payments.filter((p: Row) => p.settled_on >= c.from && p.settled_on <= c.to);
  const content: Content[] = [h2('Amounts owed'), table([{ label: 'For', key: 'description' }, { label: 'Campaign', key: 'campaign_name' }, { label: 'Due', key: 'd' }, { label: 'Amount', key: 'amount', money: true }, { label: 'Paid', key: 'paid', money: true }, { label: 'TDS', key: 'tds', money: true }, { label: 'Outstanding', key: 'outstanding', money: true }], s.obligations.map((o: Row) => ({ ...o, d: formatDate(o.due_date) }))),
    h2('Payments in period'), table([{ label: 'Date', key: 'd' }, { label: 'For', key: 'description' }, { label: 'Type', key: 'k' }, { label: 'Reference', key: 'reference' }, { label: 'Amount', key: 'amount', money: true }], paysInPeriod.map((p: Row) => ({ ...p, d: formatDate(p.settled_on), k: p.kind === 'tds' ? 'TDS deducted' : 'Bank payment' })))];
  if (kind === 'editor') {
    const tasks = all(c.db, `SELECT title, stage, delivered_at FROM content_tasks WHERE editor_id = ? AND delivered_at BETWEEN ? AND ?`, id, c.from, `${c.to}T23:59:59Z`);
    content.push(h2('Work delivered in period'), table([{ label: 'Task', key: 'title' }, { label: 'Delivered', key: 'd' }], tasks.map((t) => ({ ...t, d: formatDate(t.delivered_at) }))));
  }
  return {
    title: `${kind === 'influencer' ? 'Creator payment statement' : 'Editor payment summary'} — ${who.name}`,
    subtitle: 'Amounts owed, payments made and tax deducted',
    recipient: who.name,
    summary: [`Total owed ${money(s.total_owed)}; paid ${money(s.total_paid)}; TDS deducted ${money(s.total_tds)}; outstanding ${money(s.outstanding)}.`],
    content,
    csv: [{ name: 'Payments', columns: [{ label: 'Date', key: 'settled_on' }, { label: 'For', key: 'description' }, { label: 'Type', key: 'kind' }, { label: 'Amount', key: 'amount', money: true }], rows: s.payments }],
    data: { total_owed: s.total_owed, total_paid: s.total_paid, outstanding: s.outstanding },
  };
}

// ---------------------------------------------------------------- generation & archive

export function canGenerate(user: User, type: string, audience: string): boolean {
  const def = REPORTS[type];
  if (!def) return false;
  if (audience === 'external') return !!def.externalCap && can(user.role, def.externalCap) && user.role !== 'editor';
  return can(user.role, def.internalCap) && user.role !== 'editor';
}

function periodOf(params: Row, t: string) {
  const from = isIsoDate(params.from) ? params.from : financialYearStart(t);
  const to = isIsoDate(params.to) ? params.to : t;
  return { from, to };
}

export async function produce(db: Db, dataDir: string, runId: number): Promise<void> {
  const r = get(db, 'SELECT * FROM report_runs WHERE id = ?', runId);
  if (!r) throw new Error(`Report ${runId} not found`);
  const params = JSON.parse(r.params ?? '{}');
  const user = r.created_by ? (get(db, 'SELECT id, name, email, role, editor_id, influencer_id, brand_id FROM users WHERE id = ?', r.created_by) as User) : null;
  run(db, `UPDATE report_runs SET status = 'running', progress = 10, attempts = COALESCE(attempts,0) + 1, error = NULL WHERE id = ?`, runId);
  try {
    const t = today(db);
    const { from, to } = periodOf(params, t);
    const def = REPORTS[r.report_type];
    const selected: string[] | null = Array.isArray(params.sections) && params.sections.length ? params.sections : null;
    const built = def.build({ db, params, audience: r.audience, today: t, user, from, to, sections: (k) => !selected || selected.includes(k) });
    run(db, 'UPDATE report_runs SET progress = 50 WHERE id = ?', runId);
    const generatedAt = formatDateTime(new Date().toISOString());
    const pdf = await renderPdf(built, { audience: r.audience, generatedAt, version: r.version, period: fyOrParams({ from, to } as Ctx) });
    run(db, 'UPDATE report_runs SET progress = 85 WHERE id = ?', runId);
    const dir = join(dataDir, 'reports');
    mkdirSync(dir, { recursive: true });
    const base = `${runId}-${r.report_type}-v${r.version}`;
    writeFileSync(join(dir, `${base}.pdf`), pdf);
    const csv = built.csv.map((t2) => `${t2.name}\r\n${toCsv(t2.rows, t2.columns.map((c) => ({ key: c.key, label: c.label, type: c.money ? 'money' : undefined })))}`).join('\r\n\r\n');
    writeFileSync(join(dir, `${base}.csv`), `﻿${csv}`);
    const snapshot = JSON.stringify(built.data);
    update(db, 'report_runs', runId, { status: 'completed', progress: 100, file: `${base}.pdf`, csv_file: `${base}.csv`, title: built.title, snapshot: snapshot.length < 500_000 ? built.data : { note: 'Snapshot too large to archive inline' }, finished_at: new Date().toISOString() });
    if (user) notify(db, [user.id], { kind: 'report', title: `Report ready: ${built.title}`, link: `/reports/${runId}`, dedupe: `report:${runId}` });
  } catch (err) {
    update(db, 'report_runs', runId, { status: 'failed', error: (err as Error).message.slice(0, 500), finished_at: new Date().toISOString() });
    throw err;
  }
}

export function requestReport(db: Db, user: User | null, v: { report_type: string; audience: string; params: Row; template_id?: number | null }, uniqueKey?: string): number {
  const def = REPORTS[v.report_type];
  if (!def) throw new HttpError(400, 'Unknown report type');
  const audience = v.audience === 'external' ? 'external' : 'internal';
  if (audience === 'external' && !def.externalCap) throw new HttpError(400, `${def.label} is internal only`);
  if (user && !canGenerate(user, v.report_type, audience)) throw new HttpError(403, 'You cannot generate this report');
  const params = v.params ?? {};
  const same = JSON.stringify(params);
  const version = all(db, 'SELECT params FROM report_runs WHERE report_type = ? AND audience = ?', v.report_type, audience).filter((x) => x.params === same).length + 1;
  const id = insert(db, 'report_runs', { report_type: v.report_type, audience, params, status: 'queued', progress: 0, attempts: 0, version, template_id: v.template_id ?? null, title: def.label, created_by: user?.id ?? null });
  enqueue(db, 'report', { run_id: id }, uniqueKey ?? `report:${id}`);
  setTimeout(() => void runDueJobs(db), 20); // start now instead of waiting for the next scheduler tick
  if (user) audit(db, user.id, 'request', 'report_runs', id, null, v);
  return id;
}

let DATA_DIR = './data';
registerJob('report', (db, payload) => produce(db, DATA_DIR, payload.run_id));

// Scheduled templates: weekly (Mondays, previous week) and monthly (1st, previous month), after 08:00.
onTick((db, now, tz) => {
  const p = partsInTz(now, tz);
  if (p.hour < 8) return;
  for (const t of all(db, `SELECT * FROM report_templates WHERE archived_at IS NULL AND schedule IN ('weekly','monthly')`)) {
    let key: string | null = null;
    let from = '';
    let to = '';
    if (t.schedule === 'weekly' && p.weekday === 1) {
      from = addDays(weekStart(p.date), -7);
      to = addDays(from, 6);
      key = `${from}`;
    }
    if (t.schedule === 'monthly' && p.date.endsWith('-01')) {
      from = addMonths(monthStart(p.date), -1);
      to = addDays(monthStart(p.date), -1);
      key = from.slice(0, 7);
    }
    if (!key || t.last_run_key === key) continue;
    try {
      requestReport(db, null, { report_type: t.report_type, audience: t.audience, params: { ...JSON.parse(t.params ?? '{}'), from, to }, template_id: t.id }, `template:${t.id}:${key}`);
      run(db, 'UPDATE report_templates SET last_run_key = ? WHERE id = ?', key, t.id);
    } catch (err) {
      notify(db, founders(db), { kind: 'job_failed', title: `Scheduled report "${t.name}" could not start`, body: (err as Error).message, dedupe: `tmpl-fail:${t.id}:${key}` });
    }
  }
});

export function reportRoutes(app: Express, dataDir: string) {
  DATA_DIR = dataDir;
  const staff = (req: Request) => {
    const u = requireUser(req);
    if (u.role === 'editor' || !can(u.role, 'staff')) throw new HttpError(403, 'Not available');
    return u;
  };

  app.get('/api/reports/types', (req, res) => {
    const u = staff(req);
    res.json({ types: Object.entries(REPORTS).map(([k, d]) => ({ key: k, label: d.label, sections: d.sections, internal: canGenerate(u, k, 'internal'), external: canGenerate(u, k, 'external') })) });
  });

  app.get('/api/reports', (req, res) => {
    const u = staff(req);
    const rows = all(req.db, `SELECT r.id, r.report_type, r.audience, r.params, r.status, r.progress, r.attempts, r.error, r.version, r.title, r.created_at, r.finished_at, r.template_id, u.name AS requested_by FROM report_runs r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.id DESC LIMIT 300`)
      .filter((r) => canGenerate(u, r.report_type, r.audience))
      .map((r) => ({ ...r, params: JSON.parse(r.params ?? '{}') }));
    res.json({ rows });
  });

  app.post('/api/reports', (req, res) => {
    const u = staff(req);
    res.status(201).json({ id: requestReport(req.db, u, req.body ?? {}) });
  });

  app.post('/api/reports/:id/retry', (req, res) => {
    const u = staff(req);
    const r = get(req.db, 'SELECT * FROM report_runs WHERE id = ?', Number(req.params.id));
    if (!r || !canGenerate(u, r.report_type, r.audience)) throw new HttpError(404, 'Report not found');
    run(req.db, `UPDATE report_runs SET status = 'queued', progress = 0, error = NULL WHERE id = ?`, r.id);
    run(req.db, `DELETE FROM jobs WHERE unique_key = ? AND status = 'failed'`, `report:${r.id}`);
    enqueue(req.db, 'report', { run_id: r.id }, `report:${r.id}:retry:${Date.now()}`);
    setTimeout(() => void runDueJobs(req.db), 20);
    res.json({ ok: true });
  });

  app.get('/api/reports/:id', (req, res) => {
    const u = staff(req);
    const r = get(req.db, 'SELECT * FROM report_runs WHERE id = ?', Number(req.params.id));
    if (!r || !canGenerate(u, r.report_type, r.audience)) throw new HttpError(404, 'Report not found');
    res.json({ row: decode('report_runs', r) });
  });

  // Permission is re-checked on every download.
  app.get('/api/reports/:id/:kind', (req, res) => {
    const u = staff(req);
    if (!['pdf', 'csv'].includes(req.params.kind)) throw new HttpError(404, 'Not found');
    const r = get(req.db, 'SELECT * FROM report_runs WHERE id = ?', Number(req.params.id));
    if (!r || !canGenerate(u, r.report_type, r.audience)) throw new HttpError(404, 'Report not found');
    const file = req.params.kind === 'pdf' ? r.file : r.csv_file;
    if (!file || !existsSync(join(dataDir, 'reports', file))) throw new HttpError(404, 'File not ready');
    res.setHeader('Content-Type', req.params.kind === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${file}"`);
    audit(req.db, u.id, 'download', 'report_runs', r.id, null, { kind: req.params.kind });
    res.send(readFileSync(join(dataDir, 'reports', file)));
  });
}
