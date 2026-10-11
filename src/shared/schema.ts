/**
 * Single source of truth for entities: drives SQLite DDL, server validation,
 * field-level redaction, generic CRUD routes, web forms and table columns.
 */

export const ROLES = ['founder', 'finance', 'campaign_manager', 'talent_manager', 'editor', 'brand', 'creator'] as const;
export type Role = (typeof ROLES)[number];
export const INTERNAL_ROLES: Role[] = ['founder', 'finance', 'campaign_manager', 'talent_manager', 'editor'];

/** Capabilities. Server enforces them; the web app only uses them to hide controls. */
export type Cap =
  | 'admin' // users, settings, audit log, backups
  | 'finance' // bank accounts, cash, transactions, forecasts, recording payments
  | 'campaign_finance' // campaign budgets, invoices, obligations, margins (read)
  | 'identity' // PAN, GSTIN, bank/UPI details
  | 'rates' // creator/editor rates and commissions
  | 'talent' // edit influencers
  | 'sales' // edit brands, contacts, deals
  | 'campaigns' // edit campaigns, deliverables, rosters
  | 'content' // content tasks (editors limited to their own)
  | 'staff'; // any internal user

const CAPS: Record<Role, Cap[]> = {
  founder: ['admin', 'finance', 'campaign_finance', 'identity', 'rates', 'talent', 'sales', 'campaigns', 'content', 'staff'],
  finance: ['finance', 'campaign_finance', 'identity', 'rates', 'staff'],
  campaign_manager: ['campaign_finance', 'rates', 'sales', 'campaigns', 'content', 'staff'],
  talent_manager: ['rates', 'talent', 'sales', 'staff'],
  editor: ['content', 'staff'],
  brand: [],
  creator: [],
};

export function can(role: Role | undefined, cap: Cap): boolean {
  return !!role && CAPS[role].includes(cap);
}

export const ROLE_LABELS: Record<Role, string> = {
  founder: 'Founder / Admin',
  finance: 'Finance',
  campaign_manager: 'Campaign Manager',
  talent_manager: 'Talent Manager',
  editor: 'Editor',
  brand: 'Brand (external)',
  creator: 'Creator (external)',
};

export type FieldType =
  | 'text' | 'longtext' | 'email' | 'url' | 'int' | 'money' | 'percent'
  | 'date' | 'datetime' | 'bool' | 'enum' | 'ref' | 'json' | 'tags';

export interface Field {
  key: string;
  type: FieldType;
  label?: string;
  required?: boolean;
  options?: readonly string[];
  ref?: string;
  /** Capability needed to read (and write) this field. */
  sensitive?: Cap;
  /** Shown as a column by default. */
  list?: boolean;
  /** Not editable through generic forms. */
  readonly?: boolean;
  hint?: string;
  default?: unknown;
}

export interface Entity {
  key: string;
  label: string;
  plural: string;
  /** Field used as the record's display name. */
  title: string;
  fields: Field[];
  read: Cap;
  write: Cap;
  search?: string[];
  /** Internal table: no generic CRUD routes. */
  internal?: boolean;
  /** Extra SQL (indexes) run after the table exists. */
  sql?: string[];
}

const f = (key: string, type: FieldType, extra: Partial<Field> = {}): Field => ({ key, type, ...extra });
const ref = (key: string, entity: string, extra: Partial<Field> = {}): Field => ({ key, type: 'ref', ref: entity, ...extra });
const en = (key: string, options: readonly string[], extra: Partial<Field> = {}): Field => ({ key, type: 'enum', options, ...extra });

export const PLATFORMS = ['instagram', 'youtube', 'x', 'linkedin', 'facebook', 'snapchat', 'moj', 'josh', 'sharechat', 'other'] as const;
export const DEAL_STAGES = ['lead', 'contacted', 'brief_received', 'creator_shortlist', 'proposal_sent', 'negotiation', 'won', 'lost'] as const;
export const CAMPAIGN_STAGES = ['planning', 'creator_confirmation', 'production', 'internal_review', 'brand_approval', 'scheduled', 'live', 'reporting', 'financial_closure'] as const;
export const CONTENT_STAGES = ['brief_ready', 'footage_pending', 'editing', 'internal_review', 'changes_requested', 'brand_review', 'approved', 'delivered'] as const;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const TXN_CATEGORIES = {
  in: ['brand_payment', 'commission_income', 'other_income', 'founder_contribution', 'loan_received', 'refund_received', 'transfer_in', 'balance_adjustment_in', 'uncategorised_in'],
  out: ['creator_payout', 'editor_payout', 'vendor_payment', 'operating_expense', 'asset_purchase', 'tax_payment', 'founder_withdrawal', 'loan_repayment', 'refund_paid', 'bank_charges', 'transfer_out', 'balance_adjustment_out', 'uncategorised_out'],
} as const;

/** How each category is treated in earnings reporting. Transfers are never income or expense. */
export const TXN_GROUP: Record<string, 'collection' | 'financing' | 'transfer' | 'direct_cost' | 'opex' | 'capex' | 'tax' | 'adjustment' | 'other_income' | 'unclassified'> = {
  uncategorised_in: 'unclassified',
  uncategorised_out: 'unclassified',
  brand_payment: 'collection',
  commission_income: 'collection',
  other_income: 'other_income',
  refund_received: 'adjustment',
  founder_contribution: 'financing',
  founder_withdrawal: 'financing',
  loan_received: 'financing',
  loan_repayment: 'financing',
  transfer_in: 'transfer',
  transfer_out: 'transfer',
  creator_payout: 'direct_cost',
  editor_payout: 'direct_cost',
  vendor_payment: 'direct_cost',
  operating_expense: 'opex',
  bank_charges: 'opex',
  asset_purchase: 'capex',
  tax_payment: 'tax',
  refund_paid: 'adjustment',
  balance_adjustment_in: 'adjustment',
  balance_adjustment_out: 'adjustment',
};

export const OBLIGATION_CATEGORIES = [
  'creator_payout', 'editor_payout', 'vendor_payment', 'operating_expense', 'salary', 'rent', 'subscription',
  'asset_purchase', 'tax', 'loan_repayment', 'founder_withdrawal', 'other',
] as const;

/** Obligation category -> transaction category used when it is paid. */
export const OBLIGATION_TXN_CATEGORY: Record<string, string> = {
  creator_payout: 'creator_payout',
  editor_payout: 'editor_payout',
  vendor_payment: 'vendor_payment',
  operating_expense: 'operating_expense',
  salary: 'operating_expense',
  rent: 'operating_expense',
  subscription: 'operating_expense',
  asset_purchase: 'asset_purchase',
  tax: 'tax_payment',
  loan_repayment: 'loan_repayment',
  founder_withdrawal: 'founder_withdrawal',
  other: 'operating_expense',
};

export const ENTITIES: Entity[] = [
  {
    key: 'users', label: 'User', plural: 'Users', title: 'name', read: 'staff', write: 'admin', search: ['name', 'email'],
    fields: [
      f('name', 'text', { required: true, list: true }),
      f('email', 'email', { required: true, list: true }),
      en('role', ROLES, { required: true, list: true }),
      en('status', ['active', 'disabled'], { default: 'active', list: true }),
      f('title', 'text'),
      f('phone', 'text'),
      ref('editor_id', 'editors', { label: 'Linked editor profile', hint: 'For editor logins' }),
      ref('influencer_id', 'influencers', { label: 'Linked creator', hint: 'For creator portal logins' }),
      ref('brand_id', 'brands', { label: 'Linked brand', hint: 'For brand portal logins' }),
      f('password_hash', 'text', { readonly: true, sensitive: 'admin' }),
      f('failed_logins', 'int', { readonly: true, sensitive: 'admin' }),
      f('locked_until', 'datetime', { readonly: true, sensitive: 'admin' }),
      f('last_login_at', 'datetime', { readonly: true, list: true }),
      f('prefs', 'json', { readonly: true, sensitive: 'admin' }),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users(lower(email))'],
  },
  {
    key: 'influencers', label: 'Influencer', plural: 'Influencers', title: 'name', read: 'staff', write: 'talent',
    search: ['name', 'handle', 'city', 'niches', 'tags', 'languages'],
    fields: [
      f('name', 'text', { required: true, list: true }),
      f('handle', 'text', { list: true, hint: 'Primary handle, e.g. @ananya.eats' }),
      f('photo_url', 'url', { label: 'Photo URL', hint: 'Or upload a photo on the creator page (used in media kits)' }),
      f('photo_file', 'text', { readonly: true, label: 'Uploaded photo' }),
      en('relationship', ['exclusive', 'non_exclusive', 'campaign_only', 'prospect', 'inactive', 'agency_owned'], { required: true, default: 'prospect', list: true, hint: 'agency_owned = a Socialmog account tracked for analytics' }),
      ref('manager_id', 'users', { label: 'Talent manager', list: true }),
      f('niches', 'tags', { list: true }),
      f('tags', 'tags'),
      f('languages', 'tags'),
      f('city', 'text', { list: true }),
      f('state', 'text'),
      f('email', 'email'),
      f('phone', 'text'),
      f('platforms', 'json', { hint: 'Platform links and headline metrics, each with source and last-updated date' }),
      f('audience', 'json', { hint: 'Audience split with source and as-of date' }),
      f('agreement_start', 'date'),
      f('agreement_end', 'date', { list: true }),
      f('renewal_reminder_days', 'int', { default: 30 }),
      en('availability', ['available', 'limited', 'unavailable'], { default: 'available', list: true }),
      f('availability_notes', 'text'),
      f('rate_card', 'json', { sensitive: 'rates', hint: 'Rates by deliverable' }),
      en('commission_type', ['percentage', 'fixed', 'none'], { sensitive: 'rates', default: 'percentage' }),
      f('commission_rate', 'percent', { sensitive: 'rates', label: 'Commission %' }),
      f('commission_fixed', 'money', { sensitive: 'rates', label: 'Fixed commission' }),
      f('commission_notes', 'text', { sensitive: 'rates' }),
      f('brand_preferences', 'longtext'),
      f('conflicts', 'longtext', { label: 'Conflicts / existing brand ties' }),
      f('exclusivity_restrictions', 'longtext'),
      f('unsuitable_categories', 'tags'),
      f('internal_notes', 'longtext'),
      f('pan', 'text', { sensitive: 'identity', label: 'PAN' }),
      f('gstin', 'text', { sensitive: 'identity', label: 'GSTIN' }),
      f('upi_id', 'text', { sensitive: 'identity', label: 'UPI ID' }),
      f('bank_details', 'longtext', { sensitive: 'identity' }),
    ],
  },
  {
    key: 'brands', label: 'Brand', plural: 'Brands & Leads', title: 'name', read: 'staff', write: 'sales',
    search: ['name', 'industry', 'tags', 'categories'],
    fields: [
      f('name', 'text', { required: true, list: true }),
      en('status', ['lead', 'prospect', 'active', 'past', 'inactive'], { default: 'lead', list: true }),
      f('industry', 'text', { list: true }),
      f('categories', 'tags', { hint: 'Product categories, used for creator conflict checks' }),
      ref('owner_id', 'users', { label: 'Owner', list: true }),
      f('website', 'url'),
      f('instagram_url', 'url', { label: 'Instagram' }),
      f('follow_up_date', 'date', { list: true }),
      f('budget_min', 'money', { label: 'Budget expectation (min)' }),
      f('budget_max', 'money', { label: 'Budget expectation (max)' }),
      f('payment_terms_days', 'int', { label: 'Payment terms (days)', default: 30 }),
      f('payment_terms', 'text'),
      f('billing_name', 'text', { sensitive: 'campaign_finance' }),
      f('billing_address', 'longtext', { sensitive: 'campaign_finance' }),
      f('gstin', 'text', { sensitive: 'campaign_finance', label: 'GSTIN' }),
      f('tags', 'tags'),
      f('notes', 'longtext'),
    ],
  },
  {
    key: 'contacts', label: 'Contact', plural: 'Contacts', title: 'name', read: 'staff', write: 'sales', search: ['name', 'email'],
    fields: [
      ref('brand_id', 'brands', { required: true, list: true }),
      f('name', 'text', { required: true, list: true }),
      f('title', 'text', { list: true }),
      f('email', 'email', { list: true }),
      f('phone', 'text', { list: true }),
      f('is_primary', 'bool'),
      f('notes', 'longtext'),
    ],
  },
  {
    key: 'deals', label: 'Deal', plural: 'Deals', title: 'title', read: 'staff', write: 'sales', search: ['title'],
    fields: [
      f('title', 'text', { required: true, list: true }),
      ref('brand_id', 'brands', { required: true, list: true }),
      ref('contact_id', 'contacts'),
      ref('owner_id', 'users', { label: 'Owner', list: true }),
      en('stage', DEAL_STAGES, { required: true, default: 'lead', list: true }),
      en('billing_model', ['gross', 'commission'], { required: true, default: 'gross', hint: 'gross: we bill the brand and pay creators. commission: creator is paid directly, we earn a commission.' }),
      f('brand_price', 'money', { label: 'Proposed brand price', list: true }),
      f('creators', 'json', { sensitive: 'rates', hint: 'Creator commitments: influencer, fee, deliverables' }),
      f('agency_fee', 'money', { sensitive: 'rates', label: 'Agency fee / commission' }),
      en('commission_payer', ['creator', 'brand'], { default: 'creator', hint: 'Commission deals: who pays our commission' }),
      f('editor_costs', 'money', { sensitive: 'rates' }),
      f('other_costs', 'money', { sensitive: 'rates' }),
      f('deliverables', 'longtext'),
      f('usage_rights', 'text'),
      f('exclusivity', 'text'),
      f('revisions_included', 'int', { default: 2 }),
      f('deadline', 'date'),
      f('payment_milestones', 'json', { hint: 'e.g. 50% on signing, 50% within 30 days of delivery' }),
      f('probability', 'int', { label: 'Probability %', default: 20, list: true }),
      f('expected_close', 'date', { list: true }),
      f('next_action', 'text', { list: true }),
      f('next_action_date', 'date', { list: true }),
      f('loss_reason', 'text'),
      f('brief', 'longtext'),
      f('source', 'text'),
      ref('campaign_id', 'campaigns', { readonly: true, label: 'Converted to campaign' }),
      f('notes', 'longtext'),
    ],
  },
  {
    key: 'campaigns', label: 'Campaign', plural: 'Campaigns', title: 'name', read: 'staff', write: 'campaigns', search: ['name', 'objective'],
    fields: [
      f('name', 'text', { required: true, list: true }),
      ref('brand_id', 'brands', { required: true, list: true }),
      ref('deal_id', 'deals', { readonly: true }),
      ref('owner_id', 'users', { label: 'Campaign owner', list: true }),
      en('stage', CAMPAIGN_STAGES, { required: true, default: 'planning', list: true }),
      en('billing_model', ['gross', 'commission'], { required: true, default: 'gross' }),
      f('objective', 'text'),
      f('brief', 'longtext'),
      f('start_date', 'date', { list: true }),
      f('end_date', 'date', { list: true }),
      f('client_budget', 'money', { label: 'Total client budget', list: true, sensitive: 'campaign_finance' }),
      f('agency_fee', 'money', { label: 'Planned agency fee', sensitive: 'campaign_finance' }),
      f('contingency', 'money', { sensitive: 'campaign_finance' }),
      f('budget_plan', 'json', { sensitive: 'campaign_finance', label: 'Planned allocation', hint: 'Planned spend by category' }),
      f('gross_deal_value', 'money', { sensitive: 'campaign_finance', hint: 'Commission deals: amount brand pays creators directly (not our billing)' }),
      f('kpi_targets', 'json', { label: 'Agreed targets' }),
      f('scope_changes', 'json', { sensitive: 'campaign_finance' }),
      f('lessons', 'longtext'),
      f('notes', 'longtext'),
      f('live_at', 'date', { readonly: true }),
      f('closed_at', 'date', { readonly: true }),
    ],
  },
  {
    key: 'campaign_creators', label: 'Campaign creator', plural: 'Campaign roster', title: 'influencer_id', read: 'staff', write: 'campaigns',
    fields: [
      ref('campaign_id', 'campaigns', { required: true, list: true }),
      ref('influencer_id', 'influencers', { required: true, list: true }),
      en('status', ['proposed', 'confirmed', 'dropped'], { default: 'proposed', list: true }),
      f('fee', 'money', { sensitive: 'rates', list: true, label: 'Negotiated cost', hint: 'Creates a payable when confirmed (gross campaigns)' }),
      f('payout_due', 'date', { label: 'Payout due', list: true }),
      f('payment_terms', 'text'),
      f('notes', 'text'),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_cc ON campaign_creators(campaign_id, influencer_id)'],
  },
  {
    key: 'deliverables', label: 'Deliverable', plural: 'Deliverables', title: 'title', read: 'staff', write: 'campaigns', search: ['title'],
    fields: [
      ref('campaign_id', 'campaigns', { required: true, list: true }),
      ref('influencer_id', 'influencers', { required: true, list: true }),
      f('title', 'text', { required: true, list: true }),
      en('type', ['reel', 'story', 'post', 'carousel', 'youtube_video', 'short', 'live', 'ugc', 'other'], { default: 'reel', list: true }),
      en('platform', PLATFORMS, { default: 'instagram' }),
      en('status', ['planned', 'in_production', 'internal_review', 'brand_review', 'approved', 'scheduled', 'live', 'cancelled'], { default: 'planned', list: true }),
      f('due_date', 'date', { list: true }),
      f('publish_date', 'date', { label: 'Published on' }),
      f('live_url', 'url', { label: 'Live link' }),
      f('revisions_allowed', 'int', { default: 2 }),
      f('metrics', 'json', { hint: 'Results with source and as-of date' }),
      f('notes', 'longtext'),
    ],
  },
  {
    key: 'editors', label: 'Editor', plural: 'Editors', title: 'name', read: 'staff', write: 'campaigns', search: ['name', 'skills'],
    fields: [
      f('name', 'text', { required: true, list: true }),
      f('skills', 'tags', { list: true }),
      en('availability', ['available', 'busy', 'unavailable'], { default: 'available', list: true }),
      f('capacity_per_week', 'int', { label: 'Capacity (tasks/week)', default: 5, list: true }),
      f('email', 'email'),
      f('phone', 'text'),
      f('portfolio_url', 'url'),
      f('location', 'text'),
      en('rate_type', ['per_video', 'per_hour', 'per_minute', 'retainer'], { sensitive: 'rates', default: 'per_video' }),
      f('rate', 'money', { sensitive: 'rates', list: true }),
      f('extra_revision_rate', 'money', { sensitive: 'rates' }),
      f('notes', 'longtext'),
      f('pan', 'text', { sensitive: 'identity', label: 'PAN' }),
      f('upi_id', 'text', { sensitive: 'identity', label: 'UPI ID' }),
      f('bank_details', 'longtext', { sensitive: 'identity' }),
    ],
  },
  {
    key: 'content_tasks', label: 'Content task', plural: 'Content', title: 'title', read: 'content', write: 'content', search: ['title'],
    fields: [
      f('title', 'text', { required: true, list: true }),
      ref('campaign_id', 'campaigns', { list: true }),
      ref('deliverable_id', 'deliverables'),
      ref('influencer_id', 'influencers', { label: 'Creator', list: true }),
      ref('editor_id', 'editors', { list: true }),
      ref('reviewer_id', 'users', { label: 'Reviewer' }),
      en('stage', CONTENT_STAGES, { required: true, default: 'brief_ready', list: true }),
      en('priority', PRIORITIES, { default: 'normal', list: true }),
      f('due_date', 'date', { list: true }),
      f('brief', 'longtext'),
      f('reference_links', 'tags', { hint: 'Reference URLs' }),
      f('raw_footage_links', 'tags', { hint: 'Drive/Frame.io links to raw footage' }),
      f('output_specs', 'text', { hint: 'e.g. 9:16, 1080x1920, 30–45s, captions burned in' }),
      f('script', 'longtext', { readonly: true }),
      f('caption', 'longtext', { readonly: true }),
      f('checklist', 'json'),
      f('depends_on', 'json', { label: 'Depends on (task ids)' }),
      f('blocked_reason', 'text'),
      f('revision_allowance', 'int', { default: 2 }),
      f('extra_revision_cost', 'money', { sensitive: 'rates' }),
      f('editor_fee', 'money', { sensitive: 'rates', hint: 'Creates an editor payable' }),
      f('versions', 'json', { readonly: true }),
      f('final_url', 'url', { label: 'Final delivery link' }),
      f('published_url', 'url'),
      f('delivered_at', 'datetime', { readonly: true }),
    ],
  },
  {
    key: 'tasks', label: 'Task', plural: 'Tasks', title: 'title', read: 'staff', write: 'staff', search: ['title', 'description'],
    fields: [
      f('title', 'text', { required: true, list: true }),
      f('description', 'longtext'),
      ref('owner_id', 'users', { label: 'Owner', list: true }),
      en('status', ['todo', 'in_progress', 'blocked', 'done'], { default: 'todo', list: true }),
      en('priority', PRIORITIES, { default: 'normal', list: true }),
      f('due_date', 'date', { list: true }),
      en('recurrence', ['none', 'daily', 'weekly', 'monthly'], { default: 'none' }),
      f('related_type', 'text', { hint: 'campaigns, deals, influencers…' }),
      f('related_id', 'int'),
      f('checklist', 'json'),
      f('depends_on', 'json', { label: 'Depends on (task ids)' }),
      f('completed_at', 'datetime', { readonly: true }),
      f('recurrence_of', 'int', { readonly: true }),
    ],
  },
  {
    key: 'documents', label: 'Document', plural: 'Documents', title: 'title', read: 'staff', write: 'staff', search: ['title', 'kind'],
    fields: [
      f('title', 'text', { required: true, list: true }),
      en('kind', ['contract', 'brief', 'proposal', 'creator_agreement', 'invoice', 'receipt', 'report', 'template', 'other'], { default: 'other', list: true }),
      f('url', 'url', { label: 'External link', hint: 'Drive/Dropbox link, or upload a file' }),
      f('file', 'text', { readonly: true }),
      f('mime', 'text', { readonly: true }),
      f('size', 'int', { readonly: true }),
      f('entity_type', 'text', { label: 'Linked to', list: true }),
      f('entity_id', 'int', { label: 'Linked record id' }),
      f('expiry_date', 'date', { list: true }),
      f('reminder_days', 'int', { default: 30 }),
      en('visibility', ['internal', 'brand', 'creator'], { default: 'internal', list: true }),
      f('body', 'longtext', { label: 'Template body', hint: 'Use {{brand}}, {{campaign}}, {{creator}}, {{date}}, {{amount}}' }),
      f('notes', 'text'),
    ],
  },
  {
    key: 'accounts', label: 'Account', plural: 'Accounts', title: 'name', read: 'finance', write: 'finance',
    fields: [
      f('name', 'text', { required: true, list: true }),
      en('type', ['bank', 'cash', 'wallet', 'upi', 'other'], { required: true, default: 'bank', list: true }),
      f('institution', 'text', { list: true }),
      f('last4', 'text', { label: 'Account no. (last 4)' }),
      f('opening_balance', 'money', { required: true, default: 0 }),
      f('opening_date', 'date', { required: true }),
      f('active', 'bool', { default: true, list: true }),
      f('notes', 'text'),
    ],
  },
  {
    key: 'invoices', label: 'Receivable', plural: 'Receivables & invoices', title: 'label', read: 'campaign_finance', write: 'finance',
    search: ['label', 'number', 'payer_name'],
    fields: [
      f('label', 'text', { required: true, list: true, hint: 'e.g. Advance 50%' }),
      en('kind', ['brand_billing', 'commission', 'other'], { required: true, default: 'brand_billing', list: true }),
      en('status', ['scheduled', 'issued', 'cancelled'], { default: 'scheduled', list: true, hint: 'scheduled = payment milestone not yet invoiced' }),
      f('number', 'text', { label: 'Invoice no.', list: true }),
      en('payer_type', ['brand', 'influencer', 'other'], { default: 'brand' }),
      ref('brand_id', 'brands', { list: true }),
      ref('influencer_id', 'influencers'),
      f('payer_name', 'text'),
      ref('campaign_id', 'campaigns', { list: true }),
      ref('deal_id', 'deals'),
      f('issue_date', 'date'),
      f('due_date', 'date', { required: true, list: true }),
      f('expected_date', 'date', { required: true, list: true, hint: 'When you realistically expect the money (used by forecasts)' }),
      en('confidence', ['confirmed', 'expected', 'at_risk', 'delayed'], { required: true, default: 'expected', list: true }),
      f('subtotal', 'money', { required: true, label: 'Amount (excl. tax)' }),
      f('tax', 'money', { default: 0, label: 'GST / tax' }),
      f('total', 'money', { readonly: true, list: true }),
      f('notes', 'text'),
      f('cancel_reason', 'text', { readonly: true }),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_number ON invoices(number) WHERE number IS NOT NULL'],
  },
  {
    key: 'obligations', label: 'Payable', plural: 'Payables & obligations', title: 'description', read: 'campaign_finance', write: 'finance',
    search: ['description', 'payee_name'],
    fields: [
      f('description', 'text', { required: true, list: true }),
      en('category', OBLIGATION_CATEGORIES, { required: true, default: 'creator_payout', list: true }),
      en('payee_type', ['influencer', 'editor', 'vendor', 'other'], { default: 'other' }),
      ref('influencer_id', 'influencers'),
      ref('editor_id', 'editors'),
      f('payee_name', 'text', { list: true }),
      ref('campaign_id', 'campaigns', { list: true }),
      ref('content_task_id', 'content_tasks'),
      ref('asset_id', 'assets'),
      f('amount', 'money', { required: true, list: true }),
      f('due_date', 'date', { required: true, list: true }),
      en('status', ['planned', 'committed', 'approved', 'on_hold', 'cancelled'], { default: 'committed', list: true }),
      en('priority', ['critical', 'high', 'normal', 'low'], { default: 'normal' }),
      en('repeat', ['none', 'monthly', 'quarterly', 'yearly'], { default: 'none', hint: 'Recurring expense: next occurrence is created when this one is settled' }),
      f('source', 'text', { readonly: true }),
      f('notes', 'text'),
      f('cancel_reason', 'text', { readonly: true }),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_obligation_source ON obligations(source) WHERE source IS NOT NULL AND status <> \'cancelled\''],
  },
  {
    key: 'assets', label: 'Asset', plural: 'Assets', title: 'name', read: 'staff', write: 'finance', search: ['name', 'serial_number', 'custodian'],
    fields: [
      f('name', 'text', { required: true, list: true }),
      en('category', ['camera', 'lens', 'audio', 'lighting', 'computer', 'phone', 'software_subscription', 'furniture', 'other'], { default: 'camera', list: true }),
      en('status', ['active', 'in_repair', 'lost', 'sold', 'retired'], { default: 'active', list: true }),
      f('purchase_date', 'date', { list: true }),
      f('cost', 'money', { list: true, sensitive: 'campaign_finance' }),
      ref('account_id', 'accounts', { label: 'Paid from', sensitive: 'finance' }),
      f('vendor', 'text'),
      f('serial_number', 'text'),
      f('custodian', 'text', { list: true }),
      f('location', 'text'),
      f('warranty_until', 'date'),
      f('next_maintenance', 'date'),
      f('renewal_date', 'date', { list: true, hint: 'Subscriptions / insurance' }),
      ref('campaign_id', 'campaigns', { label: 'Funded by campaign allocation' }),
      f('useful_life_months', 'int', { hint: 'Optional, for depreciation' }),
      f('events', 'json', { readonly: true }),
      f('notes', 'longtext'),
    ],
  },
  {
    key: 'report_templates', label: 'Report template', plural: 'Report templates', title: 'name', read: 'staff', write: 'staff',
    fields: [
      f('name', 'text', { required: true, list: true }),
      en('report_type', ['finance', 'founder', 'campaign', 'influencer_growth', 'brand_statement', 'creator_statement', 'editor_summary', 'expenses', 'asset_register', 'deal_pipeline'], { required: true, list: true }),
      en('audience', ['internal', 'external'], { default: 'internal', list: true }),
      f('params', 'json'),
      en('schedule', ['none', 'weekly', 'monthly'], { default: 'none', list: true }),
      f('last_run_key', 'text', { readonly: true }),
    ],
  },

  // ---- internal tables (no generic CRUD) ----
  {
    key: 'transactions', label: 'Transaction', plural: 'Transactions', title: 'description', read: 'finance', write: 'finance', internal: true,
    fields: [
      ref('account_id', 'accounts', { required: true }),
      f('txn_date', 'date', { required: true }),
      en('direction', ['in', 'out'], { required: true }),
      f('amount', 'money', { required: true }),
      f('category', 'text', { required: true }),
      f('description', 'text'),
      f('counterparty_type', 'text'),
      f('counterparty_id', 'int'),
      f('counterparty_name', 'text'),
      ref('campaign_id', 'campaigns'),
      ref('asset_id', 'assets'),
      f('reference', 'text'),
      f('method', 'text'),
      f('transfer_group', 'text'),
      f('reversal_of_id', 'int'),
      f('reversed_by_id', 'int'),
      en('reconciliation', ['unreconciled', 'reconciled', 'flagged'], { default: 'unreconciled' }),
      f('import_fingerprint', 'text'),
      f('idempotency_key', 'text'),
      ref('receipt_document_id', 'documents'),
      f('notes', 'text'),
    ],
    sql: [
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_txn_idem ON transactions(idempotency_key) WHERE idempotency_key IS NOT NULL',
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_txn_import ON transactions(account_id, import_fingerprint) WHERE import_fingerprint IS NOT NULL',
      // A bank/UPI reference identifies one movement; a reversed transaction frees its reference.
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_txn_ref ON transactions(account_id, direction, reference) WHERE reference IS NOT NULL AND reversal_of_id IS NULL AND reversed_by_id IS NULL',
      'CREATE INDEX IF NOT EXISTS ix_txn_date ON transactions(txn_date)',
    ],
  },
  {
    key: 'settlements', label: 'Settlement', plural: 'Settlements', title: 'id', read: 'campaign_finance', write: 'finance', internal: true,
    fields: [
      ref('invoice_id', 'invoices'),
      ref('obligation_id', 'obligations'),
      ref('transaction_id', 'transactions'),
      en('kind', ['cash', 'tds', 'write_off', 'waiver']),
      f('amount', 'money', { required: true }),
      f('settled_on', 'date', { required: true }),
      f('reason', 'text'),
      f('reversed_at', 'datetime'),
      f('reversed_reason', 'text'),
    ],
  },
  {
    key: 'earmarks', label: 'Earmark', plural: 'Earmarks', title: 'label', read: 'finance', write: 'finance', internal: true,
    fields: [
      en('target_type', ['obligation', 'campaign', 'reserve']),
      ref('obligation_id', 'obligations'),
      ref('campaign_id', 'campaigns'),
      f('label', 'text'),
      f('amount', 'money', { required: true }),
      f('protected', 'bool', { hint: 'Reserve kept untouched in forecasts' }),
      en('status', ['active', 'released', 'consumed']),
      f('reason', 'text'),
      f('ended_at', 'datetime'),
      f('end_reason', 'text'),
      f('supersedes_id', 'int'),
    ],
  },
  {
    key: 'purchase_simulations', label: 'Purchase simulation', plural: 'Purchase simulations', title: 'label', read: 'finance', write: 'finance', internal: true,
    fields: [
      f('label', 'text'),
      f('amount', 'money'),
      f('purchase_date', 'date'),
      f('scenario', 'json'),
      f('result', 'json'),
      en('decision', ['simulated', 'proceed', 'override', 'cancelled']),
      f('reason', 'text'),
      ref('obligation_id', 'obligations'),
    ],
  },
  {
    key: 'comments', label: 'Comment', plural: 'Comments', title: 'body', read: 'staff', write: 'staff', internal: true,
    fields: [
      f('entity_type', 'text', { required: true }),
      f('entity_id', 'int', { required: true }),
      en('kind', ['comment', 'note', 'call', 'email', 'meeting', 'whatsapp', 'approval', 'feedback']),
      f('body', 'longtext'),
      f('meta', 'json'),
      ref('user_id', 'users'),
      f('follow_up_date', 'date'),
    ],
    sql: ['CREATE INDEX IF NOT EXISTS ix_comments_entity ON comments(entity_type, entity_id)'],
  },
  {
    key: 'notifications', label: 'Notification', plural: 'Notifications', title: 'title', read: 'staff', write: 'staff', internal: true,
    fields: [
      ref('user_id', 'users'),
      f('kind', 'text'),
      f('title', 'text'),
      f('body', 'text'),
      f('link', 'text'),
      f('read_at', 'datetime'),
      f('dedupe_key', 'text'),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_notif ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL'],
  },
  {
    key: 'social_accounts', label: 'Social account', plural: 'Connected accounts', title: 'username', read: 'staff', write: 'talent', internal: true,
    fields: [
      ref('influencer_id', 'influencers'),
      f('platform', 'text'),
      f('username', 'text'),
      f('external_user_id', 'text'),
      en('status', ['not_connected', 'invited', 'connected', 'expired', 'error', 'revoked']),
      f('token_enc', 'text'),
      f('token_expires_at', 'datetime'),
      f('scopes', 'text'),
      f('available_metrics', 'json'),
      f('last_sync_at', 'datetime'),
      f('last_sync_status', 'text'),
      f('last_error', 'text'),
      f('invite_token_hash', 'text'),
      f('invite_expires_at', 'datetime'),
    ],
  },
  {
    key: 'analytics_snapshots', label: 'Weekly snapshot', plural: 'Weekly snapshots', title: 'period_start', read: 'staff', write: 'talent', internal: true,
    fields: [
      ref('influencer_id', 'influencers', { required: true }),
      f('platform', 'text', { required: true }),
      f('period_start', 'date', { required: true }),
      f('period_end', 'date', { required: true }),
      f('metrics', 'json'),
      f('source', 'text'),
      f('notes', 'text'),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_snapshot ON analytics_snapshots(influencer_id, platform, period_start)'],
  },
  {
    key: 'posts', label: 'Post', plural: 'Content performance', title: 'permalink', read: 'staff', write: 'talent', internal: true,
    fields: [
      ref('influencer_id', 'influencers', { required: true }),
      f('platform', 'text'),
      f('external_id', 'text'),
      f('permalink', 'url'),
      f('published_at', 'datetime'),
      f('format', 'text'),
      f('topic', 'text'),
      f('duration_sec', 'int'),
      f('caption', 'text'),
      en('promotion', ['organic', 'paid', 'unknown']),
      ref('campaign_id', 'campaigns'),
      f('metrics', 'json'),
      f('source', 'text'),
      f('metrics_as_of', 'datetime'),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_post ON posts(influencer_id, platform, external_id) WHERE external_id IS NOT NULL'],
  },
  {
    key: 'weekly_reports', label: 'Weekly report', plural: 'Weekly reports', title: 'period_start', read: 'staff', write: 'talent', internal: true,
    fields: [
      ref('influencer_id', 'influencers'),
      f('period_start', 'date'),
      f('version', 'int'),
      f('content', 'json'),
      f('manager_notes', 'longtext'),
      f('founder_notes', 'longtext'),
      f('checklist', 'json'),
      f('ai_status', 'text'),
      f('ai_model', 'text'),
      f('trigger', 'text'),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_weekly ON weekly_reports(coalesce(influencer_id, 0), period_start, version)'],
  },
  {
    key: 'report_runs', label: 'Report', plural: 'Reports', title: 'report_type', read: 'staff', write: 'staff', internal: true,
    fields: [
      f('report_type', 'text'),
      f('audience', 'text'),
      f('params', 'json'),
      en('status', ['queued', 'running', 'completed', 'failed']),
      f('progress', 'int'),
      f('attempts', 'int'),
      f('error', 'text'),
      f('file', 'text'),
      f('csv_file', 'text'),
      f('snapshot', 'json'),
      f('version', 'int'),
      ref('template_id', 'report_templates'),
      f('title', 'text'),
      f('finished_at', 'datetime'),
    ],
  },
  {
    key: 'jobs', label: 'Job', plural: 'Jobs', title: 'kind', read: 'admin', write: 'admin', internal: true,
    fields: [
      f('kind', 'text'),
      f('unique_key', 'text'),
      f('payload', 'json'),
      en('status', ['queued', 'running', 'completed', 'failed']),
      f('attempts', 'int'),
      f('run_at', 'datetime'),
      f('last_error', 'text'),
      f('finished_at', 'datetime'),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs ON jobs(unique_key) WHERE unique_key IS NOT NULL'],
  },
  {
    key: 'ai_exports', label: 'ChatGPT package', plural: 'ChatGPT packages', title: 'export_key', read: 'staff', write: 'staff', internal: true,
    fields: [
      f('export_key', 'text'),
      f('analysis_type', 'text'),
      f('params', 'json'),
      f('package', 'json'),
      f('record_versions', 'json'),
      f('trigger', 'text'),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_export ON ai_exports(export_key)'],
  },
  {
    key: 'ai_imports', label: 'ChatGPT import', plural: 'ChatGPT imports', title: 'result_id', read: 'staff', write: 'staff', internal: true,
    fields: [
      f('export_key', 'text'),
      f('result_id', 'text'),
      f('analysis_type', 'text'),
      en('status', ['previewed', 'applied', 'undone']),
      f('result', 'json'),
      f('applied', 'json'),
      f('applied_at', 'datetime'),
      f('undone_at', 'datetime'),
      f('notes', 'json'),
    ],
    sql: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_import ON ai_imports(export_key, result_id)'],
  },
  {
    key: 'ai_analyses', label: 'ChatGPT analysis', plural: 'ChatGPT analyses', title: 'summary', read: 'staff', write: 'staff', internal: true,
    fields: [
      ref('import_id', 'ai_imports'),
      f('export_key', 'text'),
      f('analysis_type', 'text'),
      f('records', 'json'),
      f('period_start', 'date'),
      f('period_end', 'date'),
      f('summary', 'longtext'),
      f('observations', 'json'),
      f('derived', 'json'),
      f('recommendations', 'json'),
      f('missing', 'json'),
      f('assumptions', 'json'),
      f('limitations', 'json'),
      f('provenance', 'json'),
      f('connector', 'json'),
      f('on_dashboard', 'bool'),
      f('shareable', 'bool'),
      en('status', ['active', 'undone']),
    ],
  },
  {
    key: 'audit_log', label: 'Audit entry', plural: 'Audit log', title: 'action', read: 'admin', write: 'admin', internal: true,
    fields: [
      ref('user_id', 'users'),
      f('action', 'text'),
      f('entity', 'text'),
      f('entity_id', 'int'),
      f('before', 'json'),
      f('after', 'json'),
      f('note', 'text'),
    ],
    sql: ['CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity, entity_id)'],
  },
];

export const ENTITY: Record<string, Entity> = Object.fromEntries(ENTITIES.map((e) => [e.key, e]));

export function humanize(key: string): string {
  const s = key.replace(/_id$/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fieldLabel(field: Field): string {
  return field.label ?? humanize(field.key);
}

/** Fields of an entity the role may read. */
export function visibleFields(entity: Entity, role: Role | undefined): Field[] {
  return entity.fields.filter((fl) => !fl.sensitive || can(role, fl.sensitive));
}
