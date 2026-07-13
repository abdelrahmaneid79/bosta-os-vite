-- =====================================================================
-- 0038: Cycle 11 — Owner Knowledge + packaging/merchandising context.
-- ADDITIVE ONLY. Makes packaging first-class and captures the few facts
-- BostaOS cannot derive, so merchandising/packaging advice can become
-- specific to the real Bosta Bites stand. Historical sales stay valid with
-- packaging simply unknown.
-- =====================================================================

-- Packaging-format catalog (the formats the owner actually offers + economics)
create table if not exists packaging_formats (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  packaging_type text,                 -- 'weighted' | 'prepacked' | 'mini_bag' | 'pouch' | 'gift' | 'sampling'
  material text,
  pack_size_g numeric(10,2),
  package_cost numeric(10,2),          -- material cost per unit
  prep_cost numeric(10,2),             -- labour per unit
  label_seal_cost numeric(10,2),
  prep_minutes numeric(8,2),
  premium_score int check (premium_score between 0 and 10),
  impulse_suitable boolean not null default false,
  gifting_suitable boolean not null default false,
  shelf_space text,                    -- 'small' | 'medium' | 'large'
  display_zone text,
  seasonal boolean not null default false,
  season text,                         -- 'ramadan' | 'eid' | 'gifting'
  applicable_product_ids uuid[] not null default '{}',
  active boolean not null default true,
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_packaging_formats_active on packaging_formats(active);

-- Per-product owner facts the engine can't derive
alter table products
  add column if not exists quantity_breaks jsonb,       -- [{minQty, unitCost}] supplier tiers
  add column if not exists do_not_discontinue boolean not null default false,
  add column if not exists is_traffic_driver boolean not null default false;

-- Owner global context (allowed promotions, display changes, occasions, etc.)
-- lives in app_settings key 'retail_context' (single JSON row, owner-editable);
-- interview progress lives in app_settings key 'retail_interview'. No table
-- needed — they are single-owner key/value documents.

do $$
begin
  execute 'alter table packaging_formats enable row level security';
  execute 'drop policy if exists admin_all on packaging_formats';
  execute 'create policy admin_all on packaging_formats for all to authenticated using (true) with check (true)';
end $$;
