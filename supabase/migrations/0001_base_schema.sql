-- =====================================================================
-- BostaOS — Phase 1 schema migration (Supabase / Postgres)
-- Implements BostaOS_Phase1_Build_Contract.md (21 tables).
-- Model A: Hyper Hub POS records sales & collects money; monthly cheque
-- settles revenue net of rent + 3%. Costing/inventory = Phase 2 (not here).
--
-- Conventions:
--  * Money numeric(14,2) EGP; weight numeric(14,3) grams.
--  * Financial tables carry: created_at, updated_at, edited_at, voided_at,
--    void_reason. (record_edits before-images deferred.)
--  * VAT-tolerant: tax_amount/tax_rate default 0; no VAT logic in Phase 1.
--  * Ledgers are truth; products.avg_cost/current_stock columns exist but
--    stay 0 until Phase 2. Inventory & import tables are NOT created here.
--  * Run in the Supabase SQL editor / via CLI. Not executed in this chat.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- ENUMS
create type source_type as enum
  ('manual','pos_import','excel','csv','screenshot','receipt','whatsapp','historical');
create type verification_status as enum
  ('verified','partially_verified','unverified','estimated');
create type payment_method as enum
  ('cash','cheque','card','transfer','credit','unknown');
create type product_unit_type as enum ('weight','count');
create type term_type as enum ('rent','revenue_charge');
create type settlement_status as enum ('open','expected','received','reconciled');
create type cheque_status as enum ('pending','received','reconciled');
create type deduction_type as enum ('rent','revenue_charge','other');
create type money_movement_type as enum
  ('cheque_inflow','owner_injection','personal_withdrawal','cash_expense','salary','adjustment');
create type snapshot_source as enum ('live_capture','backfill','recompute');

-- ------------------------------------------------ updated_at trigger fn
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

-- =====================================================================
-- 1–4  ORGANIZATION
-- =====================================================================
create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'stand',
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_locations_upd before update on locations
  for each row execute function set_updated_at();

create table channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'physical',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Effective-dated deductions. rent -> amount (EGP/mo). revenue_charge -> rate.
create table location_terms (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  term_type term_type not null,
  amount numeric(14,2),
  rate numeric(6,4),
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz not null default now()
);
create index idx_location_terms on location_terms(location_id, term_type, effective_from);

-- =====================================================================
-- 5–7  PRODUCTS  (cost columns dormant until Phase 2)
-- =====================================================================
create table product_categories (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text,
  sort_order int not null default 0,
  active boolean not null default true
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text,
  category_id uuid references product_categories(id),
  unit_type product_unit_type not null default 'weight',
  base_unit text not null default 'g',
  current_stock numeric(14,3) not null default 0,   -- Phase 2
  avg_cost numeric(14,4) not null default 0,         -- Phase 2 (per base unit)
  selling_price numeric(14,2),
  sale_unit text default 'kg',
  low_stock_threshold numeric(14,3),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_products_upd before update on products
  for each row execute function set_updated_at();

create table product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  alias_text text not null unique,
  source source_type not null default 'manual',
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 8–9  REVENUE
-- =====================================================================
-- The POS daily total is canonical. Product rows reconcile to it within
-- tolerance (app_settings); mismatch is flagged, never auto-corrected.
create table sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null,
  location_id uuid not null references locations(id),
  channel_id uuid not null references channels(id),
  total_amount numeric(14,2) not null default 0,    -- canonical revenue
  tax_amount numeric(14,2) not null default 0,       -- VAT-tolerant
  tax_rate numeric(6,4) not null default 0,
  payment_method payment_method not null default 'unknown',
  source_type source_type not null default 'manual',
  verification verification_status not null default 'verified',
  settlement_period_id uuid,                          -- FK added below
  reconciled boolean not null default true,           -- false => mismatch flagged
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
create trigger trg_sales_upd before update on sales
  for each row execute function set_updated_at();
create index idx_sales_date on sales(sale_date, location_id) where voided_at is null;

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid references products(id),            -- null = unmatched
  raw_product_name text,
  quantity numeric(14,3) not null,                    -- base unit
  unit_price numeric(14,2),
  line_total numeric(14,2) not null,
  tax_amount numeric(14,2) not null default 0,
  cogs_at_sale numeric(14,2),                          -- null until Phase 2
  is_estimated boolean not null default false,
  verification verification_status not null default 'verified',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
create trigger trg_sale_items_upd before update on sale_items
  for each row execute function set_updated_at();
create index idx_sale_items_sale on sale_items(sale_id);
create index idx_sale_items_product on sale_items(product_id);

-- =====================================================================
-- 10–12  SETTLEMENT (what Hyper Hub owes) + DEDUCTIONS + CHEQUE (what arrived)
-- =====================================================================
-- Default settlement period = one calendar month (1st → last day).
-- net_expected = accumulated_revenue − total_deductions.
-- Deductions (rent, revenue_charge, other) are itemized rows in
-- settlement_deductions, seeded from location_terms defaults at period
-- creation and editable per month thereafter. Rent is a single monthly
-- amount — NOT prorated, NOT per-day, NEVER deducted twice in a month.
create table settlement_periods (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  start_date date not null,
  end_date date,                                       -- last day of month
  accumulated_revenue numeric(14,2) not null default 0,-- cached: monthly sales
  total_deductions numeric(14,2) not null default 0,   -- cached: Σ deduction amounts
  net_expected numeric(14,2) not null default 0,       -- cached: revenue − total_deductions
  status settlement_status not null default 'open',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
create trigger trg_settle_upd before update on settlement_periods
  for each row execute function set_updated_at();
create index idx_settle_open on settlement_periods(location_id, status);
-- one active settlement period per location per month (keeps auto-create idempotent)
create unique index uq_settle_period_month
  on settlement_periods(location_id, start_date) where voided_at is null;

alter table sales add constraint fk_sales_period
  foreign key (settlement_period_id) references settlement_periods(id);

-- Cheque is separate from settlement: expected snapshot vs amount received.
create table cheques (
  id uuid primary key default gen_random_uuid(),
  settlement_period_id uuid not null references settlement_periods(id),
  received_date date not null,
  expected_amount numeric(14,2) not null,              -- net_expected at receipt
  amount_received numeric(14,2) not null,
  difference numeric(14,2) generated always as (amount_received - expected_amount) stored,
  status cheque_status not null default 'received',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
create trigger trg_cheques_upd before update on cheques
  for each row execute function set_updated_at();

-- Monthly settlement deductions (rent, revenue_charge, other). Seeded from
-- location_terms defaults at period creation, then independently editable.
-- revenue_charge: amount auto = monthly revenue × rate unless manual_override.
-- rent/other: manual amounts; never auto-recomputed.
create table settlement_deductions (
  id uuid primary key default gen_random_uuid(),
  settlement_period_id uuid not null references settlement_periods(id) on delete cascade,
  deduction_type deduction_type not null,
  amount numeric(14,2) not null default 0,
  rate numeric(6,4),                                   -- for percentage types
  manual_override boolean not null default false,      -- true = don't auto-recompute
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
create trigger trg_settle_ded_upd before update on settlement_deductions
  for each row execute function set_updated_at();
create index idx_settle_ded on settlement_deductions(settlement_period_id) where voided_at is null;

-- =====================================================================
-- 12–14  CASH / TREASURY
-- =====================================================================
create table money_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  opening_balance numeric(14,2) not null default 0,
  current_balance numeric(14,2) not null default 0,    -- cached
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_money_acct_upd before update on money_accounts
  for each row execute function set_updated_at();

create table money_movements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references money_accounts(id),
  location_id uuid references locations(id),
  movement_date date not null,
  movement_type money_movement_type not null,
  amount numeric(14,2) not null,                       -- signed (+in / -out)
  balance_after numeric(14,2),                         -- cached running
  reference_type text,                                 -- 'cheque' | 'expense' | ...
  reference_id uuid,
  notes text,
  source_type source_type not null default 'manual',
  verification verification_status not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
create trigger trg_money_mov_upd before update on money_movements
  for each row execute function set_updated_at();
create index idx_money_mov on money_movements(account_id, movement_date) where voided_at is null;

create table cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references money_accounts(id),
  count_date date not null,
  expected_balance numeric(14,2) not null,             -- from running balance
  counted_amount numeric(14,2) not null,
  difference numeric(14,2) generated always as (counted_amount - expected_balance) stored,
  notes text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 15–18  EXPENSES & PAYROLL
-- =====================================================================
-- Note: stock purchases (-> COGS, Phase 2), rent & 3% (-> settlement), and
-- personal withdrawals (-> money_movements) are intentionally NOT expense
-- categories, to avoid double-counting. Categories here = operating overheads.
create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_operating boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_id uuid references locations(id),
  hire_date date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table employee_compensation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  monthly_salary numeric(14,2) not null,
  effective_from date not null,
  effective_to date,
  notes text
);
create index idx_emp_comp on employee_compensation(employee_id, effective_from);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  location_id uuid not null references locations(id),
  category_id uuid not null references expense_categories(id),
  amount numeric(14,2) not null,
  tax_amount numeric(14,2) not null default 0,
  supplier_id uuid references suppliers(id),
  employee_id uuid references employees(id),
  payment_method payment_method not null default 'unknown',
  receipt_url text,
  source_type source_type not null default 'manual',
  verification verification_status not null default 'verified',
  is_estimated boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
create trigger trg_expenses_upd before update on expenses
  for each row execute function set_updated_at();
create index idx_expenses_date on expenses(expense_date, category_id) where voided_at is null;

-- =====================================================================
-- 19  DAILY SNAPSHOTS  (cost/profit/inventory/health null until Phase 2)
-- =====================================================================
create table daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  location_id uuid not null references locations(id),
  revenue numeric(14,2),            -- flow
  cogs numeric(14,2),               -- flow  (null in Phase 1)
  gross_profit numeric(14,2),       -- flow  (null in Phase 1)
  operating_profit numeric(14,2),   -- flow  (null in Phase 1)
  inventory_value numeric(14,2),    -- stock (null in Phase 1)
  settlement_value numeric(14,2),   -- stock (expected accrued in open period)
  cash_balance numeric(14,2),       -- stock
  health_score numeric(6,2),        -- (null in Phase 1)
  health_score_config_ref text,
  data_confidence verification_status not null default 'verified',
  pct_estimated numeric(5,2) not null default 0,
  has_activity boolean not null default false,
  is_backfilled boolean not null default false,
  is_gap_filled boolean not null default false,
  source snapshot_source not null default 'live_capture',
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, location_id)
);
create trigger trg_snapshot_upd before update on daily_snapshots
  for each row execute function set_updated_at();
create index idx_snapshot_date on daily_snapshots(location_id, snapshot_date);

-- =====================================================================
-- 20  APP SETTINGS  (key-value business config)
-- =====================================================================
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create trigger trg_app_settings_upd before update on app_settings
  for each row execute function set_updated_at();

-- =====================================================================
-- FINANCIAL FUNCTIONS  (single source of truth — see note)
-- These are the ONLY place settlement, balance, and reconciliation math
-- live. App code (Server Actions) calls them via RPC after writes; the
-- TS layer must not reimplement this math. KPI/reporting reads the
-- resulting cached columns and views.
--
-- SETTLEMENT RULE (Phase 1): the settlement period is ONE CALENDAR MONTH.
-- Deductions are itemized rows in settlement_deductions, seeded from
-- location_terms defaults when the period is created, then editable:
--   * rent / stand fee: a single monthly amount (default 15,000), manual,
--     NEVER prorated and NEVER deducted twice in a month;
--   * revenue_charge: amount = monthly revenue × rate, auto-recomputed as
--     sales accrue UNLESS manual_override is set;
--   * other: any extra manual monthly deduction.
-- net_expected = accumulated_revenue − Σ(deduction amounts).
-- location_terms are DEFAULTS only: changing rent/rate affects future months
-- (new periods seed the new value); existing periods change only if edited.
-- =====================================================================

-- read a numeric business setting
create or replace function get_setting_numeric(p_key text)
returns numeric language sql stable as $$
  select (value #>> '{}')::numeric from app_settings where key = p_key;
$$;

-- effective rent amount + charge rate for a location on a date
create or replace function get_effective_terms(p_location_id uuid, p_date date)
returns table (rent_amount numeric, charge_rate numeric)
language sql stable as $$
  select
    (select lt.amount from location_terms lt
       where lt.location_id = p_location_id and lt.term_type = 'rent'
         and lt.effective_from <= p_date
         and (lt.effective_to is null or lt.effective_to >= p_date)
       order by lt.effective_from desc limit 1),
    (select lt.rate from location_terms lt
       where lt.location_id = p_location_id and lt.term_type = 'revenue_charge'
         and lt.effective_from <= p_date
         and (lt.effective_to is null or lt.effective_to >= p_date)
       order by lt.effective_from desc limit 1);
$$;

-- create the calendar-month settlement period (if absent) and seed its
-- default deductions from current location_terms. Returns the period id.
-- Re-running is safe: an existing period is returned without re-seeding,
-- so later changes to location_terms never disturb a created month.
create or replace function ensure_monthly_settlement_period(p_location_id uuid, p_month date)
returns uuid language plpgsql as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_id uuid; v_rent numeric; v_rate numeric;
begin
  select id into v_id from settlement_periods
    where location_id = p_location_id and start_date = v_start and voided_at is null;
  if v_id is not null then
    return v_id;
  end if;

  insert into settlement_periods (location_id, start_date, end_date, status)
    values (p_location_id, v_start, v_end, 'open')
    returning id into v_id;

  select rent_amount, charge_rate into v_rent, v_rate
    from get_effective_terms(p_location_id, v_start);

  insert into settlement_deductions
    (settlement_period_id, deduction_type, amount, rate, manual_override, notes)
  values
    (v_id, 'rent',           coalesce(v_rent, 15000), null,                false, 'Monthly rent / stand fee (default; editable)'),
    (v_id, 'revenue_charge', 0,                       coalesce(v_rate, 0.03), false, 'Auto: monthly revenue × rate');

  return v_id;
end;
$$;

-- light, recursion-safe: re-sum non-voided deductions and recompute
-- net_expected from the period's already-cached accumulated_revenue.
-- Touches only settlement_periods (never sales or deductions), so it is
-- safe to call from a deduction trigger without looping.
create or replace function refresh_settlement_totals(p_period_id uuid)
returns void language plpgsql as $$
declare v_ded numeric;
begin
  select coalesce(sum(amount),0) into v_ded
    from settlement_deductions
    where settlement_period_id = p_period_id and voided_at is null;

  update settlement_periods set
    total_deductions = v_ded,
    net_expected     = round(accumulated_revenue - v_ded, 2),
    updated_at       = now()
  where id = p_period_id;
end;
$$;

-- recompute a settlement period: accumulated revenue from linked (non-voided)
-- sales, auto-update non-overridden revenue_charge deductions (guarded so an
-- unchanged value writes nothing), then refresh totals. Rent and 'other'
-- deductions are left exactly as entered.
create or replace function recalc_settlement_period(p_period_id uuid)
returns void language plpgsql as $$
declare v_rev numeric;
begin
  select coalesce(sum(total_amount),0) into v_rev
    from sales where settlement_period_id = p_period_id and voided_at is null;

  update settlement_periods set accumulated_revenue = v_rev, updated_at = now()
    where id = p_period_id;

  update settlement_deductions
    set amount = round(v_rev * coalesce(rate,0), 2), updated_at = now()
    where settlement_period_id = p_period_id
      and deduction_type = 'revenue_charge'
      and manual_override = false
      and voided_at is null
      and amount is distinct from round(v_rev * coalesce(rate,0), 2);

  perform refresh_settlement_totals(p_period_id);
end;
$$;

-- recompute money account balance + running balance_after from movements
create or replace function recalc_money_account(p_account_id uuid)
returns void language plpgsql as $$
declare v_open numeric; v_final numeric;
begin
  select opening_balance into v_open from money_accounts where id = p_account_id;

  with ordered as (
    select id,
           sum(amount) over (order by movement_date, created_at
                             rows between unbounded preceding and current row) as run
    from money_movements
    where account_id = p_account_id and voided_at is null
  )
  update money_movements mm
    set balance_after = v_open + o.run
    from ordered o where mm.id = o.id;

  select v_open + coalesce(sum(amount),0) into v_final
    from money_movements where account_id = p_account_id and voided_at is null;

  update money_accounts set current_balance = v_final, updated_at = now()
    where id = p_account_id;
end;
$$;

-- reconcile a sale header vs its items using the configured tolerance
create or replace function check_sale_reconciliation(p_sale_id uuid)
returns boolean language plpgsql as $$
declare v_total numeric; v_items numeric; v_tol numeric; v_ok boolean; v_has_items boolean;
begin
  select total_amount into v_total from sales where id = p_sale_id;
  select exists(select 1 from sale_items where sale_id = p_sale_id and voided_at is null)
    into v_has_items;

  -- header-only daily total (no product rows) is reconciled by definition
  if not v_has_items then
    update sales set reconciled = true, updated_at = now() where id = p_sale_id;
    return true;
  end if;

  select coalesce(sum(line_total),0) into v_items
    from sale_items where sale_id = p_sale_id and voided_at is null;

  v_tol := greatest(
    coalesce(get_setting_numeric('recon_tolerance_abs'), 5),
    coalesce(get_setting_numeric('recon_tolerance_pct'), 0.005) * coalesce(v_total,0)
  );
  v_ok := abs(coalesce(v_total,0) - v_items) <= v_tol;

  update sales set reconciled = v_ok, updated_at = now() where id = p_sale_id;
  return v_ok;
end;
$$;

-- =====================================================================
-- AUTOMATION  (settlement periods are created & maintained automatically;
-- the user never creates a period by hand)
-- =====================================================================
-- BEFORE write: link the sale to its month's settlement period, creating
-- the period (and seeding its deductions) if it does not exist yet. Fires
-- for every insert and whenever a sale's date or location changes, so a
-- sale moved to another month is re-homed automatically. Works for any
-- entry path (manual, import, historical) — automation lives in the data
-- layer, not in one form.
create or replace function sales_assign_settlement() returns trigger
language plpgsql as $$
begin
  new.settlement_period_id := ensure_monthly_settlement_period(new.location_id, new.sale_date);
  return new;
end;
$$;
create trigger trg_sales_assign_settlement
  before insert or update of sale_date, location_id on sales
  for each row execute function sales_assign_settlement();

-- AFTER write: recompute the affected period(s) so accumulated_revenue,
-- the auto revenue_charge, and net_expected stay current. Handles month
-- moves (recalc both old and new) and voids (recalc excludes the voided row).
create or replace function sales_recalc_settlement() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform recalc_settlement_period(new.settlement_period_id);
  elsif tg_op = 'UPDATE' then
    perform recalc_settlement_period(new.settlement_period_id);
    if old.settlement_period_id is not null
       and old.settlement_period_id is distinct from new.settlement_period_id then
      perform recalc_settlement_period(old.settlement_period_id);
    end if;
  elsif tg_op = 'DELETE' then
    if old.settlement_period_id is not null then
      perform recalc_settlement_period(old.settlement_period_id);
    end if;
    return old;
  end if;
  return null;
end;
$$;
create trigger trg_sales_recalc_settlement
  after insert or update or delete on sales
  for each row execute function sales_recalc_settlement();

-- Editing/adding/removing a deduction refreshes the period's cached totals.
-- Uses the light refresh (not the full recalc) so the revenue_charge
-- auto-update inside recalc cannot trigger an infinite loop.
create or replace function deduction_recalc_settlement() returns trigger
language plpgsql as $$
begin
  perform refresh_settlement_totals(
    coalesce(new.settlement_period_id, old.settlement_period_id));
  return null;
end;
$$;
create trigger trg_deduction_recalc
  after insert or update or delete on settlement_deductions
  for each row execute function deduction_recalc_settlement();

-- =====================================================================
-- HELPER VIEWS (derived; never stored)
-- =====================================================================
create view v_active_sales as
  select * from sales where voided_at is null;

create view v_open_settlement as
  select * from settlement_periods where status = 'open';

-- =====================================================================
-- RLS  (single admin in V1; service role bypasses for the snapshot job)
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'locations','channels','suppliers','location_terms','product_categories',
    'products','product_aliases','sales','sale_items','settlement_periods',
    'settlement_deductions','cheques','money_accounts','money_movements',
    'cash_reconciliations','expense_categories','employees','employee_compensation',
    'expenses','daily_snapshots','app_settings'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy admin_all on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- =====================================================================
-- SEEDS
-- =====================================================================
insert into locations (name, kind) values ('Bosta Bites — Hyper Hub Stand', 'stand');
insert into channels (name, kind) values ('Physical Stand', 'physical');

-- effective-dated terms for the seeded location
insert into location_terms (location_id, term_type, amount, effective_from)
  select id, 'rent', 15000, date '2024-01-01' from locations limit 1;
insert into location_terms (location_id, term_type, rate, effective_from)
  select id, 'revenue_charge', 0.03, date '2024-01-01' from locations limit 1;

-- operating-overhead categories only (see note above)
insert into expense_categories (name, is_operating, sort_order) values
  ('Boxes / Supplies', true, 1),
  ('Salary',           true, 2),
  ('Bonuses',          true, 3),
  ('Transport',        true, 4),
  ('Marketing',        true, 5),
  ('Maintenance',      true, 6),
  ('Other',            true, 7);

insert into money_accounts (name, opening_balance, current_balance)
  values ('Main Cash', 0, 0);

insert into app_settings (key, value) values
  ('recon_tolerance_abs', '5'::jsonb),
  ('recon_tolerance_pct', '0.005'::jsonb);
