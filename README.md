# Socialmog HQ

Internal operating system for Socialmog: influencer roster, brand CRM and deal pipeline, campaigns, content and editors, finance and cash rotation, weekly creator analytics, PDF reports, and restricted brand/creator portals.

Every dashboard figure is derived from stored records and opens the records behind it. Money is stored as integer paise; INR, Indian digit grouping (₹1,00,000) and Asia/Kolkata are the defaults.

## Getting started — what you need to do

**1. Put it online (once).** A small server or VPS with Node.js 22.18+, a domain and HTTPS (for example Caddy or Nginx in front). Run `npm install && npm run build`, then start it with `NODE_ENV=production npm start` under a process manager (pm2 or systemd) and these settings in `.env`: `FOUNDER_EMAIL`, `FOUNDER_PASSWORD`, a long random `APP_SECRET`, `APP_BASE_URL`, `DATA_DIR`, and `SEED_DEMO=0` for real use. Copy `DATA_DIR/backups` off the server regularly (the app keeps 14 daily backups locally).

**2. First login (founder).** Look around the demo data if it is loaded, then remove it (**Settings → Data & backups**). Set **Finance rules**, **Automation** (weekly day/time) and **Agency & media kit** (contact details for kits). Add your team under **Users & roles** with the right role each.

**3. Finance — the part to get right.** Add every bank/UPI/cash account with its opening balance and date (**Finance → Accounts**). Add what brands owe you (**Receivables**, with expected dates) and what you owe (**Payables**: creators, editors, rent, salaries, subscriptions as recurring). From then on, record each real money movement when it happens (or import the bank CSV) and apply it to the invoice or payable, including TDS and whose it is.

**4. Creators, brands and work.** Add creators with **Influencers → Add creators from links** (ChatGPT fills the profile, both channels and recent videos) or by hand; upload photos and fill rate cards (brand price) and commissions. Add brands and deals; convert won deals into campaigns; add deliverables, content tasks and editors.

**5. Routine.** Daily: clear **Needs my attention** on the dashboard and record money in/out. Weekly: run the prepared ChatGPT package (copy prompt → ChatGPT → import → apply) and generate reports. Before pitching: generate a media kit. Quarterly: check TDS credits in 26AS/AIS (**Finance → TDS**).

**Optional:** Instagram API connection (Meta app keys) and an OpenAI key — everything works without them.

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

Covered (43 tests): Indian formatting and exact splits, partial payments, over-payment and duplicate-payment guards (idempotency key, bank reference, same-day duplicate), reversals, TDS on receipts and payouts, transfers excluded from earnings, no double counting of campaign costs, earmark history, bank CSV import de-duplication, same-day forecast ordering, the founder's camera example with a delayed commission, role/field redaction, editor isolation, external users blocked from internal APIs, CSRF header, login lockout, weekly comparisons with unavailable metrics, once-per-week scheduled analysis, external report redaction, and the ChatGPT workflow (package contents and exclusions, schema errors, unresolved IDs, metric conflicts, provenance, financial guards, stale exports, duplicate results, all-or-nothing apply, undo, permissions, weekly preparation, labelled PDF commentary), roster figures (average-views basis and fallbacks, paid posts excluded, brand prices), media kits (whole vs category grouping, brand-safe content) and photo uploads (byte checks, EXIF/GPS stripping, damaged files, permissions), unsafe links and long profiles spanning pages, and the TDS register (ownership splits, on-hold pass-on payables, creator-PAN TDS, reversals, reminders, backfill), and creator profiles from links (link parsing, exact matching only, new vs existing creators, unsafe links, failed reads, undo).

## How the money works

| Concept | Rule |
| --- | --- |
| **Cash** | Account opening balance + posted transactions. Nothing else changes cash. Future-dated transactions are refused; expected money is a receivable or payable. |
| **Transfers** | Two linked transactions; never income or expense. |
| **Receivables** | Invoices and scheduled payment milestones (not yet invoiced). Unpaid invoices are never cash. Partial payments, TDS withheld by the brand and write-offs settle them. |
| **Payables** | Creator, editor, vendor, operating, salary, rent, subscription, asset, tax, loan, founder. Confirmed roster fees and editor fees create payables automatically. TDS you deduct creates a TDS payable due on the 7th of next month. Recurring payables roll forward when settled. |
| **TDS** | When a brand withholds TDS you say whose it is (and can split one deduction): **ours** (our tax credit), **ours but the creator's money** (an on-hold payable to the creator, released when the credit shows in our 26AS/AIS), or **the creator's** (deducted under their PAN: their payable is reduced and we deposit nothing). **Finance → TDS** tracks each credit by financial year and quarter (waiting for 26AS → in 26AS/AIS → claimed, or not received), with Form 16A numbers, and lists the TDS we deducted from payouts and whether it was deposited. The dashboard reminds you to check 26AS once the brand's quarterly TDS return was due, and flags credits marked as missing. TDS is never cash. |
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
- **Manual ChatGPT analysis** — see below. No API key; nothing is sent to OpenAI by the website.
- **Not connected:** email/WhatsApp sending, bank feeds, YouTube API, payment gateways. Manual workflows: copy links or use the mail button; import bank statements as CSV (duplicates skipped); enter YouTube/other platforms weekly by hand or CSV; record payments manually with a reference.

## Roster & brand media kits

The roster shows each creator's photo, categories, Instagram and YouTube links with followers/subscribers, **previous average views**, engagement and commercials. Hover any figure for its source and date.

- **Previous average views** = mean of the latest 10 posts recorded for that channel, excluding posts marked as boosted, once at least 3 exist; otherwise the profile figure with its source and date. Engagement uses the same posts' reach, and only posts with likes, comments, shares and saves all recorded. Followers come from the newest weekly snapshot if it is more recent than the profile entry. Nothing is estimated: missing figures show as unavailable.
- **Commercials** use each rate-card line's *brand price* (or the rate card if none is set). Negotiated rates and commissions stay internal.
- **Photos**: upload on the creator page (talent managers and founders). The browser crops it square and shrinks it to 400px; the server checks the image, strips location/device (EXIF) data and refuses damaged files, so kits stay small and safe to send.
- **Add creators from links** (roster) / **Fill profile with ChatGPT** (creator page): paste Instagram/YouTube profile links; the Manual ChatGPT workflow returns name, handle, city, languages, categories, a public business email, every channel with followers, and the last 12 posts/videos with views. ChatGPT reads the public page, a connector you authorised in ChatGPT, or screenshots you upload when Instagram blocks it — and marks anything it could not read. You review field by field before saving: new creators are added; existing ones are matched only by exact handle or link (otherwise you choose); videos are saved so previous average views fill in; everything is undoable.
- **Media kit** (roster page or creator page): the whole roster grouped by category, one category, a separate kit for every category, or a single creator. Each kit has an at-a-glance table and a profile per creator (photo, links, followers, previous average views, median views, engagement, audience, commercials, brands worked with, top content), with the source of every figure. Kits never include commissions, negotiated rates, identity or contact details, conflicts or internal notes. Agency contact details and the note printed on kits are set in **Settings → Agency & media kit**.

## Manual ChatGPT analysis

Use your own ChatGPT subscription without an API integration. **Analyse with ChatGPT** appears on the overview, roster, creator, campaign, brand, deal, finance, editor, content-task and analytics pages, and under **ChatGPT analysis** in the sidebar.

1. **Choose** the workflow — influencer growth, campaign performance, finance summary & cash-flow scenarios, brand proposal & shortlist, editor workload, founder review, scripts/briefs/action plans — plus records, period and questions.
2. **Export.** Socialmog HQ builds a JSON context package (export ID, schema version, record references like `influencers:12`, handles and profile links, period and timezone, INR and metric definitions, budgets, deliverables, targets, previous results, sources and timestamps, missing-data notes, record versions and the exact response JSON Schema) and a ready-to-copy prompt. Passwords, tokens, bank/identity details and internal notes are never included; finance packages are finance-role only.
3. **Instagram via a connector in ChatGPT** (Windsor.ai or any provider you authorised there): the prompt asks ChatGPT to match accounts by the exported username/profile link, keep Socialmog IDs, report source, retrieval time, period, units and status per account, use null for anything unavailable, and fall back to a manual export instead of guessing. Connecting a provider in ChatGPT does not connect it to Socialmog HQ.
4. **Import** the JSON (paste or upload). It is validated against the schema with readable errors; Markdown fences are tolerated and noted. The preview lists affected records, records changed since export, and field-by-field current vs proposed values. Nothing is matched by guesswork: missing or unknown IDs must be chosen by you before those items can be applied.
5. **Apply** the items you tick, all-or-nothing: connector metrics become weekly snapshots labelled as user-imported connector data with provenance (existing values are kept unless you pick the imported one; previous versions are retained), the analysis is stored separately from source metrics, tasks are created with the owner/priority/deadline you set, and allowed field changes are applied with the normal validation and permissions. Bank transactions, amounts, payment status and commitments are never changed by an import; finance-planning fields (expected date, confidence, priority, notes) need an explicit confirmation. The same export/result ID cannot be imported twice. Every apply is audited and can be **undone** (values restored, created records archived, history kept).
6. **Use it**: pin recommendations to the founder dashboard, see analyses on creator and campaign pages, and generate PDFs. Reports put ChatGPT text in a separate box labelled *not calculated by Socialmog HQ*; external reports only use analyses you marked shareable.

Each Monday (with the weekly analysis schedule) a package for last week is prepared automatically with an in-app reminder; it shows as done only after a valid result has been applied. Turn this off in **Settings → Automation**.

## Automation

The in-process scheduler (every 30s) runs: the weekly ChatGPT package, weekly analysis at the configured day/time (default Monday 09:00 IST, for the week just ended; one run per week via unique job keys, up to 3 attempts, founder notified on failure), daily in-app reminders, daily backups (14 kept), and scheduled report templates. **Settings → Automation** shows job history with retry.

## Reports

**Reports** generates branded, searchable PDFs (with CSV) in the background: finance, founder, campaign, influencer growth, brand statement, creator statement, editor payment summary, editor workload, expenses, asset register, deal pipeline, brand media kit. Campaign and influencer growth reports can cover several records (one section each). Imported ChatGPT commentary can be added as its own labelled section. Choose period, records and sections; internal and external templates are separate (external hides commissions, margins, private notes). Each run is archived with a data snapshot and version, and permission is re-checked on download.

## Code map

```
src/shared/   schema.ts (entities → DB, validation, forms, permissions) · money.ts · dates.ts · charts.ts (SVG for web + PDF) · calc.ts
src/server/   index.ts · app.ts (auth, CRUD, search, files, admin) · db.ts · finance.ts + finance-routes.ts · forecast.ts (pure engine)
              domain.ts (hooks, deal→campaign, shortlist, health, dashboard) · analytics.ts (weekly analysis, Instagram, OpenAI)
              reports.ts (PDF centre) · chatgpt.ts (manual ChatGPT export/import) · portal.ts · jobs.ts · seed.ts
src/web/      main.tsx (shell, routes) · lib.tsx (API client, DataTable, forms, kanban, calendar, charts) · pages/*
tests/        node:test suites
```

Deliberate simplifications (each marked `ponytail:` in code): migrations are additive only; list endpoints return up to 10,000 rows and filter/sort/paginate in the browser; jobs run in-process. Upgrade paths are noted next to each.
