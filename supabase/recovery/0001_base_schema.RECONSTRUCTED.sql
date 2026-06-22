-- =====================================================================
-- BostaOS — 0001 base schema  *** RECONSTRUCTED REFERENCE — NOT CANONICAL ***
-- =====================================================================
--
--   ⚠️  DO NOT APPLY THIS TO THE PRODUCTION DATABASE.  ⚠️
--
-- This file is a best-effort RECONSTRUCTION of the un-versioned base schema,
-- assembled WITHOUT database access from:
--   * src/types/database.types.ts  (authoritative for columns / nullability / FKs / enums)
--   * supabase/migrations/0002..0010 (authoritative PG types where they touch base cols)
--   * the settlement / WAC / money behaviour PROVEN in harness/sim.mjs (73/73)
--
-- It exists so the engine CONTRACTS are readable in source and so a *fresh /
-- scratch* database can be stood up for testing. It is NOT a substitute for the
-- real export — see RECOVERY.md §2. The true function bodies and exact column
-- precision/constraints/indexes can only come from a pg_dump of the live DB.
--
-- Markers:  -- [TYPES]  column shape from database.types.ts (precision inferred)
--           -- [MIG]    exact PG type confirmed by a 0002..0010 migration
--           -- [VERIFIED] body encodes behaviour proven by the harness
--           -- [ASSUMED] behaviour inferred from app code; confirm against the dump
-- =====================================================================

-- ---------------------------------------------------------------- ENUMS [TYPES]
create type source_type as enum
  ('manual','pos_import','excel','csv','screenshot','receipt','whatsapp','historical');
create type verification_status as enum
  ('verified','partially_verified','unverified','estimated');
create type payment_method as enum
  ('cash','cheque','card','transfer','credit','unknown');
create type term_type as enum ('rent','revenue_charge');
create type deduction_type as enum ('rent','revenue_charge','other');
create type settlement_status as enum ('open','expected','received','reconciled');
create type cheque_status as enum
  ('pending','received','reconciled','expected','deposited','cleared','cancelled');
create type money_movement_type as enum
  ('cheque_inflow','owner_injection','personal_withdrawal','cash_expense','salary','adjustment');
create type product_unit_type as enum ('weight','count');
create type snapshot_source as enum ('live_capture','backfill','recompute');
-- inventory_movement_type is created by migration 0003 (already in source control).

-- -------------------------------------------------- shared updated_at helper [ASSUMED]
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ====================================================================
-- ENGINE-CRITICAL TABLES (subset the engine reads/writes).
-- Column NAMES/nullability are authoritative; numeric precision is inferred where
-- not confirmed by a migration — verify against the real dump.
-- ====================================================================

create table if not exists app_settings (              -- [TYPES]
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists locations (                 -- [TYPES]
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'host',
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists location_terms (            -- [TYPES] effective-dated rent / revenue-share
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  term_type term_type not null,
  amount numeric(14,2),        -- rent EGP (term_type='rent')
  rate numeric(7,4),           -- revenue-share fraction 0..1 (term_type='revenue_charge')
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists channels (                  -- [TYPES]
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_categories (        -- [TYPES]
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists products (                  -- [TYPES] (+ base_units_per_sale_unit from 0007 [MIG])
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text,
  category_id uuid references product_categories(id),
  unit_type product_unit_type not null default 'weight',
  base_unit text not null default 'g',
  sale_unit text,
  base_units_per_sale_unit numeric not null default 1,   -- [MIG 0007] check (> 0)
  selling_price numeric(14,2),
  low_stock_threshold numeric(14,3),
  current_stock numeric(14,3) not null default 0,        -- derived cache (0003/0006)
  avg_cost numeric(14,4) not null default 0,             -- derived cache (0006)
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists suppliers (                 -- [TYPES]
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists settlement_periods (        -- [TYPES]
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  start_date date not null,
  end_date date,
  status settlement_status not null default 'open',
  accumulated_revenue numeric(14,2) not null default 0, -- derived by recalc_settlement_period
  total_deductions numeric(14,2) not null default 0,    -- derived
  net_expected numeric(14,2) not null default 0,        -- derived = accumulated_revenue - total_deductions
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);

create table if not exists settlement_deductions (     -- [TYPES]
  id uuid primary key default gen_random_uuid(),
  settlement_period_id uuid not null references settlement_periods(id),
  deduction_type deduction_type not null,
  amount numeric(14,2) not null default 0,
  rate numeric(7,4),
  manual_override boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);

create table if not exists sales (                     -- [TYPES]
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  channel_id uuid not null references channels(id),
  sale_date date not null,
  total_amount numeric(14,2) not null default 0,        -- canonical revenue
  tax_amount numeric(14,2) not null default 0,
  tax_rate numeric(7,4) not null default 0,
  payment_method payment_method not null default 'unknown',
  settlement_period_id uuid references settlement_periods(id),  -- set by the sales trigger
  reconciled boolean not null default false,            -- set by check_sale_reconciliation
  is_historical boolean not null default false,         -- provenance flag (NOT an operational discriminator)
  source_type source_type not null default 'manual',
  verification verification_status not null default 'verified',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);

create table if not exists sale_items (                -- [TYPES] (cogs_at_sale snapshotted by 0007)
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id),
  product_id uuid references products(id),
  raw_product_name text,
  quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2),
  line_total numeric(14,2) not null default 0,
  cogs_at_sale numeric(14,2),                           -- [MIG 0007] snapshot; null = cost unknown
  verification verification_status not null default 'verified',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);

create table if not exists money_accounts (            -- [TYPES]
  id uuid primary key default gen_random_uuid(),
  name text not null,
  opening_balance numeric(14,2) not null default 0,
  current_balance numeric(14,2) not null default 0,     -- derived by recalc_money_account
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists money_movements (           -- [TYPES] signed cash ledger
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references money_accounts(id),
  movement_type money_movement_type not null,
  amount numeric(14,2) not null,                        -- signed: inflows +, outflows -
  balance_after numeric(14,2),                          -- running balance (maintained by recalc)
  movement_date date not null,
  location_id uuid references locations(id),
  reference_type text,
  reference_id uuid,
  source_type source_type not null default 'manual',
  verification verification_status not null default 'verified',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);

create table if not exists cheques (                   -- [TYPES] (+ 0002 lifecycle columns)
  id uuid primary key default gen_random_uuid(),
  settlement_period_id uuid not null references settlement_periods(id),
  status cheque_status not null default 'expected',
  expected_amount numeric(14,2) not null,
  amount_received numeric(14,2),
  difference numeric(14,2),
  due_date date,                                        -- [MIG 0002]
  received_date date,                                   -- [MIG 0002] nullable
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
-- NOTE: tables app_settings/expense_categories/expenses/product_aliases/cash_reconciliations/
-- daily_snapshots/employees/employee_compensation and views v_active_sales/v_open_settlement
-- also belong to 0001 — captured by the real export (RECOVERY.md §1). Omitted here as they are
-- not on the settlement/cash engine path.

-- ====================================================================
-- ENGINE FUNCTIONS  [VERIFIED behaviour / ASSUMED structure]
-- ====================================================================

-- numeric app_settings reader (tolerances, etc.) [ASSUMED]
create or replace function get_setting_numeric(p_key text)
returns numeric language sql stable as $$
  select (value #>> '{}')::numeric from app_settings where key = p_key;
$$;

-- Effective-dated terms resolver. Returns ONE row (rent EGP + revenue-share rate)
-- in force on p_date for the location. Aliases location_terms.amount→rent_amount,
-- location_terms.rate→charge_rate to match the app's reader. [VERIFIED formula]
create or replace function get_effective_terms(p_date date, p_location_id uuid)
returns table (charge_rate numeric, rent_amount numeric)
language sql stable as $$
  select
    coalesce(max(case when term_type = 'revenue_charge' then rate   end), 0) as charge_rate,
    coalesce(max(case when term_type = 'rent'           then amount end), 0) as rent_amount
  from location_terms
  where location_id = p_location_id
    and effective_from <= p_date
    and (effective_to is null or effective_to >= p_date);
$$;

-- Find-or-create the monthly settlement period for a location. [ASSUMED structure]
create or replace function ensure_monthly_settlement_period(p_location_id uuid, p_month date)
returns uuid language plpgsql as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_id    uuid;
begin
  select id into v_id from settlement_periods
   where location_id = p_location_id and start_date = v_start and voided_at is null
   limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into settlement_periods(location_id, start_date, end_date, status)
       values (p_location_id, v_start, v_end, 'open')
    returning id into v_id;
  return v_id;
end;
$$;

-- Recompute a period's revenue, deductions and net_expected from its sales + the
-- effective terms. accumulated_revenue sums ALL non-voided sales attached to the
-- period (one continuous history; live-vs-historical OWED is decided in the app
-- layer by date). net_expected = revenue - rent - rate*revenue. [VERIFIED formula]
create or replace function recalc_settlement_period(p_period_id uuid)
returns void language plpgsql as $$
declare
  v_loc   uuid;
  v_start date;
  v_rev   numeric := 0;
  v_rent  numeric := 0;
  v_rate  numeric := 0;
  v_rc    numeric := 0;
  v_total numeric := 0;
begin
  select location_id, start_date into v_loc, v_start
    from settlement_periods where id = p_period_id;
  if not found then return; end if;

  select coalesce(sum(total_amount), 0) into v_rev
    from sales where settlement_period_id = p_period_id and voided_at is null;

  select charge_rate, rent_amount into v_rate, v_rent
    from get_effective_terms(v_start, v_loc);

  v_rc    := round(coalesce(v_rate, 0) * v_rev, 2);
  v_total := coalesce(v_rent, 0) + v_rc;

  update settlement_periods
     set accumulated_revenue = v_rev,
         total_deductions    = v_total,
         net_expected        = v_rev - v_total,
         updated_at          = now()
   where id = p_period_id;

  -- Upsert the two deduction rows so the app can show the breakdown.
  update settlement_deductions set voided_at = now()
   where settlement_period_id = p_period_id and voided_at is null and manual_override = false;
  insert into settlement_deductions(settlement_period_id, deduction_type, amount, rate)
       values (p_period_id, 'rent', coalesce(v_rent,0), null),
              (p_period_id, 'revenue_charge', v_rc, coalesce(v_rate,0));
end;
$$;

-- Documented alias used by the app's reconcile path. [ASSUMED]
create or replace function refresh_settlement_totals(p_period_id uuid)
returns void language plpgsql as $$
begin
  perform recalc_settlement_period(p_period_id);
end;
$$;

-- Sale reconciliation flag: total_amount vs Σ sale_items.line_total within tolerance.
-- [VERIFIED tolerance model — matches getSaleDetail (5 EGP / 0.5% fallbacks)]
create or replace function check_sale_reconciliation(p_sale_id uuid)
returns boolean language plpgsql as $$
declare
  v_total numeric := 0;
  v_items numeric := 0;
  v_abs   numeric := coalesce(get_setting_numeric('recon_tolerance_abs'), 5);
  v_pct   numeric := coalesce(get_setting_numeric('recon_tolerance_pct'), 0.005);
  v_ok    boolean;
begin
  select total_amount into v_total from sales where id = p_sale_id;
  if not found then return false; end if;
  select coalesce(sum(line_total), 0) into v_items
    from sale_items where sale_id = p_sale_id and voided_at is null;
  v_ok := abs(v_total - v_items) <= greatest(v_abs, v_pct * v_total);
  update sales set reconciled = v_ok where id = p_sale_id;
  return v_ok;
end;
$$;

-- Cash account balance = opening_balance + Σ non-voided signed movements. [VERIFIED]
create or replace function recalc_money_account(p_account_id uuid)
returns void language plpgsql as $$
declare v_bal numeric := 0; v_open numeric := 0;
begin
  select opening_balance into v_open from money_accounts where id = p_account_id;
  if not found then return; end if;
  select v_open + coalesce(sum(amount), 0) into v_bal
    from money_movements where account_id = p_account_id and voided_at is null;
  update money_accounts set current_balance = v_bal, updated_at = now()
   where id = p_account_id;
end;
$$;

-- Sale → settlement attachment trigger: on any sale change, ensure the monthly
-- period, attach the sale, and recalc. [ASSUMED — confirm trigger name via export]
create or replace function sales_settlement_sync()
returns trigger language plpgsql as $$
declare v_period uuid;
begin
  if tg_op = 'DELETE' then
    if old.settlement_period_id is not null then
      perform recalc_settlement_period(old.settlement_period_id);
    end if;
    return old;
  end if;

  v_period := ensure_monthly_settlement_period(new.location_id, new.sale_date);
  if new.settlement_period_id is distinct from v_period then
    update sales set settlement_period_id = v_period where id = new.id;
  end if;
  perform recalc_settlement_period(v_period);
  if tg_op = 'UPDATE' and old.settlement_period_id is not null
     and old.settlement_period_id <> v_period then
    perform recalc_settlement_period(old.settlement_period_id);   -- moved months
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sales_settlement_sync on sales;
create trigger trg_sales_settlement_sync
  after insert or update or delete on sales
  for each row execute function sales_settlement_sync();

-- updated_at triggers (one per table with updated_at). [ASSUMED]
-- create trigger trg_<table>_upd before update on <table>
--   for each row execute function set_updated_at();

-- =====================================================================
-- END RECONSTRUCTED REFERENCE. Replace with the real pg_dump (RECOVERY.md §2)
-- before treating any of the above as canonical.
-- =====================================================================
