# Socialmog HQ

Internal operating system for Socialmog: influencer roster, brand CRM and deal pipeline, campaigns, content and editors, finance and cash rotation, weekly creator analytics, PDF reports, and restricted brand/creator portals.

Every dashboard figure is derived from stored records and opens the records behind it. Money is stored as integer paise; INR, Indian digit grouping (₹1,00,000) and Asia/Kolkata are the defaults.

## Run it

Requires Node.js **22.18+** (Node runs the TypeScript directly; no build step for the server).

```bash
npm install
cp .env.example .env          # set FOUNDER_EMAIL / FOUNDER_PASSWORD and a strong APP_SECRET
npm run dev                   # http://localhost:4000 (API + Vite dev server in one process)
```

Production:

```bash
npm run build                 # builds the web app into dist/web
NODE_ENV=production npm start # serves API + built app; session cookies are Secure (HTTPS)
```

All data lives in `DATA_DIR` (default `./data`): `hq.sqlite`, `uploads/`, `reports/`, `backups/`.

### Demo data

With `SEED_DEMO=1` (default) an empty database is filled with clearly labelled demo records (DEMO badges and a banner). It includes your worked example: **Glow Co — Diwali Glow Launch**, a ₹1,00,000 campaign with a ₹50,000 advance received, ₹65,000 creator commitments, ₹10,000 editing, plus the separate ₹20,000 PocketFin commission expected later. Try the ₹30,000 camera under **Finance → Can we afford it?** and delay the commission in the table.

Demo logins (password `demo-password-2026`): `meera@` finance, `aditya@` campaign manager, `sana@` talent manager, `ishaan@` editor, `neha@` brand portal (Glow Co), `riya@` creator portal — all `@demo.socialmog.in`. Remove everything demo from **Settings → Data & backups** (real records are untouched).

## Tests

```bash
npm test        # node:test — finance engine, permissions over HTTP, forecast ordering, analytics, reports
npm run typecheck
```

Covered: Indian formatting and exact splits, partial payments, over-payment and duplicate-payment guards (idempotency key, bank reference, same-day duplicate), reversals, TDS on receipts and payouts, transfers excluded from earnings, no double counting of campaign costs, earmark history, bank CSV import de-duplication, same-day forecast ordering, the founder's camera example with a delayed commission, role/field redaction, editor isolation, external users blocked from internal APIs, CSRF header, login lockout, weekly comparisons with unavailable metrics, once-per-week scheduled analysis, external report redaction.

## How the money works

| Concept | Rule |
| --- | --- |
| **Cash** | Account opening balance + posted transactions. Nothing else changes cash. Future-dated transactions are refused; expected money is a receivable or payable. |
| **Transfers** | Two linked transactions; never income or expense. |
| **Receivables** | Invoices and scheduled payment milestones (not yet invoiced). Unpaid invoices are never cash. Partial payments, TDS withheld by the brand and write-offs settle them. |
| **Payables** | Creator, editor, vendor, operating, salary, rent, subscription, asset, tax, loan, founder. Confirmed roster fees and editor fees create payables automatically. TDS you deduct creates a TDS payable due on the 7th of next month. Recurring payables roll forward when settled. |
| **Corrections** | Amounts, dates and accounts are never edited: post a reversal (history kept). Allocations can be un-applied with a reason. |
| **Earmarks** | Internal allocations of cash you hold (to a payable, a campaign or a reserve). Changing one closes it and creates a new one, so history is kept. Bank money is pooled; a campaign "owns" cash only where an earmark says so. |
| **Campaign costs** | Planned = budget allocation. Committed = payables + direct campaign spend not linked to a payable. Paid = settled. Shown side by side, never added — so creator costs are counted once. |
| **Earnings** | Configurable in **Settings → Finance rules**: recognise on invoice, on cash, or on campaign go-live; creator fees as pass-through or cost of sales; assets capitalised (with depreciation) or expensed. Gross billings, cash collected, agency earnings, contribution margin and operating result are always separate figures. Founder money, loans, taxes and asset purchases are shown separately. |
| **Forecast** | Actual cash + expected receipts − obligations, day by day. Base, conservative and custom scenarios; every assumption is listed; any receipt can be delayed or excluded; each payment shows whether it can be made on its due date. Purchase simulation compares with/without and explains the gap; a founder override records the reason and the warning and adds the purchase as a payable — existing obligations are untouched. |

## Roles

Founder/Admin, Finance, Campaign Manager, Talent Manager, Editor, and external Brand and Creator users. Permissions are enforced on the server per route, per row (editors only reach their own tasks and payments) and per field (identity, bank, rates, margins). Brand and creator users can only call `/api/portal/*`, which selects fields explicitly. All writes go to the audit log; archiving is recoverable.

## Integrations

Nothing is ever sent outside the app automatically: invites and reports are copied, downloaded or opened in your own mail app by a person. In-app reminders and analysis run on schedule.

- **Instagram (Meta "Instagram API with Instagram Login")** — set `META_APP_ID`, `META_APP_SECRET`, `APP_BASE_URL` and a strong `APP_SECRET`; register `{APP_BASE_URL}/oauth/instagram/callback` as the redirect URI. **Analytics → Connections** creates a single-use 7-day link per roster profile; the creator authorises on Instagram's own page (no passwords). Long-lived tokens are AES-256-GCM encrypted and refreshed before expiry. Each sync pulls only the metrics the authorisation allows; anything unavailable is stored as null and listed. Socialmog's own accounts use a roster profile with relationship **Agency-owned**.
- **OpenAI** — set `OPENAI_API_KEY` (optional `OPENAI_MODEL`). It writes the summary, hypotheses and three actions from computed metrics only; it never calculates figures. Without it, reports use rule-based suggestions labelled as such.
- **Not connected:** email/WhatsApp sending, bank feeds, YouTube API, payment gateways. Manual workflows: copy links or use the mail button; import bank statements as CSV (duplicates skipped); enter YouTube/other platforms weekly by hand or CSV; record payments manually with a reference.

## Automation

The in-process scheduler (every 30s) runs: weekly analysis at the configured day/time (default Monday 09:00 IST, for the week just ended; one run per week via unique job keys, up to 3 attempts, founder notified on failure), daily in-app reminders, daily backups (14 kept), and scheduled report templates. **Settings → Automation** shows job history with retry.

## Reports

**Reports** generates branded, searchable PDFs (with CSV) in the background: finance, founder, campaign, influencer growth, brand statement, creator statement, editor summary, expenses, asset register, deal pipeline, shareable roster. Choose period, records and sections; internal and external templates are separate (external hides commissions, margins, private notes). Each run is archived with a data snapshot and version, and permission is re-checked on download.

## Code map

```
src/shared/   schema.ts (entities → DB, validation, forms, permissions) · money.ts · dates.ts · charts.ts (SVG for web + PDF) · calc.ts
src/server/   index.ts · app.ts (auth, CRUD, search, files, admin) · db.ts · finance.ts + finance-routes.ts · forecast.ts (pure engine)
              domain.ts (hooks, deal→campaign, shortlist, health, dashboard) · analytics.ts (weekly analysis, Instagram, OpenAI)
              reports.ts (PDF centre) · portal.ts · jobs.ts · seed.ts
src/web/      main.tsx (shell, routes) · lib.tsx (API client, DataTable, forms, kanban, calendar, charts) · pages/*
tests/        node:test suites
```

Deliberate simplifications (each marked `ponytail:` in code): migrations are additive only; list endpoints return up to 10,000 rows and filter/sort/paginate in the browser; jobs run in-process. Upgrade paths are noted next to each.
