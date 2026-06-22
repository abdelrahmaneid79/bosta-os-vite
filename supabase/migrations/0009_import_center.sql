-- =====================================================================
-- BostaOS — Migration 0009: Historical Import Center (HARDENED, re-runnable)
--
-- Schema only: product_aliases (learn Arabic POS names / item codes / barcodes),
-- imports + import_rows (preview & audit trail), and sales.is_historical.
-- No data import, no auto-save — the app previews and the owner approves.
--
-- HARDENING: a prior partial run can leave an incomplete table, which then
-- breaks `create index ... where voided_at is null`. To self-heal, every table
-- is CREATE TABLE IF NOT EXISTS followed by ALTER TABLE ADD COLUMN IF NOT EXISTS
-- for EVERY column, and all indexes/constraints are created only AFTER the
-- columns are guaranteed. CHECK constraints are added via guarded DO blocks.
-- Safe to re-run; additive only; does not touch existing app data.
-- (If you want a clean slate first, run the optional drop-if-empty snippet
-- provided separately — it drops these 3 tables only when they have 0 rows.)
-- =====================================================================

-- 0) Historical marker on sales (additive; existing rows default false).
alter table sales add column if not exists is_historical boolean not null default false;

-- 1) product_aliases ---------------------------------------------------------
create table if not exists product_aliases (
  id uuid primary key default gen_random_uuid()
);
alter table product_aliases add column if not exists product_id uuid;
alter table product_aliases add column if not exists alias text;
alter table product_aliases add column if not exists alias_type text;
alter table product_aliases add column if not exists normalized text;
alter table product_aliases add column if not exists source text;
alter table product_aliases add column if not exists created_at timestamptz not null default now();
alter table product_aliases add column if not exists updated_at timestamptz not null default now();
alter table product_aliases add column if not exists voided_at timestamptz;
alter table product_aliases add column if not exists void_reason text;

-- FK + checks (guarded so re-runs are safe)
do $$ begin
  if not exists (select 1 from pg_constraint where conname='product_aliases_product_id_fkey') then
    alter table product_aliases add constraint product_aliases_product_id_fkey
      foreign key (product_id) references products(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='product_aliases_alias_type_check') then
    alter table product_aliases add constraint product_aliases_alias_type_check
      check (alias_type in ('name_ar','barcode','pos_code','imported_name'));
  end if;
end $$;

create unique index if not exists uq_product_aliases_active
  on product_aliases (alias_type, normalized) where voided_at is null;
create index if not exists idx_product_aliases_product
  on product_aliases (product_id) where voided_at is null;

drop trigger if exists trg_product_aliases_upd on product_aliases;
create trigger trg_product_aliases_upd before update on product_aliases
  for each row execute function set_updated_at();

alter table product_aliases enable row level security;
drop policy if exists admin_all on product_aliases;
create policy admin_all on product_aliases
  for all to authenticated using (true) with check (true);

-- 2) imports -----------------------------------------------------------------
create table if not exists imports (
  id uuid primary key default gen_random_uuid()
);
alter table imports add column if not exists kind text;
alter table imports add column if not exists filename text;
alter table imports add column if not exists status text not null default 'draft';
alter table imports add column if not exists location_id uuid;
alter table imports add column if not exists period_from date;
alter table imports add column if not exists period_to date;
alter table imports add column if not exists row_count integer not null default 0;
alter table imports add column if not exists totals jsonb;
alter table imports add column if not exists notes text;
alter table imports add column if not exists source_type source_type not null default 'historical';
alter table imports add column if not exists verification verification_status not null default 'unverified';
alter table imports add column if not exists created_at timestamptz not null default now();
alter table imports add column if not exists updated_at timestamptz not null default now();
alter table imports add column if not exists voided_at timestamptz;
alter table imports add column if not exists void_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='imports_location_id_fkey') then
    alter table imports add constraint imports_location_id_fkey
      foreign key (location_id) references locations(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='imports_kind_check') then
    alter table imports add constraint imports_kind_check
      check (kind in ('daily_sales','product_sales','expenses','purchases','products'));
  end if;
  if not exists (select 1 from pg_constraint where conname='imports_status_check') then
    alter table imports add constraint imports_status_check
      check (status in ('draft','previewed','approved','voided'));
  end if;
end $$;

create index if not exists idx_imports_kind_status
  on imports (kind, status) where voided_at is null;
create index if not exists idx_imports_created
  on imports (created_at desc);

drop trigger if exists trg_imports_upd on imports;
create trigger trg_imports_upd before update on imports
  for each row execute function set_updated_at();

alter table imports enable row level security;
drop policy if exists admin_all on imports;
create policy admin_all on imports
  for all to authenticated using (true) with check (true);

-- 3) import_rows -------------------------------------------------------------
create table if not exists import_rows (
  id uuid primary key default gen_random_uuid()
);
alter table import_rows add column if not exists import_id uuid;
alter table import_rows add column if not exists row_index integer;
alter table import_rows add column if not exists raw jsonb;
alter table import_rows add column if not exists parsed jsonb;
alter table import_rows add column if not exists match_status text;
alter table import_rows add column if not exists matched_product_id uuid;
alter table import_rows add column if not exists target text;
alter table import_rows add column if not exists applied boolean not null default false;
alter table import_rows add column if not exists error_message text;
alter table import_rows add column if not exists created_at timestamptz not null default now();
alter table import_rows add column if not exists updated_at timestamptz not null default now();

do $$ begin
  -- No ON DELETE CASCADE: audit rows are retained (imports are soft-voided).
  if not exists (select 1 from pg_constraint where conname='import_rows_import_id_fkey') then
    alter table import_rows add constraint import_rows_import_id_fkey
      foreign key (import_id) references imports(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='import_rows_matched_product_id_fkey') then
    alter table import_rows add constraint import_rows_matched_product_id_fkey
      foreign key (matched_product_id) references products(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='import_rows_match_status_check') then
    alter table import_rows add constraint import_rows_match_status_check
      check (match_status in ('matched','unmapped','ignored','error'));
  end if;
end $$;

create index if not exists idx_import_rows_import
  on import_rows (import_id, row_index);
create index if not exists idx_import_rows_match
  on import_rows (match_status);
create index if not exists idx_import_rows_product
  on import_rows (matched_product_id) where matched_product_id is not null;

drop trigger if exists trg_import_rows_upd on import_rows;
create trigger trg_import_rows_upd before update on import_rows
  for each row execute function set_updated_at();

alter table import_rows enable row level security;
drop policy if exists admin_all on import_rows;
create policy admin_all on import_rows
  for all to authenticated using (true) with check (true);
