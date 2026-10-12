/**
 * Illustrative demo data. Every row is flagged is_demo = 1 and the UI shows a DEMO banner.
 * Money movements go through the real finance functions so balances stay consistent.
 * Settings → Remove demo data deletes all of it.
 */
import { addDays, weekStart } from '../shared/dates.ts';
import { ENTITIES } from '../shared/schema.ts';
import { all, get, HttpError, insert, run, setSetting, tx, type Db, type Row, type User } from './db.ts';
import { hashPassword } from './app.ts';
import { afterWrite, convertDeal } from './domain.ts';
import { createEarmark, importTransactions, recordTransaction, recordTransfer, today } from './finance.ts';

const L = (rupees: number) => Math.round(rupees * 100);
export const DEMO_PASSWORD = 'demo-password-2026';

export function seedDemo(db: Db): void {
  const T = today(db);
  const d = (n: number) => addDays(T, n);
  const founderRow = get(db, `SELECT * FROM users WHERE role = 'founder' ORDER BY id LIMIT 1`)!;
  const F: User = { id: founderRow.id, name: founderRow.name, email: founderRow.email, role: 'founder', editor_id: null, influencer_id: null, brand_id: null };
  const ins = (table: string, v: Row) => insert(db, table, { ...v, is_demo: 1, created_by: F.id });
  const at = (n: number, hour = 11) => `${d(n)}T${String(hour - 5).padStart(2, '0')}:30:00.000Z`;

  tx(db, () => {
    // ---- people
    const pw = hashPassword(DEMO_PASSWORD);
    const user = (name: string, email: string, role: string, extra: Row = {}) => ins('users', { name, email, role, status: 'active', password_hash: pw, ...extra });
    const meera = user('Meera Joshi', 'meera@demo.socialmog.in', 'finance', { title: 'Finance lead' });
    const aditya = user('Aditya Rao', 'aditya@demo.socialmog.in', 'campaign_manager', { title: 'Campaign manager' });
    const sana = user('Sana Qureshi', 'sana@demo.socialmog.in', 'talent_manager', { title: 'Talent manager' });

    const editor = (name: string, skills: string[], rate: number, extra: Row = {}) => ins('editors', { name, skills, rate: L(rate), rate_type: 'per_video', availability: 'available', capacity_per_week: 5, location: 'Mumbai', ...extra });
    const ishaan = editor('Ishaan Verma', ['reels', 'motion graphics', 'subtitles'], 6000, { extra_revision_rate: L(1500), portfolio_url: 'https://example.com/demo/ishaan' });
    const pooja = editor('Pooja Nair', ['youtube long-form', 'colour grading'], 15000, { capacity_per_week: 3, location: 'Bengaluru' });
    const farhan = editor('Farhan Ali', ['shorts', 'subtitles', 'thumbnails'], 4000, { availability: 'busy', location: 'Delhi' });
    user('Ishaan Verma', 'ishaan@demo.socialmog.in', 'editor', { editor_id: ishaan });

    const P = (platform: string, handle: string, followers: number | null, avg: number | null, med: number | null, er: number | null, updatedDaysAgo = 3) => ({
      platform, handle, url: platform === 'youtube' ? `https://www.youtube.com/@${handle.replace('@', '')}` : `https://www.instagram.com/${handle.replace('@', '')}/`,
      followers, avg_views: avg, median_views: med, engagement_rate: er, source: 'Manual entry (demo)', updated_at: d(-updatedDaysAgo),
    });
    const inf = (v: Row) => ins('influencers', { renewal_reminder_days: 30, availability: 'available', commission_type: 'percentage', ...v });
    const riya = inf({ name: 'Riya Sharma', handle: '@riyaglows', city: 'Mumbai', state: 'Maharashtra', niches: ['beauty', 'skincare'], languages: ['Hindi', 'English'], relationship: 'exclusive', manager_id: sana, agreement_start: d(-340), agreement_end: d(20), commission_rate: 2000, email: 'riya@example.com', platforms: [P('instagram', '@riyaglows', 420000, 110000, 85000, 4.1)], audience: { summary: '78% women, 18–34', top_cities: ['Mumbai', 'Pune', 'Delhi'], source: 'Instagram insights screenshot (demo)', as_of: d(-20) }, rate_card: [{ deliverable: 'reel', platform: 'instagram', rate: L(45000), negotiated_rate: L(40000) }, { deliverable: 'story', platform: 'instagram', rate: L(12000) }], unsuitable_categories: ['alcohol', 'tobacco'], conflicts: 'Exclusive skincare tie-up with Glow Co until year end', tags: ['top-performer'] });
    const kabirC = inf({ name: 'Kabir Mehta', handle: '@kabircooks', city: 'Delhi', niches: ['food'], languages: ['Hindi'], relationship: 'non_exclusive', manager_id: sana, commission_rate: 1500, platforms: [P('instagram', '@kabircooks', 210000, 64000, 51000, 3.2), P('youtube', '@kabircooks', 85000, 22000, 18000, null, 9)], rate_card: [{ deliverable: 'reel', platform: 'instagram', rate: L(30000) }, { deliverable: 'youtube_video', platform: 'youtube', rate: L(55000) }], unsuitable_categories: ['alcohol'] });
    const ananya = inf({ name: 'Ananya Iyer', handle: '@ananya.fits', city: 'Bengaluru', niches: ['fitness', 'wellness'], languages: ['English', 'Kannada'], relationship: 'exclusive', manager_id: sana, agreement_start: d(-200), agreement_end: d(165), commission_rate: 2000, platforms: [P('instagram', '@ananya.fits', 315000, 98000, 76000, 5.0)], rate_card: [{ deliverable: 'reel', platform: 'instagram', rate: L(90000) }] });
    const arjun = inf({ name: 'Arjun Nair', handle: '@techwitharjun', city: 'Kochi', niches: ['tech', 'gadgets'], languages: ['English', 'Malayalam'], relationship: 'campaign_only', manager_id: sana, commission_type: 'fixed', commission_fixed: L(15000), platforms: [P('youtube', '@techwitharjun', 340000, 120000, 95000, null), P('instagram', '@techwitharjun', 88000, 30000, null, 2.4, 12)], rate_card: [{ deliverable: 'youtube_video', platform: 'youtube', rate: L(120000) }] });
    const zoya = inf({ name: 'Zoya Khan', handle: '@zoyastyles', city: 'Hyderabad', niches: ['fashion', 'beauty'], languages: ['Hindi', 'Urdu', 'English'], relationship: 'exclusive', manager_id: sana, agreement_start: d(-90), agreement_end: d(275), commission_rate: 2000, platforms: [P('instagram', '@zoyastyles', 265000, 70000, 58000, 3.8)], rate_card: [{ deliverable: 'reel', platform: 'instagram', rate: L(25000) }] });
    const dev = inf({ name: 'Dev Patel', handle: '@devtravels', city: 'Ahmedabad', niches: ['travel'], languages: ['Gujarati', 'Hindi'], relationship: 'non_exclusive', manager_id: sana, platforms: [P('instagram', '@devtravels', 150000, 41000, null, 2.9)], rate_card: [{ deliverable: 'reel', platform: 'instagram', rate: L(50000) }] });
    const meher = inf({ name: 'Meher Kaur', handle: '@meherbakes', city: 'Chandigarh', niches: ['food', 'baking'], languages: ['Punjabi', 'Hindi'], relationship: 'prospect', availability: 'limited', availability_notes: 'Travelling until next month', platforms: [P('instagram', '@meherbakes', 92000, null, null, null, 30)] });
    const rohan = inf({ name: 'Rohan Das', handle: '@rohanfinance', city: 'Kolkata', niches: ['finance', 'personal finance'], languages: ['Bengali', 'English'], relationship: 'exclusive', manager_id: sana, agreement_start: d(-150), agreement_end: d(215), commission_rate: 2000, platforms: [P('instagram', '@rohanfinance', 180000, 52000, 44000, 3.5), P('youtube', '@rohanfinance', 120000, 40000, 33000, null)], rate_card: [{ deliverable: 'reel', platform: 'instagram', rate: L(50000) }], unsuitable_categories: ['crypto', 'betting'] });
    const sneha = inf({ name: 'Sneha Reddy', handle: '@sneha.parenting', city: 'Hyderabad', niches: ['parenting', 'family'], languages: ['Telugu', 'English'], relationship: 'non_exclusive', platforms: [P('instagram', '@sneha.parenting', 120000, 35000, 29000, 4.4)], rate_card: [{ deliverable: 'reel', platform: 'instagram', rate: L(40000) }] });
    inf({ name: 'Vikram Singh', handle: '@vikramplays', city: 'Pune', niches: ['gaming'], languages: ['Hindi'], relationship: 'inactive', availability: 'unavailable', platforms: [P('youtube', '@vikramplays', 60000, null, null, null, 120)] });
    user('Riya Sharma', 'riya@demo.socialmog.in', 'creator', { influencer_id: riya });

    // ---- brands & contacts
    const brand = (v: Row) => ins('brands', { payment_terms_days: 30, ...v });
    const glow = brand({ name: 'Glow Co', status: 'active', industry: 'Beauty & personal care', categories: ['skincare', 'beauty'], owner_id: aditya, website: 'https://example.com/demo/glowco', budget_min: L(100000), budget_max: L(500000), payment_terms: '50% advance, 50% within 30 days of go-live', billing_name: 'Glow Consumer Pvt Ltd (demo)', gstin: '27AAAAA0000A1Z5' });
    const brewbox = brand({ name: 'Brewbox Coffee', status: 'active', industry: 'Food & beverage', categories: ['coffee', 'beverages'], owner_id: aditya, payment_terms_days: 45 });
    const pocketfin = brand({ name: 'PocketFin', status: 'active', industry: 'Fintech', categories: ['fintech', 'savings'], owner_id: aditya });
    const urban = brand({ name: 'UrbanStride', status: 'active', industry: 'Footwear', categories: ['footwear', 'fitness'], owner_id: aditya });
    const nova = brand({ name: 'NovaTech', status: 'active', industry: 'Consumer electronics', categories: ['gadgets', 'electronics'], owner_id: aditya, payment_terms_days: 60 });
    const masala = brand({ name: 'Masala Junction', status: 'lead', industry: 'Restaurants', categories: ['restaurants', 'food'], owner_id: sana, follow_up_date: d(-1) });
    const nutri = brand({ name: 'NutriBox', status: 'prospect', industry: 'Health foods', categories: ['nutrition', 'fitness'], owner_id: aditya });
    const stylecart = brand({ name: 'StyleCart', status: 'inactive', industry: 'Fashion e-commerce', categories: ['fashion'] });
    ins('contacts', { brand_id: glow, name: 'Neha Kapoor', title: 'Brand manager', email: 'neha@example.com', is_primary: true });
    ins('contacts', { brand_id: brewbox, name: 'Rahul Menon', title: 'Marketing head', email: 'rahul@example.com', is_primary: true });
    ins('contacts', { brand_id: nova, name: 'Priya Sethi', title: 'Digital lead', email: 'priya@example.com', is_primary: true });
    ins('contacts', { brand_id: masala, name: 'Imran Shaikh', title: 'Owner', phone: '+91 98200 00000', is_primary: true });
    user('Neha Kapoor', 'neha@demo.socialmog.in', 'brand', { brand_id: glow });

    // ---- accounts
    const hdfc = ins('accounts', { name: 'HDFC Current', type: 'bank', institution: 'HDFC Bank', last4: '4821', opening_balance: L(400000), opening_date: d(-120), active: true });
    const icici = ins('accounts', { name: 'ICICI Savings', type: 'bank', institution: 'ICICI Bank', last4: '0937', opening_balance: L(240000), opening_date: d(-120), active: true });
    const petty = ins('accounts', { name: 'Petty cash', type: 'cash', opening_balance: L(10000), opening_date: d(-120), active: true });
    ins('accounts', { name: 'Razorpay wallet', type: 'wallet', institution: 'Razorpay', opening_balance: 0, opening_date: d(-120), active: true });

    let refNo = 1000;
    const pay = (v: Row) => {
      const id = recordTransaction(db, F, { reference: `DEMO${refNo++}`, ...v } as any);
      run(db, 'UPDATE transactions SET is_demo = 1, reconciliation = ? WHERE id = ?', v.txn_date < d(-7) ? 'reconciled' : 'unreconciled', id);
      return id;
    };
    const invoice = (v: Row) => ins('invoices', { payer_type: 'brand', confidence: 'expected', tax: 0, kind: 'brand_billing', ...v, total: v.subtotal + (v.tax ?? 0) });
    const ob = (v: Row) => ins('obligations', { status: 'committed', priority: 'normal', repeat: 'none', ...v });

    pay({ account_id: icici, txn_date: d(-115), direction: 'in', amount: L(100000), category: 'founder_contribution', description: 'Founder capital top-up', counterparty_name: 'Founder' });

    // ---- equipment
    const macTx = pay({ account_id: icici, txn_date: d(-110), direction: 'out', amount: L(150000), category: 'asset_purchase', description: 'MacBook Pro 14"', counterparty_name: 'Apple reseller' });
    ins('assets', { name: 'MacBook Pro 14"', category: 'computer', status: 'active', purchase_date: d(-110), cost: L(150000), account_id: icici, vendor: 'Apple reseller (demo)', serial_number: 'DEMO-MBP-001', custodian: 'Ishaan Verma', location: 'Studio', warranty_until: d(255), useful_life_months: 36, events: [{ date: d(-110), kind: 'purchased', transaction_id: macTx }] });
    const camTx = pay({ account_id: hdfc, txn_date: d(-70), direction: 'out', amount: L(195000), category: 'asset_purchase', description: 'Sony A7 IV body + kit lens', counterparty_name: 'Camera store' });
    const camera = ins('assets', { name: 'Sony A7 IV + 28-70mm', category: 'camera', status: 'active', purchase_date: d(-70), cost: L(195000), account_id: hdfc, vendor: 'Camera store (demo)', serial_number: 'DEMO-A7IV-77', custodian: 'Studio', location: 'Andheri studio', warranty_until: d(295), next_maintenance: d(20), useful_life_months: 48, events: [{ date: d(-70), kind: 'purchased', transaction_id: camTx }] });
    run(db, 'UPDATE transactions SET asset_id = ? WHERE id = ?', camera, camTx);
    ins('assets', { name: 'Godox SL60W lights (pair)', category: 'lighting', status: 'in_repair', purchase_date: d(-200), cost: L(22000), custodian: 'Studio', location: 'Service centre', notes: 'One light flickering; sent for repair' });
    ins('assets', { name: 'Adobe Creative Cloud (team)', category: 'software_subscription', status: 'active', purchase_date: d(-300), cost: L(4600), renewal_date: d(12), notes: 'Monthly subscription — see recurring payable' });

    // ---- past, fully closed campaign (history for reliability and statements)
    const spf = ins('campaigns', { name: 'Glow Co — Summer SPF', brand_id: glow, owner_id: aditya, stage: 'financial_closure', billing_model: 'gross', objective: 'Awareness for new SPF 50 range', start_date: d(-110), end_date: d(-80), client_budget: L(150000), budget_plan: [{ category: 'creator', description: 'Creators', planned: L(90000) }, { category: 'editing', description: 'Editing', planned: L(12000) }], kpi_targets: { views: 400000, engagement_rate: 3.5 }, live_at: d(-85), closed_at: d(-55), lessons: 'GRWM format beat tutorials by ~40% on views. Brief earlier: brand approvals took 4 days.' });
    const spfInv = invoice({ label: 'Full payment', status: 'issued', number: 'SM/2026-27/0001', brand_id: glow, campaign_id: spf, issue_date: d(-100), due_date: d(-95), expected_date: d(-95), confidence: 'confirmed', subtotal: L(150000) });
    pay({ account_id: hdfc, txn_date: d(-95), direction: 'in', amount: L(135000), category: 'brand_payment', description: 'Glow Co — Summer SPF', counterparty_type: 'brand', counterparty_id: glow, counterparty_name: 'Glow Co', campaign_id: spf, allocations: [{ invoice_id: spfInv, amount: L(135000), tds: L(15000) }] });
    for (const [infId, fee, paidOn] of [[riya, 50000, -80], [zoya, 40000, -78]] as const) {
      const cc = ins('campaign_creators', { campaign_id: spf, influencer_id: infId, status: 'confirmed', fee: L(fee), payout_due: d(paidOn) });
      afterWrite(db, F, 'campaign_creators', get(db, 'SELECT * FROM campaign_creators WHERE id = ?', cc)!, null);
      const o = get(db, 'SELECT id FROM obligations WHERE source = ?', `cc:${cc}`)!;
      pay({ account_id: hdfc, txn_date: d(paidOn), direction: 'out', amount: L(fee * 0.9), category: 'creator_payout', campaign_id: spf, counterparty_type: 'influencer', counterparty_id: infId, description: 'Summer SPF creator fee (TDS deducted)', allocations: [{ obligation_id: o.id, amount: L(fee * 0.9), tds: L(fee * 0.1) }] });
    }
    for (const t of all(db, `SELECT * FROM obligations WHERE category = 'tax' AND source LIKE 'tds:%'`)) {
      run(db, 'UPDATE obligations SET is_demo = 1 WHERE id = ?', t.id);
      pay({ account_id: hdfc, txn_date: d(-60), direction: 'out', amount: t.amount, category: 'tax_payment', description: 'TDS deposit (challan 281)', counterparty_name: 'Income Tax Department', allocations: [{ obligation_id: t.id, amount: t.amount }] });
    }
    const spfDel = (infId: number, title: string, due: number, pub: number, views: number) =>
      ins('deliverables', { campaign_id: spf, influencer_id: infId, title, type: 'reel', platform: 'instagram', status: 'live', due_date: d(due), publish_date: d(pub), live_url: `https://www.instagram.com/reel/demo-${infId}-${due}/`, metrics: { views, likes: Math.round(views * 0.05), comments: Math.round(views * 0.004), shares: Math.round(views * 0.006), saves: Math.round(views * 0.008), reach: null, source: 'Manual entry from creator screenshot (demo)', as_of: d(pub + 7) } });
    spfDel(riya, 'SPF GRWM reel', -86, -86, 182000);
    spfDel(zoya, 'Beach-ready SPF reel', -85, -83, 96000);
    const spfTask = ins('content_tasks', { title: 'Riya — SPF GRWM edit', campaign_id: spf, influencer_id: riya, editor_id: ishaan, stage: 'delivered', priority: 'normal', due_date: d(-88), editor_fee: L(6000), delivered_at: at(-87), revision_allowance: 2 });
    afterWrite(db, F, 'content_tasks', get(db, 'SELECT * FROM content_tasks WHERE id = ?', spfTask)!, null);
    const spfEdit = ins('content_tasks', { title: 'Zoya — SPF beach edit', campaign_id: spf, influencer_id: zoya, editor_id: ishaan, stage: 'delivered', priority: 'normal', due_date: d(-86), editor_fee: L(6000), delivered_at: at(-86), revision_allowance: 2 });
    afterWrite(db, F, 'content_tasks', get(db, 'SELECT * FROM content_tasks WHERE id = ?', spfEdit)!, null);
    for (const o of all(db, `SELECT * FROM obligations WHERE source IN (?, ?)`, `ct:${spfTask}`, `ct:${spfEdit}`)) {
      run(db, 'UPDATE obligations SET is_demo = 1 WHERE id = ?', o.id);
      pay({ account_id: hdfc, txn_date: d(-82), direction: 'out', amount: o.amount, category: 'editor_payout', campaign_id: spf, counterparty_type: 'editor', counterparty_id: ishaan, description: o.description, allocations: [{ obligation_id: o.id, amount: o.amount }] });
    }
    const hist = (taskId: number, steps: [string, string, number][]) => {
      for (const [from, to, dayOffset] of steps) ins('comments', { entity_type: 'content_tasks', entity_id: taskId, kind: 'approval', body: `${from} → ${to}`, meta: { from, to }, user_id: aditya, created_at: at(dayOffset) });
    };
    hist(spfTask, [['editing', 'internal_review', -92], ['internal_review', 'brand_review', -91], ['brand_review', 'changes_requested', -90], ['changes_requested', 'brand_review', -89], ['brand_review', 'approved', -88], ['approved', 'delivered', -87]]);
    hist(spfEdit, [['editing', 'internal_review', -90], ['internal_review', 'brand_review', -89], ['brand_review', 'approved', -87], ['approved', 'delivered', -86]]);

    // ---- Brewbox: live/reporting, final payment overdue, one creator part-paid
    const brew = ins('campaigns', { name: 'Brewbox — Monsoon Brews', brand_id: brewbox, owner_id: aditya, stage: 'reporting', billing_model: 'gross', objective: 'Drive trial of monsoon cold brew range', start_date: d(-55), end_date: d(-20), client_budget: L(240000), budget_plan: [{ category: 'creator', description: 'Creators', planned: L(110000) }, { category: 'editing', description: 'Editing', planned: L(15000) }], kpi_targets: { views: 250000, engagement_rate: 3, clicks: 2000 }, live_at: d(-30) });
    const brewAdv = invoice({ label: 'Advance 50%', status: 'issued', number: 'SM/2026-27/0004', brand_id: brewbox, campaign_id: brew, issue_date: d(-50), due_date: d(-40), expected_date: d(-40), confidence: 'confirmed', subtotal: L(120000) });
    invoice({ label: 'Final 50%', status: 'issued', number: 'SM/2026-27/0007', brand_id: brewbox, campaign_id: brew, issue_date: d(-27), due_date: d(-12), expected_date: d(12), confidence: 'delayed', subtotal: L(120000), notes: 'Brewbox finance said payment run moved to month end' });
    pay({ account_id: hdfc, txn_date: d(-40), direction: 'in', amount: L(120000), category: 'brand_payment', campaign_id: brew, counterparty_type: 'brand', counterparty_id: brewbox, counterparty_name: 'Brewbox Coffee', description: 'Brewbox advance', allocations: [{ invoice_id: brewAdv, amount: L(120000) }] });
    const brewCc = (infId: number, fee: number, due: number) => {
      const id = ins('campaign_creators', { campaign_id: brew, influencer_id: infId, status: 'confirmed', fee: L(fee), payout_due: d(due) });
      afterWrite(db, F, 'campaign_creators', get(db, 'SELECT * FROM campaign_creators WHERE id = ?', id)!, null);
      return get(db, 'SELECT id FROM obligations WHERE source = ?', `cc:${id}`)!.id as number;
    };
    const kabirOb = brewCc(kabirC, 60000, -15);
    const devOb = brewCc(dev, 50000, -2);
    pay({ account_id: hdfc, txn_date: d(-15), direction: 'out', amount: L(60000), category: 'creator_payout', campaign_id: brew, counterparty_type: 'influencer', counterparty_id: kabirC, description: 'Kabir — Monsoon Brews', allocations: [{ obligation_id: kabirOb, amount: L(60000) }] });
    pay({ account_id: hdfc, txn_date: d(-10), direction: 'out', amount: L(25000), category: 'creator_payout', campaign_id: brew, counterparty_type: 'influencer', counterparty_id: dev, description: 'Dev — first half', allocations: [{ obligation_id: devOb, amount: L(25000) }] });
    const brewTask = ins('content_tasks', { title: 'Kabir — cold brew recipe reel', campaign_id: brew, influencer_id: kabirC, editor_id: pooja, stage: 'delivered', priority: 'normal', due_date: d(-34), editor_fee: L(15000), delivered_at: at(-33), revision_allowance: 2 });
    afterWrite(db, F, 'content_tasks', get(db, 'SELECT * FROM content_tasks WHERE id = ?', brewTask)!, null);
    hist(brewTask, [['editing', 'internal_review', -38], ['internal_review', 'changes_requested', -37], ['changes_requested', 'internal_review', -36], ['internal_review', 'brand_review', -36], ['brand_review', 'approved', -34], ['approved', 'delivered', -33]]);
    const poojaOb = get(db, 'SELECT id, amount FROM obligations WHERE source = ?', `ct:${brewTask}`)!;
    pay({ account_id: hdfc, txn_date: d(-12), direction: 'out', amount: poojaOb.amount, category: 'editor_payout', campaign_id: brew, counterparty_type: 'editor', counterparty_id: pooja, description: 'Editing — cold brew reel', allocations: [{ obligation_id: poojaOb.id, amount: poojaOb.amount }] });
    const brewDel = (infId: number, title: string, due: number, pub: number | null, views: number | null) =>
      ins('deliverables', { campaign_id: brew, influencer_id: infId, title, type: 'reel', platform: 'instagram', status: pub === null ? 'approved' : 'live', due_date: d(due), publish_date: pub === null ? null : d(pub), live_url: pub === null ? null : `https://www.instagram.com/reel/demo-brew-${infId}/`, metrics: views === null ? null : { views, likes: Math.round(views * 0.04), comments: Math.round(views * 0.003), shares: null, saves: null, clicks: Math.round(views * 0.008), source: 'Manual entry from creator screenshot (demo)', as_of: d(-5) } });
    brewDel(kabirC, 'Cold brew at home reel', -32, -31, 141000);
    brewDel(dev, 'Monsoon road-trip coffee reel', -30, -27, 58000);

    // ---- NovaTech: brand approval stage, over budget, final payment at risk
    const novaC = ins('campaigns', { name: 'NovaTech — Gadget Fest', brand_id: nova, owner_id: aditya, stage: 'brand_approval', billing_model: 'gross', objective: 'Festive-season sales push for earbuds', start_date: d(-25), end_date: d(12), client_budget: L(180000), budget_plan: [{ category: 'creator', description: 'Creators', planned: L(140000) }, { category: 'editing', description: 'Editing', planned: L(15000) }, { category: 'production', description: 'Studio', planned: L(10000) }], kpi_targets: { views: 300000, clicks: 3000 }, scope_changes: [{ date: d(-8), description: 'Brand added a second unboxing cut for Amazon listing', cost_impact: L(8000), revenue_impact: 0, days_impact: 3, status: 'approved' }] });
    const novaAdv = invoice({ label: 'Advance 50%', status: 'issued', number: 'SM/2026-27/0006', brand_id: nova, campaign_id: novaC, issue_date: d(-24), due_date: d(-20), expected_date: d(-20), confidence: 'confirmed', subtotal: L(90000) });
    invoice({ label: 'Final 50%', status: 'scheduled', brand_id: nova, campaign_id: novaC, due_date: d(15), expected_date: d(15), confidence: 'at_risk', subtotal: L(90000), notes: 'Brand unhappy with first cut; payment tied to approval' });
    pay({ account_id: hdfc, txn_date: d(-20), direction: 'in', amount: L(90000), category: 'brand_payment', campaign_id: novaC, counterparty_type: 'brand', counterparty_id: nova, counterparty_name: 'NovaTech', description: 'NovaTech advance', allocations: [{ invoice_id: novaAdv, amount: L(90000) }] });
    for (const [infId, fee, due] of [[arjun, 120000, 8], [sneha, 40000, 25]] as const) {
      const id = ins('campaign_creators', { campaign_id: novaC, influencer_id: infId, status: 'confirmed', fee: L(fee), payout_due: d(due) });
      afterWrite(db, F, 'campaign_creators', get(db, 'SELECT * FROM campaign_creators WHERE id = ?', id)!, null);
    }
    pay({ account_id: hdfc, txn_date: d(-5), direction: 'out', amount: L(12000), category: 'vendor_payment', campaign_id: novaC, counterparty_name: 'Lightbox Studios', description: 'Studio rental — unboxing shoot' });
    const novaTask = ins('content_tasks', { title: 'Arjun — earbuds unboxing (YouTube)', campaign_id: novaC, influencer_id: arjun, editor_id: pooja, reviewer_id: aditya, stage: 'brand_review', priority: 'high', due_date: d(2), editor_fee: L(20000), revision_allowance: 2, extra_revision_cost: L(3000), output_specs: '16:9, 4K, 8–10 min, chapters + end screen', brief: 'Unboxing + 7-day review. Mention festive offer code. No competitor names on screen.', versions: [{ no: 1, url: 'https://example.com/demo/frameio/v1', notes: 'First cut', script: null, caption: null, at: at(-4), by: 'Pooja Nair' }, { no: 2, url: 'https://example.com/demo/frameio/v2', notes: 'Tightened intro, added offer card', script: null, caption: null, at: at(-2), by: 'Pooja Nair' }] });
    afterWrite(db, F, 'content_tasks', get(db, 'SELECT * FROM content_tasks WHERE id = ?', novaTask)!, null);
    hist(novaTask, [['editing', 'internal_review', -4], ['internal_review', 'changes_requested', -3], ['changes_requested', 'internal_review', -2], ['internal_review', 'brand_review', -2]]);
    ins('comments', { entity_type: 'content_tasks', entity_id: novaTask, kind: 'feedback', body: 'Intro is too long — get to the unboxing by 0:15.', meta: { version: 1, timestamp_sec: 9 }, user_id: aditya, created_at: at(-3) });
    ins('deliverables', { campaign_id: novaC, influencer_id: arjun, title: 'Earbuds unboxing + review', type: 'youtube_video', platform: 'youtube', status: 'brand_review', due_date: d(4) });
    ins('deliverables', { campaign_id: novaC, influencer_id: sneha, title: 'Earbuds for busy parents reel', type: 'reel', platform: 'instagram', status: 'in_production', due_date: d(-1) });

    // ---- Glow Co Diwali: the founder's worked example
    const diwali = ins('campaigns', { name: 'Glow Co — Diwali Glow Launch', brand_id: glow, owner_id: aditya, stage: 'production', billing_model: 'gross', objective: 'Launch the Diwali gift box; drive pre-orders', brief: 'Two GRWM reels showing the gift box. Festive styling. Code GLOWDIWALI.', start_date: d(-14), end_date: d(16), client_budget: L(100000), agency_fee: L(25000), budget_plan: [{ category: 'creator', description: 'Riya + Zoya', planned: L(65000) }, { category: 'editing', description: 'Two reels', planned: L(10000) }], kpi_targets: { views: 250000, engagement_rate: 3.5, conversions: 300 } });
    const dAdv = invoice({ label: 'Advance 50%', status: 'issued', number: 'SM/2026-27/0008', brand_id: glow, campaign_id: diwali, issue_date: d(-13), due_date: d(-10), expected_date: d(-10), confidence: 'confirmed', subtotal: L(50000) });
    invoice({ label: 'Final 50%', status: 'scheduled', brand_id: glow, campaign_id: diwali, due_date: d(29), expected_date: d(29), confidence: 'expected', subtotal: L(50000) });
    pay({ account_id: hdfc, txn_date: d(-10), direction: 'in', amount: L(50000), category: 'brand_payment', campaign_id: diwali, counterparty_type: 'brand', counterparty_id: glow, counterparty_name: 'Glow Co', description: 'Glow Co Diwali advance', allocations: [{ invoice_id: dAdv, amount: L(50000) }] });
    const riyaCc = ins('campaign_creators', { campaign_id: diwali, influencer_id: riya, status: 'confirmed', fee: L(40000), payout_due: d(18), payment_terms: '15 days after go-live' });
    afterWrite(db, F, 'campaign_creators', get(db, 'SELECT * FROM campaign_creators WHERE id = ?', riyaCc)!, null);
    const zoyaCc = ins('campaign_creators', { campaign_id: diwali, influencer_id: zoya, status: 'confirmed', fee: L(25000), payout_due: d(21) });
    afterWrite(db, F, 'campaign_creators', get(db, 'SELECT * FROM campaign_creators WHERE id = ?', zoyaCc)!, null);
    const riyaDel = ins('deliverables', { campaign_id: diwali, influencer_id: riya, title: 'Diwali GRWM reel', type: 'reel', platform: 'instagram', status: 'internal_review', due_date: d(6) });
    const zoyaDel = ins('deliverables', { campaign_id: diwali, influencer_id: zoya, title: 'Festive look reel', type: 'reel', platform: 'instagram', status: 'in_production', due_date: d(8) });
    const t1 = ins('content_tasks', { title: 'Riya — Diwali GRWM reel', campaign_id: diwali, deliverable_id: riyaDel, influencer_id: riya, editor_id: ishaan, reviewer_id: aditya, stage: 'internal_review', priority: 'high', due_date: d(3), editor_fee: L(6000), revision_allowance: 2, extra_revision_cost: L(1500), output_specs: '9:16, 1080×1920, 30–45s, burned-in captions', brief: 'Open on the gift box. Show 3 products. CTA: code GLOWDIWALI.', reference_links: ['https://example.com/demo/reference-reel'], raw_footage_links: ['https://example.com/demo/drive/riya-raw'], script: 'HOOK (0–3s): "Diwali glow in 5 minutes?"\nSHOT 1: Gift box reveal\nSHOT 2: Serum + moisturiser\nSHOT 3: Highlighter finish\nCTA: Use GLOWDIWALI for 15% off', caption: 'Diwali glow, sorted ✨ #GlowCoPartner', checklist: [{ text: 'Colour grade', done: true }, { text: 'Captions', done: true }, { text: 'Music licence check', done: false }], versions: [{ no: 1, url: 'https://example.com/demo/frameio/riya-v1', notes: 'First cut', script: 'HOOK: "Diwali glow?"\nSHOT 1: Gift box\nCTA: Use code', caption: 'Diwali glow ✨', at: at(-2), by: 'Ishaan Verma' }] });
    afterWrite(db, F, 'content_tasks', get(db, 'SELECT * FROM content_tasks WHERE id = ?', t1)!, null);
    hist(t1, [['editing', 'internal_review', -1]]);
    const t2 = ins('content_tasks', { title: 'Zoya — Festive look reel', campaign_id: diwali, deliverable_id: zoyaDel, influencer_id: zoya, editor_id: farhan, stage: 'editing', priority: 'normal', due_date: d(5), editor_fee: L(4000), revision_allowance: 2, output_specs: '9:16, 1080×1920, 30s' });
    afterWrite(db, F, 'content_tasks', get(db, 'SELECT * FROM content_tasks WHERE id = ?', t2)!, null);

    // ---- PocketFin: commission deal (creator paid directly by brand); ₹20,000 commission expected later
    const pf = ins('campaigns', { name: 'PocketFin — Smart Savings', brand_id: pocketfin, owner_id: aditya, stage: 'live', billing_model: 'commission', objective: 'App installs from finance-savvy audience', start_date: d(-20), end_date: d(10), client_budget: L(20000), agency_fee: L(20000), gross_deal_value: L(100000), live_at: d(-6), kpi_targets: { views: 150000, conversions: 1500 }, notes: 'Brand pays Rohan ₹1,00,000 directly. We invoice Rohan 20% commission.' });
    ins('campaign_creators', { campaign_id: pf, influencer_id: rohan, status: 'confirmed', fee: 0, payment_terms: 'Paid directly by PocketFin' });
    invoice({ label: 'Commission 20%', kind: 'commission', status: 'issued', number: 'SM/2026-27/0009', payer_type: 'influencer', influencer_id: rohan, campaign_id: pf, issue_date: d(-3), due_date: d(20), expected_date: d(20), confidence: 'expected', subtotal: L(20000) });
    ins('deliverables', { campaign_id: pf, influencer_id: rohan, title: '50-30-20 savings rule reel', type: 'reel', platform: 'instagram', status: 'live', due_date: d(-7), publish_date: d(-6), live_url: 'https://www.instagram.com/reel/demo-rohan-pf/', metrics: { views: 87000, likes: 3900, comments: 410, shares: 950, saves: 2100, clicks: null, conversions: null, source: 'Manual entry (demo)', as_of: d(-1) } });

    // ---- Deals pipeline (one is converted to a campaign through the real conversion flow)
    const deal = (v: Row) => ins('deals', { billing_model: 'gross', owner_id: aditya, revisions_included: 2, ...v });
    const urbanDeal = deal({ title: 'UrbanStride — Run Mumbai', brand_id: urban, stage: 'negotiation', brand_price: L(350000), creators: [{ influencer_id: ananya, fee: L(90000), deliverables: '2 reels, 3 stories', status: 'confirmed' }, { influencer_id: dev, fee: L(70000), deliverables: '1 reel', status: 'confirmed' }], editor_costs: L(20000), other_costs: L(15000), deliverables: 'Run-club launch content', usage_rights: 'Organic + 30 days paid usage on Meta', exclusivity: 'No competing footwear brands for 45 days', deadline: d(40), payment_milestones: [{ label: 'Advance 50%', pct: 50, due_days: 5 }, { label: 'Final 50%', pct: 50, due_days: 55 }], probability: 70, expected_close: d(-2), brief: 'Launch the Run Mumbai club. Real runners, early mornings, Marine Drive.' });
    const urbanCampaign = convertDeal(db, F, urbanDeal);
    run(db, `UPDATE campaigns SET is_demo = 1, stage = 'creator_confirmation' WHERE id = ?`, urbanCampaign);
    run(db, `UPDATE invoices SET confidence = 'confirmed' WHERE campaign_id = ? AND label LIKE 'Advance%'`, urbanCampaign);
    run(db, `UPDATE obligations SET due_date = ? WHERE campaign_id = ? AND influencer_id = ?`, d(35), urbanCampaign, ananya);
    run(db, `UPDATE campaign_creators SET payout_due = ? WHERE campaign_id = ? AND influencer_id = ?`, d(35), urbanCampaign, ananya);
    ins('content_tasks', { title: 'Ananya — Run Mumbai teaser', campaign_id: urbanCampaign, influencer_id: ananya, editor_id: ishaan, stage: 'footage_pending', priority: 'high', due_date: d(9), blocked_reason: 'Shoot moved: waiting for brand to deliver shoes', brief: 'Sunrise run, Marine Drive. 20s teaser.' });

    deal({ title: 'NovaTech — Phone launch', brand_id: nova, stage: 'proposal_sent', brand_price: L(450000), creators: [{ influencer_id: arjun, fee: L(200000), deliverables: '1 youtube video, 2 shorts' }], editor_costs: L(30000), probability: 50, expected_close: d(14), next_action: 'Chase feedback on proposal', next_action_date: d(1) });
    deal({ title: 'NutriBox — Protein month', brand_id: nutri, stage: 'negotiation', billing_model: 'commission', commission_payer: 'brand', brand_price: L(300000), agency_fee: L(60000), creators: [{ influencer_id: ananya, fee: L(150000), deliverables: '2 reels' }, { influencer_id: kabirC, fee: L(90000), deliverables: '1 reel' }], probability: 70, expected_close: d(7), next_action: 'Send revised commission split', next_action_date: d(-2) });
    deal({ title: 'Glow Co — Wedding season', brand_id: glow, stage: 'creator_shortlist', brand_price: L(250000), probability: 40, expected_close: d(30), next_action: 'Shortlist 4 beauty creators', next_action_date: d(3), brief: 'Bridal skincare prep series' });
    deal({ title: 'PocketFin — Tax season', brand_id: pocketfin, stage: 'brief_received', billing_model: 'commission', agency_fee: L(30000), probability: 30, expected_close: d(45), next_action: 'Check Rohan availability for Jan', next_action_date: d(5) });
    deal({ title: 'Brewbox — Winter menu', brand_id: brewbox, stage: 'contacted', probability: 20, next_action: 'Call Rahul after final payment clears', next_action_date: d(14) });
    deal({ title: 'Masala Junction — Restaurant launch', brand_id: masala, stage: 'lead', probability: 10, creators: [{ influencer_id: kabirC, fee: L(30000), deliverables: '1 reel' }, { influencer_id: meher, fee: L(15000), deliverables: '1 reel' }], brand_price: L(80000), next_action: 'Send intro deck', next_action_date: d(-1), source: 'Inbound — Instagram DM' });
    deal({ title: 'StyleCart — Sale week', brand_id: stylecart, stage: 'lost', probability: 0, brand_price: L(200000), loss_reason: 'Brand cut influencer budget for the quarter' });

    // ---- operating expenses: recurring payables and past payments
    const rent = ob({ description: 'Studio rent — Andheri', category: 'rent', payee_type: 'vendor', payee_name: 'Landlord (demo)', amount: L(35000), due_date: d(-7), repeat: 'monthly', priority: 'high' });
    pay({ account_id: hdfc, txn_date: d(-7), direction: 'out', amount: L(35000), category: 'operating_expense', counterparty_name: 'Landlord (demo)', description: 'Studio rent', allocations: [{ obligation_id: rent, amount: L(35000) }] });
    const salary = ob({ description: 'Team salaries', category: 'salary', payee_type: 'other', payee_name: 'Team payroll', amount: L(85000), due_date: d(-5), repeat: 'monthly', priority: 'critical' });
    pay({ account_id: hdfc, txn_date: d(-35), direction: 'out', amount: L(85000), category: 'operating_expense', counterparty_name: 'Team payroll', description: 'Salaries (previous month)' });
    pay({ account_id: icici, txn_date: d(-5), direction: 'out', amount: L(85000), category: 'operating_expense', counterparty_name: 'Team payroll', description: 'Salaries', allocations: [{ obligation_id: salary, amount: L(85000) }] });
    const adobe = ob({ description: 'Adobe Creative Cloud', category: 'subscription', payee_type: 'vendor', payee_name: 'Adobe', amount: L(4600), due_date: d(-18), repeat: 'monthly' });
    pay({ account_id: hdfc, txn_date: d(-18), direction: 'out', amount: L(4600), category: 'operating_expense', counterparty_name: 'Adobe', description: 'Adobe CC', allocations: [{ obligation_id: adobe, amount: L(4600) }] });
    pay({ account_id: hdfc, txn_date: d(-37), direction: 'out', amount: L(35000), category: 'operating_expense', counterparty_name: 'Landlord (demo)', description: 'Studio rent (previous month)' });
    pay({ account_id: petty, txn_date: d(-9), direction: 'out', amount: L(2350), category: 'operating_expense', counterparty_name: 'Local vendor', description: 'Shoot snacks & travel' });
    pay({ account_id: hdfc, txn_date: d(-3), direction: 'out', amount: L(590), category: 'bank_charges', description: 'NEFT charges' });
    ob({ description: 'GST payable (Sept)', category: 'tax', payee_type: 'other', payee_name: 'GSTN', amount: L(18000), due_date: d(13), priority: 'critical' });

    recordTransfer(db, F, { from_account_id: icici, to_account_id: hdfc, amount: L(25000), txn_date: d(-30), reference: 'DEMO-TRF-1' });
    recordTransfer(db, F, { from_account_id: hdfc, to_account_id: petty, amount: L(5000), txn_date: d(-20), reference: 'DEMO-TRF-2' });
    importTransactions(db, F, hdfc, [
      { date: d(-2), description: 'UPI/NOTION LABS/subscription', amount: '-1600.00' },
      { date: d(-1), description: 'IMPS/REF 88231/unknown credit', reference: 'IMPS88231', amount: '3500.00' },
    ]);

    // ---- earmarks & reserves
    createEarmark(db, F, { target_type: 'reserve', label: 'GST & TDS reserve', amount: L(40000), protected: true, reason: 'Keep statutory dues untouched' });
    createEarmark(db, F, { target_type: 'reserve', label: 'Operations buffer', amount: L(30000), protected: false, reason: 'One month of fixed costs (partial)' });
    const riyaOb = get(db, 'SELECT id FROM obligations WHERE source = ?', `cc:${riyaCc}`)!.id;
    createEarmark(db, F, { target_type: 'obligation', obligation_id: riyaOb, amount: L(40000), reason: 'Set aside from Glow Co advance' });

    // ---- tasks
    const task = (v: Row) => ins('tasks', { status: 'todo', priority: 'normal', recurrence: 'none', ...v });
    task({ title: 'Weekly cash review', owner_id: F.id, due_date: weekStart(d(7)), recurrence: 'weekly', priority: 'high', checklist: [{ text: 'Categorise imported transactions', done: false }, { text: 'Check payouts due in 14 days', done: false }, { text: 'Update receivable confidence', done: false }] });
    task({ title: 'Chase Brewbox final payment', owner_id: meera, due_date: d(0), priority: 'urgent', related_type: 'campaigns', related_id: brew });
    task({ title: 'Renew Riya agreement', owner_id: sana, due_date: d(10), related_type: 'influencers', related_id: riya, checklist: [{ text: 'Share renewal terms', done: true }, { text: 'Get signed copy', done: false }] });
    const shortlistTask = task({ title: 'Shortlist creators for Glow wedding season', owner_id: sana, due_date: d(3), status: 'in_progress' });
    task({ title: 'Send wedding-season proposal', owner_id: aditya, due_date: d(6), depends_on: [shortlistTask] });
    task({ title: 'Submit September GST return', owner_id: meera, due_date: d(-1), priority: 'high', status: 'in_progress' });

    // ---- documents & templates
    const doc = (v: Row) => ins('documents', { visibility: 'internal', reminder_days: 30, ...v });
    doc({ title: 'Riya Sharma — exclusive management agreement', kind: 'creator_agreement', entity_type: 'influencers', entity_id: riya, expiry_date: d(20), url: 'https://example.com/demo/riya-agreement.pdf' });
    doc({ title: 'Glow Co — master services agreement', kind: 'contract', entity_type: 'brands', entity_id: glow, expiry_date: d(240), url: 'https://example.com/demo/glow-msa.pdf' });
    doc({ title: 'Diwali Glow Launch — brand brief', kind: 'brief', entity_type: 'campaigns', entity_id: diwali, visibility: 'brand', url: 'https://example.com/demo/diwali-brief.pdf' });
    doc({ title: 'Template: Brand proposal', kind: 'template', body: '# Proposal for {{brand}}\n\nDate: {{date}}\n\n## Objective\n…\n\n## Recommended creators\n…\n\n## Deliverables & timeline\n…\n\n## Investment\nTotal: {{amount}} (excl. GST)\n\n## Terms\n50% advance, 50% within 30 days of go-live.' });
    doc({ title: 'Template: Creator brief', kind: 'template', body: '# Brief: {{campaign}}\n\nCreator: {{creator}}\nBrand: {{brand}}\n\n## Key message\n…\n\n## Must include\n- …\n\n## Do not\n- …\n\n## Timeline\nDraft by …, live on …' });
    doc({ title: 'Template: Creator agreement', kind: 'template', body: '# Creator Agreement\n\nBetween Socialmog and {{creator}} for {{campaign}} ({{brand}}).\n\nFee: {{amount}}\nDeliverables: …\nUsage rights: …\nExclusivity: …\nPayment: within 15 days of go-live, subject to TDS.' });
    doc({ title: 'Template: Weekly creator report', kind: 'template', body: '# Weekly report — {{creator}}\nWeek of {{date}}\n\n## What happened\n…\n\n## Best content\n…\n\n## Next week\n1. …\n2. …\n3. …' });

    // ---- weekly analytics snapshots (manual entry; clearly demo)
    const snapshotSeries = (infId: number, followers0: number, growth: number, views0: number, trend: number, er: number, weeks = 8) => {
      let followers = followers0;
      for (let w = weeks; w >= 1; w--) {
        const start = weekStart(d(-7 * w));
        const k = weeks - w;
        const views = Math.round(views0 * (1 + trend * k) * (0.9 + ((k * 37) % 20) / 100));
        const end = followers + Math.round(followers * growth * (1 + trend * k));
        ins('analytics_snapshots', {
          influencer_id: infId, platform: 'instagram', period_start: start, period_end: addDays(start, 6), source: 'manual',
          notes: 'Demo data — manual entry',
          metrics: { followers_start: followers, followers_end: end, posts: 3 + (k % 3), reach: Math.round(views * 0.7), views, likes: Math.round(views * er * 0.8 / 100), comments: Math.round(views * er * 0.06 / 100), shares: Math.round(views * er * 0.08 / 100), saves: Math.round(views * er * 0.06 / 100), engagement_rate: Math.round(er * (1 + trend * k / 2) * 100) / 100, median_views: Math.round(views / (3 + (k % 3)) * 0.8), avg_views: Math.round(views / (3 + (k % 3))), paid_views: k === weeks - 1 && infId === riya ? 40000 : null, profile_visits: null, website_clicks: null },
        });
        followers = end;
      }
    };
    snapshotSeries(riya, 395000, 0.008, 300000, 0.06, 4.1);
    snapshotSeries(kabirC, 214000, 0.001, 210000, -0.06, 3.2);
    snapshotSeries(ananya, 305000, 0.005, 260000, 0.01, 5.0);
    snapshotSeries(rohan, 172000, 0.006, 150000, 0.04, 3.5);
    snapshotSeries(zoya, 262000, 0.002, 190000, -0.05, 3.8);
    const post = (infId: number, n: number, dayOffset: number, format: string, topic: string, duration: number | null, views: number, promotion = 'organic') =>
      ins('posts', { influencer_id: infId, platform: 'instagram', external_id: `demo-${infId}-${n}`, permalink: `https://www.instagram.com/reel/demo-${infId}-${n}/`, published_at: at(dayOffset, 19), format, topic, duration_sec: duration, caption: `${topic} (demo post)`, promotion, metrics: { views, reach: Math.round(views * 0.72), likes: Math.round(views * 0.045), comments: Math.round(views * 0.003), shares: Math.round(views * 0.005), saves: Math.round(views * 0.006) }, source: 'manual', metrics_as_of: at(-1) });
    post(riya, 1, -6, 'reel', 'GRWM', 42, 162000);
    post(riya, 2, -4, 'reel', 'Product review', 58, 74000);
    post(riya, 3, -2, 'carousel', 'Skincare routine', null, 31000);
    post(riya, 4, -9, 'reel', 'GRWM', 38, 141000, 'paid');
    post(kabirC, 1, -5, 'reel', 'Recipe', 65, 52000);
    post(kabirC, 2, -3, 'reel', 'Street food', 44, 38000);
    post(rohan, 1, -6, 'reel', 'Savings tips', 50, 87000);
    post(rohan, 2, -2, 'carousel', 'Tax basics', null, 22000);

    // Seeding runs only on an empty database, so everything except the founder's own login is demo.
    for (const e of ENTITIES) if (e.key !== 'users') run(db, `UPDATE ${e.key} SET is_demo = 1`);
    setSetting(db, 'demo_seeded', true);
    setSetting(db, 'demo_loaded', true);
  });
  console.log(`Demo data loaded (all records marked DEMO). Demo logins use password "${DEMO_PASSWORD}": meera@ / aditya@ / sana@ / ishaan@ / neha@ / riya@demo.socialmog.in`);
}

/** Deletes every demo-flagged record (in dependency order). Real records are never touched. */
export function removeDemo(db: Db): Row {
  const order = ['settlements', 'earmarks', 'purchase_simulations', 'comments', 'notifications', 'weekly_reports', 'posts', 'analytics_snapshots', 'social_accounts', 'report_runs', 'transactions', 'invoices', 'obligations', 'content_tasks', 'deliverables', 'campaign_creators', 'tasks', 'documents', 'assets', 'deals', 'campaigns', 'contacts', 'brands', 'influencers', 'editors', 'accounts'];
  const counts: Row = {};
  tx(db, () => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    const demoTxns = all(db, 'SELECT id FROM transactions WHERE is_demo = 1').map((r) => r.id);
    if (demoTxns.length) run(db, `DELETE FROM settlements WHERE transaction_id IN (${demoTxns.join(',')})`);
    const demoInv = all(db, 'SELECT id FROM invoices WHERE is_demo = 1').map((r) => r.id);
    if (demoInv.length) run(db, `DELETE FROM settlements WHERE invoice_id IN (${demoInv.join(',')})`);
    const demoOb = all(db, 'SELECT id FROM obligations WHERE is_demo = 1').map((r) => r.id);
    if (demoOb.length) run(db, `DELETE FROM settlements WHERE obligation_id IN (${demoOb.join(',')})`);
    // What the app generated for demo creators after seeding (weekly reports, snapshots, posts, connections) goes with them.
    for (const t of ['weekly_reports', 'analytics_snapshots', 'posts', 'social_accounts']) run(db, `UPDATE ${t} SET is_demo = 1 WHERE influencer_id IN (SELECT id FROM influencers WHERE is_demo = 1)`);
    // TDS register rows hang off demo invoices and receipts (some were added by the start-up backfill, unflagged).
    const ids = (sql: string) => all(db, sql).map((r) => r.id).join(',') || 'NULL';
    const demoSettlements = ids(`SELECT id FROM settlements WHERE is_demo = 1 OR transaction_id IN (SELECT id FROM transactions WHERE is_demo = 1) OR invoice_id IN (SELECT id FROM invoices WHERE is_demo = 1) OR obligation_id IN (SELECT id FROM obligations WHERE is_demo = 1)`);
    counts.tds_credits = Number(run(db, `DELETE FROM tds_credits WHERE is_demo = 1 OR settlement_id IN (${demoSettlements}) OR creator_settlement_id IN (${demoSettlements})
      OR invoice_id IN (SELECT id FROM invoices WHERE is_demo = 1) OR obligation_id IN (SELECT id FROM obligations WHERE is_demo = 1) OR influencer_id IN (SELECT id FROM influencers WHERE is_demo = 1)`).changes);
    const demoUsers = all(db, 'SELECT id FROM users WHERE is_demo = 1').map((r) => r.id);
    if (demoUsers.length) {
      run(db, `DELETE FROM sessions WHERE user_id IN (${demoUsers.join(',')})`);
      run(db, `DELETE FROM notifications WHERE user_id IN (${demoUsers.join(',')})`);
    }
    for (const t of order) counts[t] = Number(run(db, `DELETE FROM ${t} WHERE is_demo = 1`).changes);
    counts.users = Number(run(db, 'DELETE FROM users WHERE is_demo = 1').changes);
    // Real records still pointing at demo ones (a real deliverable on a demo campaign…) block the removal, with a reason.
    const broken = all(db, 'PRAGMA foreign_key_check');
    if (broken.length) throw new HttpError(409, `Some real records still point at demo data (${[...new Set(broken.map((b) => `${b.table} → ${b.parent}`))].join(', ')}). Move them to real records first; nothing was removed.`);
    setSetting(db, 'demo_loaded', false);
  });
  return counts;
}

