# Social Mog OS

Internal database and management site for **Social Mog**, an influencer production and campaign agency in India.
It keeps brands, creators, campaigns, production, tasks and money in one place, and calculates every total from the records.

**Status:** features 1 (login, roles, layout, activity log), 2 (Brands), 3 (Creators), 4 (Campaigns) and 5 (Production & calendar) are built. The database schema for every later feature is already in place.

![Dashboard shell](docs/preview/dashboard-founder.png)

## Rules every feature follows

| Area | Rule |
|---|---|
| Stack | Supabase (Postgres, Auth, Storage, Edge Functions) + React/Vite/TypeScript/Tailwind |
| Tables | Real tables with foreign keys, not JSON blobs. Every table has `id uuid`, `created_at`, `updated_at` and `created_by`. Business records have `is_archived`/`archived_at` and are never hard-deleted. |
| Security | RLS is on for every table (the migration fails if one is missing). Roles are enforced in the database (see below), not only by hiding buttons. |
| Activity | Every table goes through `enable_standard_table()`, which adds the audit fields, the `activity_log` trigger (who, what, which record, old/new values) and RLS. An event trigger runs it automatically for any new table, and it refuses a table that is missing the standard columns. |
| Secrets | Only the public anon key is in the frontend. Service-role and AI keys live in Edge Function secrets. |
| Money | `numeric(14,2)`, INR. Shown as ₹1,00,000. Totals, balances, profit and outstanding amounts come from views and are never typed in. |
| Dates | DD MMM YYYY, Asia/Kolkata. The financial year runs 1 Apr – 31 Mar. Weeks run Monday–Sunday. |
| Lists | Search, filters, sort and CSV export on every list page |
| Records | Every record has a detail page with its linked records and activity history |

## Roles (enforced by RLS in `supabase/migrations/…_security_triggers.sql`)

| Role | Sees | Can't see |
|---|---|---|
| Founder | Everything | — |
| Manager | Everything, including money and salaries | Capital entries (opening balance, founder money in/out), team management, API keys, backups. Account balances are shown as totals only. |
| Team member | Their own tasks; campaigns they're on (`campaign_members`) and those deliverables; the brands and creators linked to them | Any money table, other people's tasks, Brands/Creators/Money/Reports pages |
| Freelancer | Deliverables, tasks and shoots assigned to them, plus the brand those belong to | Campaigns, money, everyone else's work |

Money that sits on work records lives in separate tables (`campaign_finances`, `campaign_creator_fees`, `deliverable_fees`), so team members and freelancers can see the work without seeing any amounts.

## Database (`supabase/migrations`)

```
team_members ─┬─ user_preferences       org_settings (1 row) · document_sequences
              ├─ campaign_members       import_batches ─ import_rows
              └─ (created_by on every table)    team_directory (view: names only)

brands ─┬─ brand_contacts
        ├─ brand_tags ─ tags ─ creator_tags ─┐
        ├─ retainers ─ retainer_scope_items  │
        └─ campaigns ─┬─ campaign_creators ──┤── creators ─┬─ creator_platforms ─ creator_metric_snapshots
                      │                      │             ├─ creator_rate_cards
                      │                      │             └─ creator_payment_details (founders only)
                      └─ deliverables ───────┘  (brand required; campaign/retainer optional)
                           ├─ scripts ─ ai_requests
                           ├─ deliverable_reviews · deliverable_metrics
                           └─ shoot_deliverables ─ shoots ─ shoot_crew (team / vendor / creator)
calendar_events            vendors (freelancers, studios, software)

money_accounts ─┬─ receipts ─ receipt_allocations ─ invoices ─ invoice_items
                ├─ expenses ─ expense_categories
                ├─ creator_payouts ─ creator_payout_items
                ├─ capital_entries (opening balance, founder in/out, loans)
                └─ account_transfers
targets

tasks · comments · files · notifications · automation_rules · reminders
ai_prompt_templates · ai_requests · api_clients · api_request_log · webhook_subscriptions
backups · saved_views · activity_log
```

**Calculated views:** `invoice_totals` (GST, paid, outstanding, overdue status), `creator_payout_totals` (gross, TDS, net), `money_ledger`, `campaign_financials` (profit, margin), `brand_financials`.
**Functions:** `account_balances()`, `period_summary(period)`, `period_bounds()`, `fy_start()`, `fy_label()`, `global_search(q)`, `schema_rule_violations()`.
The periods are `this_week`, `last_week`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_fy`, `last_fy` and `custom`.

## Brands (feature 2)

- **List:** table and card views, plus a pipeline board (`/brands?view=pipeline`) where you drag cards between Lead → Pitching → Active → Paused → Ended. The list filters by status, engagement type and owner, and exports to CSV.
- **Brand detail:** tabs for Overview, Contacts, Campaigns, Production, Invoices & Payments (founders and managers only), Files and Activity.
- **Calculated figures:** lifetime revenue, outstanding and active campaigns come from the `brand_overview` view. Revenue and outstanding read ₹0 until Money (feature 6) creates invoices.
- **Renewal warning:** a retainer renewing within 15 days, or already past its renewal date, gets a red lantern warning on the list, the cards, the pipeline and the detail page.
- **Files and logos:** stored in the private `records` bucket under `brands/<brand id>/`.

### Sample brands
- **Add them:** paste `supabase/samples/sample_brands.sql` into Supabase → SQL Editor and run it. This adds Chai Sutra (sample), an active brand with a retainer renewing in 10 days, and Neelam Naturals (sample), a pitching brand.
- **Remove them:** run `supabase/samples/remove_sample_brands.sql` the same way. It deletes only the two samples, their contacts, retainer, files and history. It refuses to run if you've attached real campaigns, tasks or invoices to a sample brand; archive that brand in the app instead. If you uploaded files to a sample brand, also delete its folder under `records/brands/` in Storage.

## Creators (feature 3)

- **List:** table or card view. Filters cover niche, city, language, tier, platform, follower range, rate range (per deliverable type), minimum rating and blacklisted. Any filter combination can be saved as a named view, either private or shared with the team.
- **Tier:** calculated from the biggest platform with `creator_tier()`: Nano under 10K, Micro 10K–100K, Mid 100K–500K, Macro 500K–1M, Mega 1M+.
- **Platform stats:** each update stamps the date and keeps a snapshot in `creator_metric_snapshots`, which feeds the growth line on each platform card. Stats older than 90 days get a flag.
- **Rate card:** one current price per deliverable type. Changing a price keeps the old one with an end date (`set_creator_rate()`).
- **Payment details:** UPI, bank, PAN and IFSC are **founders only**, enforced by RLS and marked sensitive. The activity log stores only the last 4 characters of each.
- **Shortlists:** select creators in the list, then "Add to shortlist". These are stored in the `shortlists` and `shortlist_creators` tables, and get linked to campaigns in feature 4.
- **Import:** `/creators/import`. Upload a CSV, match its columns, then review it. Duplicates are detected by phone number (last 10 digits) or platform handle, both against the database and within the file. The import is all-or-nothing through `import_creators()`, and is recorded in `import_batches` and `import_rows`.

### Sample creators
- **Add them:** run `supabase/samples/sample_creators.sql` in Supabase → SQL Editor. This adds 5 creators, one in each tier from Nano to Mega. One is blacklisted, and two are in Ranchi.
- **Remove them:** run `supabase/samples/remove_sample_creators.sql`. It refuses to run if a sample creator has since been put on a campaign or payout.

## Campaigns (feature 4)

- **List and board:** a list view and a board with columns Planning → Creator outreach → Shoot/production → Content review → Live → Reporting → Completed / Cancelled. You drag campaigns between columns to change status, as on the brand pipeline (both use the shared `Kanban` component).
- **Campaign detail:** tabs for Overview, Brief (with promo codes), Creators, Deliverables, Performance, Money (founders and managers only), Files and Activity.
  - **Creators tab:** status and fee are edited inline. "Plan deliverables" (e.g. 2 Reels + 3 Stories) creates or cancels the matching tracker rows through `set_creator_deliverables()`.
  - **Deliverables tab:** draft link, brand approval (shows the 承 seal), live link, go-live date, and "Mark posted", which won't work without the live link. A red lantern warning shows when a go-live date has passed and the post isn't marked Posted.
- **Calculated numbers** in `campaign_summary` and `deliverable_performance`:
  - Expected margin = client budget − planned creator spend − planned production spend.
  - Actual creator spend = the fees of creators who are Confirmed or further along.
  - Profit = client billing − creator payouts − production expenses linked to the campaign.
  - Engagement rate = (likes + comments + shares + saves) ÷ views.
  - Cost per view = cost ÷ views.
- **Report page** (`/campaigns/<id>/report`): "Download PDF report" opens the browser's Save-as-PDF on an A4 sheet. It shows the logos, results, charts, top posts and a per-creator table. Margin, profit and creator fees appear only in the on-screen internal panel and are never printed. The cost per view in the PDF uses the brand's own investment. See `docs/preview/campaign-report-sample.pdf`.

### Sample campaign
- **Add it:** run `supabase/samples/sample_campaign.sql`, after the sample brands and creators scripts.
- **Remove it:** run `supabase/samples/remove_sample_campaign.sql` before removing the sample brands or creators.

## Production & content calendar (feature 5)

- **One record for both:** a production item is a deliverable (brand required, campaign optional), so a campaign deliverable and its production work are the same record.
- **Stages:** Idea → Script → Script approved → Pre-production → Shoot scheduled → Shot → Editing → Internal review → Client review → Revisions → Approved → Scheduled → Posted.
  - Every move is written to the activity log with its time.
  - `production_stage_durations` and `production_stage_turnaround` turn that log into time per stage and average days per stage (e.g. edit turnaround).
- **Flags:**
  - An item stuck in one stage for more than 3 days is flagged; the 3 is `org_settings.stuck_after_days`.
  - Items past their target post date are flagged.
  - When revision rounds go over the limit (`brands.revision_limit`, or the item's own limit), an "over the limit — bill the extra rounds" warning shows.
- **People:** scriptwriter, talent, shooter and editor, each a team member, freelancer, vendor or creator. Team members and freelancers named on an item can see it and find it in **My work**.
- **Script:** rich text with every version kept, and comments on each version, marked as from the team or the client.
- **Files:** links for raw footage, final file, thumbnail and live post, plus numbered edit versions. The newest edit also becomes the campaign tracker's draft link.
- **Shoot:** date, time, location, equipment list and call sheet notes.
- **Content calendar** (`/calendar`): month and week views, colour-coded by brand. Each brand keeps a fixed colour slot from creation (`brands.calendar_color`). Drag a post or shoot with the mouse to reschedule it.
- **Client calendar link:** "Share with client" creates a read-only link, `/share/calendar/<token>`. Only a SHA-256 of the token is stored, and the link can expire or be turned off. The public function returns titles, formats, dates, a simple status and live links — never money, briefs, notes, people or locations.

## Money (feature 6)

Founders see everything. Managers see invoices, payments, expenses, payouts and account balances — never capital entries or founder withdrawals (RLS: `capital_entries` is founder-only; `capital_accounts()` and `balance_check()` refuse non-founders).

- **Accounts:** bank / UPI / cash / wallet, each with an opening balance and date. Balance = opening + money in − money out (`account_balances()`, `account_statement()`). Only founders set opening balances.
- **Invoices:**
  - Numbered `SM/26-27/001` when sent, restarting each financial year of the invoice date. Drafts have no number, so there are no gaps; cancelled invoices keep theirs.
  - GST on/off with a rate (default 18%): CGST + SGST when the brand's GST state matches ours (`org_settings.state_code`), otherwise IGST. TDS expected % shows "net payable".
  - Status is calculated: Draft, Sent, Partly paid, Paid, Overdue (past due date), Cancelled.
  - The detail page is the invoice itself; **PDF** prints only the paper, with logo, GSTINs, bank details, amount in words and a UPI QR for the amount still due.
  - Retainers: one click creates this month's draft from the retainer (on the Money overview and the brand's Invoices tab); one per brand-month.
- **Payments:** one payment can settle several invoices (`record_payment()`), with the TDS the brand kept. Anything not applied stays as an advance. "Other income" has no invoice.
- **Expenses:** your category list (editable in Money → Settings; each counts as a direct cost, an overhead, or a GST / TDS payment), paid-from account, links to brand / campaign / production item, bill photo, GST input. Recurring expenses create themselves each month (pg_cron daily at 06:00 IST where available, and whenever the Expenses page opens).
- **Payouts:** for a creator (via the campaign) or a freelancer/vendor (often a production item). Pending → Approved → Paid; TDS % and net payable are calculated. Paying one creates its expense automatically; un-paying or cancelling archives it. **Payouts due** groups what's owed by person, with UPI IDs for founders.
- **Capital:** Opening capital, Capital added, Founder withdrawal, Profit transferred, per founder or "Company" (split by `team_members.profit_share_pct`, 50:50 to start).
- **Balance check:** capital + retained profit must equal money in accounts + owed to us (unpaid invoices, TDS clients deducted) − what we owe (payouts, unpaid expenses, unapplied advances, GST payable, TDS to deposit). A difference is shown as a likely missing entry.
- **Overview & reports:** revenue invoiced, cash received, expenses, creator payouts, gross and net profit (invoice basis by default, payments basis on a toggle), receivables ageing 0–30 / 31–60 / 60+ days since the invoice date, payouts pending, balances, capital per founder; profit by brand and by campaign; GST by month and an invoice-wise GST list; TDS by month and line by line — all with CSV export.
- **Rules:**
  - Totals come from views (`invoice_totals`, `payment_list`, `expense_list`, `payout_list`, `pnl_lines`, `money_overview()` …). Amounts on lines are generated columns.
  - Editing or archiving a sent invoice, payment, expense, payout, capital entry or account balance needs a reason. Send it as `change_reason` with the update; the database refuses the change without one and writes it to `activity_log.reason`. Drafts and normal steps (send, approve, pay, mark paid) don't need one.
  - Money rows can't be hard-deleted, even by the database owner. The sample-removal scripts are the one exception, using `app.allow_money_delete`.
- `src/lib/money.ts` repeats the same sums for the preview; `tests/money.test.ts` runs the SQL test's scenario through it and expects the same numbers.

## Opening balances & import (feature 7)

Founders only. A one-time wizard at **Settings → Opening balances & import** (`/settings/opening`) brings the books in as they stand on go-live. Migration: `supabase/migrations/20261115000100_opening_balances.sql`.

- **Step 1, go-live date:** saved as `org_settings.go_live_date`. Everything before it is history; from it onwards is tracked in detail.
- **Step 2, opening capital:** each founder's share of profit made before go-live, plus the money they put in personally. Saved as `capital_entries` of kind Opening capital (`opening_part`: `accumulated_profit` / `founder_money` / `adjustment`), dated the day before go-live. It is capital, never revenue or profit.
- **Step 3, account balances:** each account's actual balance on go-live day, saved as `money_accounts.opening_balance`. The check: account balances + money owed to us − money we owe must equal opening capital. A difference is shown and can be closed with an **Opening adjustment** entry, which needs a note and may be negative.
- **Step 4, open items:**
  - **Invoices** unpaid from before go-live (`invoices.is_opening`) keep their original number. The amount still owed is entered as one figure, with no GST added. Collecting them reduces receivables and is never revenue on either basis.
  - **Creator and freelancer dues** still unpaid (`creator_payouts.is_opening`). Paying them is never a cost of the new period.
- **Step 5, history import (CSV, with column mapping):** old brands, creators (through the existing creator importer), past campaigns and who was on each. Past campaigns are flagged `campaigns.is_historical`, and their money sits only in the campaign's budget figures. Brand and creator pages show them as historical figures; no money report includes them.
- **Finish:**
  - **Lock** with `opening_lock()`, which refuses while the check is ₹1 or more apart.
  - The summary from `opening_state()` shows capital per founder, account balances, receivables and payables.
  - **Re-opening** needs a founder's password. The app signs in again, and `opening_unlock()` only accepts a login that used a password in the last 10 minutes. Founders who only use Google must set a password first.

## Setting it up

1. **Founders:** put both founder names and emails in `supabase/migrations/20261109000800_seed_founders.sql`. The push stops with an error while the placeholders are still there.
2. **Push the schema:** `supabase link --project-ref <ref>`, then `supabase db push`.
3. **Auth settings** (Supabase dashboard → Authentication):
   - Turn off *Allow new users to sign up*.
   - Set *Site URL* to your app's address, and add `<site>/auth/callback` and `<site>/reset-password` as redirect URLs.
   - Enable the **Google** provider with your Google OAuth client ID and secret. In Google Cloud, the authorised redirect URI is `https://<ref>.supabase.co/auth/v1/callback`.
4. **Invite function:**
   - `supabase functions deploy invite-member`
   - `supabase secrets set APP_ORIGIN=https://<your-site>`

   The service-role key is provided to the function automatically; it never goes in the app.
5. **First logins:** invite both founder emails once from the dashboard (Authentication → Users → Invite user). Their logins link to the seeded rows. From then on, founders invite everyone from **Settings → Team**.
6. **Money settings:** in the app, Money → Settings — our GST state, GSTIN (or leave blank), legal name, address, bank details, UPI ID and logo. Add each account's opening balance and the matching opening capital so the balance check is green.
7. **Opening balances:** run the wizard once (Settings → Opening balances & import) before entering day-to-day records.
8. **Frontend:** `cp .env.example .env.local`, then add the project URL and anon key.

```bash
npm install
npm run dev                  # http://localhost:5173
npm test                     # ₹ format, IST dates, FY periods, CSV, role → page map, tab bar
npm run check:contrast       # WCAG AA check of every colour pair
npm run test:db              # migrations + role/RLS, brands, creators, campaigns, production and money checks
```

Without Supabase settings, `npm run dev` shows a local-only design preview on the login page, so you can look around as each role. That preview is never included in a production build.

## Design system

The colour tokens are in `tailwind.config.js` and `src/styles/index.css`.
The original SVG artwork is in `src/components/art`: Fuji with a sky that follows IST time, the seasonal effects, ensō, hanko seals, brush dividers, the andon lantern, and the seigaiha, asanoha and torii patterns.
Screenshots are in `docs/preview`.
