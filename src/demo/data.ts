// PREVIEW DATA for the design review only. Every name here is fictional.
// When features are built these come from Supabase views
// (brand_financials, invoice_totals, campaign_financials, period_summary, activity_log).
import { FOUNDERS } from '../lib/config'

export const F1 = FOUNDERS[0], F2 = FOUNDERS[1]

export type BrandStatus = 'lead' | 'pitching' | 'active' | 'paused' | 'churned'
export interface BrandRow {
  id: string; name: string; industry: string; relationship: 'project' | 'retainer' | 'both'
  status: BrandStatus; owner: string; city: string
  billed: number; received: number; outstanding: number; overdue: number
  campaigns: number; activeCampaigns: number; lastActivity: string
}

export const brands: BrandRow[] = [
  { id: 'b1', name: 'Mama Bites', industry: 'D2C food', relationship: 'both', status: 'active', owner: F1, city: 'Mumbai', billed: 1840000, received: 1395000, outstanding: 445000, overdue: 145000, campaigns: 6, activeCampaigns: 2, lastActivity: '2026-11-08T12:40:00Z' },
  { id: 'b2', name: 'Kesar Skin Co.', industry: 'Beauty', relationship: 'retainer', status: 'active', owner: F2, city: 'Bengaluru', billed: 2160000, received: 1980000, outstanding: 180000, overdue: 0, campaigns: 4, activeCampaigns: 1, lastActivity: '2026-11-09T04:15:00Z' },
  { id: 'b3', name: 'Ghar Ki Chai', industry: 'Beverages', relationship: 'project', status: 'active', owner: F1, city: 'Delhi', billed: 620000, received: 620000, outstanding: 0, overdue: 0, campaigns: 2, activeCampaigns: 1, lastActivity: '2026-11-06T09:00:00Z' },
  { id: 'b4', name: 'Paisa Sathi', industry: 'Fintech', relationship: 'project', status: 'pitching', owner: F2, city: 'Gurugram', billed: 0, received: 0, outstanding: 0, overdue: 0, campaigns: 1, activeCampaigns: 0, lastActivity: '2026-11-07T11:20:00Z' },
  { id: 'b5', name: 'Nila Handloom', industry: 'Fashion', relationship: 'project', status: 'active', owner: F1, city: 'Chennai', billed: 410000, received: 280000, outstanding: 130000, overdue: 130000, campaigns: 2, activeCampaigns: 1, lastActivity: '2026-11-03T07:30:00Z' },
  { id: 'b6', name: 'Rasoi Robotics', industry: 'Appliances', relationship: 'project', status: 'paused', owner: F2, city: 'Pune', billed: 350000, received: 350000, outstanding: 0, overdue: 0, campaigns: 1, activeCampaigns: 0, lastActivity: '2026-09-21T10:00:00Z' },
  { id: 'b7', name: 'Udaan Fitness', industry: 'Health', relationship: 'retainer', status: 'active', owner: F2, city: 'Hyderabad', billed: 1080000, received: 990000, outstanding: 90000, overdue: 0, campaigns: 3, activeCampaigns: 2, lastActivity: '2026-11-08T15:05:00Z' },
  { id: 'b8', name: 'Bindi Books', industry: 'Edtech', relationship: 'project', status: 'lead', owner: F1, city: 'Kolkata', billed: 0, received: 0, outstanding: 0, overdue: 0, campaigns: 0, activeCampaigns: 0, lastActivity: '2026-11-05T06:45:00Z' },
  { id: 'b9', name: 'Monsoon Travels', industry: 'Travel', relationship: 'project', status: 'churned', owner: F1, city: 'Kochi', billed: 240000, received: 240000, outstanding: 0, overdue: 0, campaigns: 1, activeCampaigns: 0, lastActivity: '2026-06-14T08:00:00Z' },
]

// ─── Dashboard ───────────────────────────────────────────────
export const summary = {
  revenue: 1265000, collections: 1040000, creatorCost: 486000, expenses: 172500,
  outstanding: 845000, overdue: 275000, creatorPayable: 214000,
  target: 1500000, liveThisPeriod: 23, dueThisPeriod: 31,
  revenuePrev: 1092000,
}

export const pipeline: { stage: string; count: number }[] = [
  { stage: 'Brief', count: 4 }, { stage: 'Scripting', count: 6 }, { stage: 'Shoot', count: 5 },
  { stage: 'Editing', count: 7 }, { stage: 'Client review', count: 3 }, { stage: 'Scheduled', count: 4 },
]

export const upcoming = [
  { date: '2026-11-10', title: 'Diwali leftovers reel', brand: 'Mama Bites', creator: 'Asha Rao', stage: 'Scheduled' },
  { date: '2026-11-11', title: 'Winter skin routine ×3', brand: 'Kesar Skin Co.', creator: 'Meher Kaur', stage: 'Client review' },
  { date: '2026-11-12', title: 'Studio shoot — chai pours', brand: 'Ghar Ki Chai', creator: 'In-house', stage: 'Shoot' },
  { date: '2026-11-14', title: '5-minute desk workout', brand: 'Udaan Fitness', creator: 'Kabir Sen', stage: 'Editing' },
]

export const attention = [
  { kind: 'overdue' as const, title: 'SM/2026-27/0031 · Mama Bites', meta: '₹1,45,000 · 20 days overdue' },
  { kind: 'overdue' as const, title: 'SM/2026-27/0034 · Nila Handloom', meta: '₹1,30,000 · 6 days overdue' },
  { kind: 'blocked' as const, title: 'Udaan Fitness — music licence', meta: 'Blocked · waiting on brand legal' },
  { kind: 'payout' as const, title: 'Pay Meher Kaur', meta: '₹63,000 net · due 12 Nov 2026' },
]

export const myTasks = [
  { title: 'Send Kesar December content plan', due: '2026-11-10', done: false },
  { title: 'Confirm location for chai shoot', due: '2026-11-10', done: false },
  { title: 'Approve Asha’s script v2', due: '2026-11-09', done: true },
]

// ─── Brand detail (Mama Bites) ───────────────────────────────
export const brandDetail = {
  id: 'b1', name: 'Mama Bites', legalName: 'Mama Bites Foods Pvt. Ltd.', industry: 'D2C food',
  relationship: 'Project + retainer', status: 'active' as BrandStatus, owner: F1,
  city: 'Mumbai', state: 'Maharashtra', gstin: '27AAACM1234F1Z5', website: 'mamabites.example',
  instagram: '@mamabites.example', paymentTerms: 30, since: '2025-08-12',
  retainer: { title: 'Always-on social', monthlyFee: 120000, from: '2026-04-01', scope: '8 reels + 12 stories a month' },
  contacts: [
    { name: 'Priya Nair', role: 'Brand manager', email: 'priya@mamabites.example', primary: true },
    { name: 'Rohan Shah', role: 'Finance', email: 'accounts@mamabites.example', billing: true },
  ],
  campaigns: [
    { name: 'Diwali leftovers', status: 'live', period: '20 Oct – 15 Nov 2026', value: 450000, profit: 182000, creators: 6 },
    { name: 'Tiffin heroes', status: 'in_production', period: '01 Nov – 30 Nov 2026', value: 300000, profit: 118000, creators: 4 },
    { name: 'Monsoon snacking', status: 'completed', period: '10 Jul – 20 Aug 2026', value: 380000, profit: 151000, creators: 5 },
  ],
  invoices: [
    { number: 'SM/2026-27/0038', date: '2026-11-01', total: 141600, status: 'sent', due: '2026-12-01' },
    { number: 'SM/2026-27/0031', date: '2026-09-21', total: 295000, status: 'overdue', due: '2026-10-21', outstanding: 145000 },
    { number: 'SM/2026-27/0024', date: '2026-08-25', total: 448400, status: 'paid', due: '2026-09-24' },
  ],
  deliverables: [
    { title: 'Diwali leftovers reel', creator: 'Asha Rao', stage: 'Scheduled', goLive: '2026-11-10' },
    { title: 'Tiffin heroes — Ep 1', creator: 'Dev Malhotra', stage: 'Editing', goLive: '2026-11-18' },
    { title: 'Tiffin heroes — Ep 2', creator: 'Ira Menon', stage: 'Scripting', goLive: '2026-11-24' },
  ],
  activity: [
    { at: '2026-11-08T12:40:00Z', who: F1, text: 'moved “Diwali leftovers reel” to Scheduled', kind: 'status' },
    { at: '2026-11-07T09:12:00Z', who: F2, text: 'recorded ₹1,35,000 received (TDS ₹15,000) against SM/2026-27/0031', kind: 'money' },
    { at: '2026-11-01T05:30:00Z', who: F1, text: 'issued invoice SM/2026-27/0038 for ₹1,41,600', kind: 'create' },
    { at: '2026-10-29T10:02:00Z', who: F2, text: 'changed payment terms from 15 to 30 days', kind: 'update' },
    { at: '2026-10-20T06:00:00Z', who: F1, text: 'marked campaign “Monsoon snacking” Completed', kind: 'seal' },
  ],
}
