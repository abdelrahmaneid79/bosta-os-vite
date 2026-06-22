-- =====================================================================
-- BostaOS — FACTORY RESET of business/user data
-- File: supabase/cleanup/factory_reset_business_data.sql
--
-- Empties ALL business/user-entered data so the app feels like a brand-new
-- install, while PRESERVING the schema, functions, triggers, RLS, auth, and
-- app code. Recreates ONLY the few defaults the app needs to boot that have no
-- in-app UI to recreate (a cash account, a sales channel, tolerance settings).
--
-- DESTRUCTIVE AND IRREVERSIBLE. Back up first if you might want the data
-- (Dashboard → Database → Backups, or `supabase db dump --data-only`).
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → New query → paste this whole
-- file → Run. It runs as one transaction: if anything fails it rolls back and
-- nothing changes.
--
-- WHAT IT DOES NOT TOUCH: tables/columns, functions, triggers, RLS policies,
-- the auth schema (your login user), migrations, or any app code.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) EMPTY every business/transactional table.
--    TRUNCATE (not DELETE) so it is fast, fires NO row triggers (the
--    settlement/WAC/money triggers stay quiet), and is FK-safe: every table is
--    listed together and CASCADE covers any remaining reference. RESTART
--    IDENTITY is a harmless no-op here — all primary keys are UUIDs, there are
--    no serial/identity sequences to reset.
-- ---------------------------------------------------------------------
truncate table
  -- sales + inventory + products
  sale_items, sales,
  purchase_batches,
  inventory_movements, physical_counts,
  products, product_aliases, product_categories,
  -- expenses
  expenses, expense_categories,
  -- money / settlement / cheques
  money_movements, cash_reconciliations,
  settlement_deductions, cheques, settlement_periods,
  money_accounts,
  -- imports
  import_rows, imports,
  -- payroll
  employee_compensation, employees,
  -- misc snapshots + reference data
  daily_snapshots, suppliers,
  location_terms, locations,
  channels,
  -- settings (re-seeded below)
  app_settings
  restart identity cascade;

-- audit_log only exists if migration 0011 has been applied — truncate it
-- conditionally so this script works whether or not 0011 is in place.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'audit_log'
  ) then
    execute 'truncate table audit_log restart identity';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) RE-SEED the minimum the app needs to boot. These two have NO in-app UI
--    to recreate, so they must exist for Cash and Sales to work.
-- ---------------------------------------------------------------------

-- The primary cash account (getPrimaryAccount expects one active account).
insert into money_accounts (name, opening_balance, current_balance)
  values ('Main Cash', 0, 0);

-- A sales channel (sales.channel_id is NOT NULL and there is no channels UI).
insert into channels (name, kind)
  values ('Physical Stand', 'physical');

-- ---------------------------------------------------------------------
-- 3) RE-SEED default app settings (reconciliation tolerances + count-variance
--    thresholds). These match the original migration seeds. NOTE: we do NOT
--    seed 'inventory_tracking_start_date' — leaving it unset keeps automatic
--    stock deduction OFF until you set your go-live date in
--    Settings → Inventory deduction (correct for a fresh install).
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('recon_tolerance_abs',                 '5'::jsonb),
  ('recon_tolerance_pct',                 '0.005'::jsonb),
  ('inventory_count_minor_variance_pct',  to_jsonb(2)),
  ('inventory_count_major_variance_pct',  to_jsonb(20));

-- ---------------------------------------------------------------------
-- 4) OPTIONAL — default expense categories.
--    Left EMPTY by default so you start truly blank and add your own in
--    Settings → Expense categories. (Expenses need at least one category, so
--    create one there before recording an expense.) To start with the standard
--    set instead, UNCOMMENT the block below before running.
-- ---------------------------------------------------------------------
-- insert into expense_categories (name, is_operating, sort_order) values
--   ('Boxes / Supplies', true, 1),
--   ('Salary',           true, 2),
--   ('Bonuses',          true, 3),
--   ('Transport',        true, 4),
--   ('Marketing',        true, 5),
--   ('Maintenance',      true, 6),
--   ('Other',            true, 7);

-- NOTE: locations + location_terms are intentionally LEFT EMPTY. Add your real
-- location in Settings → Locations and its rent / revenue-share in
-- Settings → Business terms before recording sales.

commit;

-- =====================================================================
-- 5) VERIFY — run this after the transaction commits. Every data table should
--    read 0; the three boot defaults should read exactly what's noted.
-- =====================================================================
select 'sales' as table_name, count(*) as rows from sales
union all select 'sale_items', count(*) from sale_items
union all select 'products', count(*) from products
union all select 'product_aliases', count(*) from product_aliases
union all select 'product_categories', count(*) from product_categories
union all select 'inventory_movements', count(*) from inventory_movements
union all select 'purchase_batches', count(*) from purchase_batches
union all select 'physical_counts', count(*) from physical_counts
union all select 'expenses', count(*) from expenses
union all select 'expense_categories (0 unless you uncommented seeds)', count(*) from expense_categories
union all select 'money_movements', count(*) from money_movements
union all select 'cash_reconciliations', count(*) from cash_reconciliations
union all select 'settlement_periods', count(*) from settlement_periods
union all select 'settlement_deductions', count(*) from settlement_deductions
union all select 'cheques', count(*) from cheques
union all select 'imports', count(*) from imports
union all select 'import_rows', count(*) from import_rows
union all select 'employees', count(*) from employees
union all select 'employee_compensation', count(*) from employee_compensation
union all select 'daily_snapshots', count(*) from daily_snapshots
union all select 'suppliers', count(*) from suppliers
union all select 'locations', count(*) from locations
union all select 'location_terms', count(*) from location_terms
union all select 'money_accounts  (expect 1)', count(*) from money_accounts
union all select 'channels        (expect 1)', count(*) from channels
union all select 'app_settings    (expect 4)', count(*) from app_settings
order by table_name;
