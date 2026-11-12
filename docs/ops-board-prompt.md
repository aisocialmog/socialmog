# Paste this into the Ops Board project

Replace `https://YOUR-PROJECT.supabase.co` with your Supabase project URL and `https://ops.yourdomain.com` with the Ops Board's own address (the same one you enter in Social Mog OS → Settings → Integrations → "Allowed website").

---

Connect this Ops Board to our Social Mog OS API. The API docs are below. Store the API key server-side only: in an environment variable on the Ops Board's server, called by server routes, never in browser code, never in the repo. The browser talks only to the Ops Board's own server routes, and those call Social Mog OS.

Show:
1. Each founder's live status, with how long they've been in it ("In a meeting · 42 min"). Update it instantly (see Realtime).
2. Today's work: tasks (overdue ones marked), shoots, deadlines and go-lives.
3. Active andon alerts: title, reason, who raised it, who can unblock, minutes open. Make them prominent, with a glowing lantern.
4. A range switcher (This week, Last week, This month, Last month, Custom with two date pickers) for the summary numbers: revenue, profit, cash received, expenses, content posted, campaigns live, and per founder: tasks done, hours worked, break time.
5. The latest activity feed.
6. Let each founder change their own status from here (Working, Focus, In a shoot, In a meeting, On break, Off for the day, Blocked, with an optional message and expected-back time). This writes back through `POST /status`.

Auto-away: Social Mog OS sets a founder to Away after 30 minutes with no activity in either app. So while a founder is actively using the Ops Board, send `POST /status` with their current status at most once every 4 minutes as a heartbeat. If they come back while their status is "away", send `working`. Do not send heartbeats from background or hidden tabs.

Style: Japanese, Fuji at sunset. Background warm ink-black `#1E1C1A`, accent persimmon `#E3793A`, alert madder red `#B7282E`, text cream `#F2E8D5`. Headings in Shippori Mincho; body in Zen Kaku Gothic New. Muted text `#8F877F`; highlight `#F2A93B`. Calm, quiet, generous spacing. Never rely on colour alone (use text and icons too). Keep WCAG AA contrast and make it work on a phone.

## API document

**Base URL:** `https://YOUR-PROJECT.supabase.co/functions/v1/ops`

**Auth:** send the key in an `x-api-key` header (or `Authorization: Bearer …`). Server-side only.

**Limits:** 60 requests a minute per key. Over that you get `429` with `Retry-After: 60`. Every response carries `X-RateLimit-Remaining`. Poll sparingly (the summary every 60 s at most; presence/today/andons are refreshed by Realtime pings instead).

**Errors:** JSON `{ "error": "…" }` with status 400 (bad input), 401 (bad or revoked key), 403 (origin not allowed), 404, 429.

**Times** are UTC ISO-8601. "Today" and all dates are India time (IST). Money is in rupees, totals only.

### GET /presence
Current status of each founder.
```
curl $BASE/presence -H "x-api-key: $OPS_KEY"
```
```json
[{ "member_id": "…", "name": "Asha", "status": "focus", "message": "Edit Diwali reel", "since": "2026-11-11T09:02:11Z", "expected_back": "2026-11-11T09:52:11Z" }]
```
`status` is one of: `working` · `focus` · `in_shoot` · `in_meeting` · `on_break` · `off` · `blocked` · `away`.

### GET /today
```json
{ "date": "2026-11-11",
  "tasks": [{ "title": "Call Rohan", "status": "todo", "priority": "high", "due_time": "16:00:00", "overdue": false, "assignees": ["Asha"] }],
  "shoots": [{ "title": "Winter menu", "brand": "Chai Sutra", "call_time": "10:00:00", "location": "Studio 4", "status": "confirmed" }],
  "deadlines": [{ "title": "Diwali Reel", "brand": "Chai Sutra", "stage": "client_review", "kind": "go_live" }],
  "andons": [{ "title": "Edit Diwali reel v2", "reason": "Footage link is dead", "raised_by": "Farid", "waiting_on": "Asha", "raised_at": "…", "minutes_open": 42 }] }
```

### GET /summary?range=this_week
`range` = `this_week` · `last_week` · `this_month` · `last_month` · `custom` (with `from=` and `to=` as YYYY-MM-DD, at most a year apart).
```
curl "$BASE/summary?range=custom&from=2026-11-01&to=2026-11-10" -H "x-api-key: $OPS_KEY"
```
```json
{ "range": "custom", "from": "2026-11-01", "to": "2026-11-10",
  "revenue": 482000, "profit": 214000, "cash_received": 356000, "expenses": 244000,
  "content_posted": 14, "campaigns_live": 3,
  "founders": [{ "member_id": "…", "name": "Asha", "tasks_done": 9, "hours_worked": 31.5, "break_hours": 4.0 }] }
```

### GET /activity?limit=20
The latest activity in plain language (limit 1–100). Payouts, capital and payment details never appear.
```json
[{ "at": "2026-11-11T08:44:00Z", "who": "Asha", "text": "Asha moved “Diwali Reel” to Client Review", "record_type": "deliverables" },
 { "at": "2026-11-11T08:30:00Z", "who": "Dev", "text": "Dev recorded ₹15,000 payment from Chai Sutra", "record_type": "receipts" }]
```

### POST /status
The only write. Sets one founder's own status and message.
`founder` is their email or `member_id`; `status` is one of `working` · `focus` · `in_shoot` · `in_meeting` · `on_break` · `off` · `blocked` (`away` is set automatically); `message` and `expected_back` (ISO time) are optional.
```
curl -X POST $BASE/status -H "x-api-key: $OPS_KEY" -H "Content-Type: application/json" \
  -d '{ "founder": "asha@socialmog.in", "status": "in_meeting", "message": "Client call", "expected_back": "2026-11-11T11:30:00Z" }'
```
Returns the founder's presence object (same shape as `/presence`). The Ops Board must only let a signed-in founder change their own status.

### Webhooks (optional)
Social Mog OS POSTs JSON to the Ops Board's webhook URL for `status.changed`, `andon.raised`, `andon.resolved`, `invoice.paid`, `campaign.completed`. Verify `X-SocialMog-Signature`: the hex HMAC-SHA256 of the raw request body using the shared webhook secret (store it server-side). Reject anything that doesn't match.
```
POST <webhook URL>
X-SocialMog-Event: andon.raised
X-SocialMog-Signature: 9f2c…

{ "event": "andon.raised", "sent_at": "2026-11-11T08:51:03Z",
  "data": { "id": "…", "title": "Edit Diwali reel v2", "reason": "Footage link is dead", "raised_by": "Farid" } }
```

### Realtime (instant updates, no refreshing)
Subscribe in the browser to the public Realtime channel `ops-board` using the project's public anon key (this is the only thing the browser ever talks to Social Mog OS about). It broadcasts a `changed` message with no data whenever presence, an andon or the activity feed changes. On each message, ask the Ops Board's own server to re-fetch the relevant endpoint (presence / today / activity).
```js
const supabase = createClient("https://YOUR-PROJECT.supabase.co", ANON_KEY)
supabase.channel("ops-board")
  .on("broadcast", { event: "changed" }, ({ payload }) => refresh(payload.event))  // "status.changed" | "andon.raised" | "andon.resolved" | "activity" …
  .subscribe()
```
Also re-fetch every 60 seconds as a fallback if the channel drops.
