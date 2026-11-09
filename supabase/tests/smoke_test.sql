-- LOCAL TESTING ONLY: run after local_auth_stub.sql + all migrations.
-- Supabase grants these by default; plain Postgres needs them spelled out.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','founder1@example.com','{"full_name":"Founder One"}');
insert into auth.users values ('00000000-0000-0000-0000-00000000000b','newbie@example.com','{"full_name":"New Person"}');
select email, role, is_active from profiles order by email;

-- act as founder 1
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a', false);

insert into brands (id, name, status, state_code) values ('10000000-0000-0000-0000-000000000001','Mama Bites','lead','27');
update brands set status = 'active' where name = 'Mama Bites';
update brands set notes = 'Diwali push' where name = 'Mama Bites';
update brands set is_archived = true where name = 'Mama Bites';
update brands set is_archived = false where name = 'Mama Bites';
delete from brands where name = 'Mama Bites';             -- no delete policy → 0 rows
select count(*) as brands_still_there from brands;
select action, changed_fields, old_values, new_values, created_by is not null as has_actor
from activity_log where table_name = 'brands' order by created_at, id;

-- money flow
insert into money_accounts (id, name) values ('20000000-0000-0000-0000-000000000001','HDFC Current');
insert into capital_entries (kind, founder_id, account_id, entry_date, amount)
  values ('founder_contribution','00000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','2026-04-01',500000);
insert into campaigns (id, brand_id, name, status, contract_value) values
  ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Diwali reels','live',300000);
insert into invoices (id, brand_id, campaign_id, invoice_number, issue_date, due_date, status, place_of_supply_code)
  values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
          'SM/2026-27/0001', '2026-10-05','2026-10-20','sent','29');
insert into invoice_items (invoice_id, description, quantity, rate) values
  ('40000000-0000-0000-0000-000000000001','Reels x 4', 4, 50000),
  ('40000000-0000-0000-0000-000000000001','Stories', 1, 50000);
insert into receipts (id, brand_id, account_id, received_on, amount_received, tds_deducted)
  values ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','2026-10-25', 135000, 15000);
insert into receipt_allocations (receipt_id, invoice_id, amount) values
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',150000);
insert into creators (id, name) values ('60000000-0000-0000-0000-000000000001','Asha Rao');
insert into creator_payouts (id, creator_id, campaign_id, tds_rate, status, paid_on, account_id) values
  ('70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',10,'paid','2026-10-28','20000000-0000-0000-0000-000000000001');
insert into creator_payout_items (payout_id, description, amount) values ('70000000-0000-0000-0000-000000000001','4 reels',80000);
insert into expenses (category_id, campaign_id, description, expense_date, amount, gst_amount, status, paid_on, account_id)
  select id, '30000000-0000-0000-0000-000000000001','Studio day','2026-10-10',20000,3600,'paid','2026-10-10','20000000-0000-0000-0000-000000000001'
  from expense_categories where name = 'Studio & location';

select invoice_number, subtotal, gst_total, total, paid, outstanding, payment_status, is_interstate from invoice_totals;
select gross, tds, net_payable from creator_payout_totals;
select name, billed, received, outstanding, creator_cost, direct_expenses, profit, margin_pct from campaign_financials;
select name, balance from account_balances;
select * from period_summary('custom','2026-10-01','2026-10-31');
select p, b.* from unnest(array['this_week','last_week','this_month','last_month','this_quarter','last_quarter','this_fy','last_fy']) p,
  lateral period_bounds(p, null, null, '2027-02-15') b;

-- inactive member sees nothing and cannot write
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b', false);
select count(*) as brands_visible_to_inactive from brands;
\set ON_ERROR_STOP 0
insert into brands (name) values ('Sneaky');
update profiles set role = 'founder', is_active = true where id = '00000000-0000-0000-0000-00000000000b';
reset role;
select email, role, is_active from profiles order by email;
