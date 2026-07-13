-- =====================================================================
-- 0037: Cycle 10 Retail Reasoning — ADDITIVE ONLY.
--
-- Optional structured merchandising/packaging fields so the Retail Reasoning
-- Engine can make SPECIFIC advice (facings, mini-bags, adjacency, tier) — every
-- field is nullable; the engine states "needs this observation" when absent and
-- never fabricates a physical layout it can't see. Plus retail_experiments so a
-- hypothesis recommendation becomes a structured, evaluable test.
-- =====================================================================

alter table products
  add column if not exists packaging_format text,          -- 'weighted' | 'prepacked' | 'mini_bag' | 'pouch' | 'gift'
  add column if not exists pack_size_g numeric(10,2),       -- grams per pack, when prepacked
  add column if not exists packaging_cost numeric(10,2),    -- EGP per pack (must be included in mini-bag economics)
  add column if not exists display_zone text,               -- e.g. 'entrance' | 'counter' | 'aisle' | 'premium_block'
  add column if not exists shelf_level text,                -- 'eye' | 'mid' | 'low' | 'top'
  add column if not exists facings int,                     -- number of facings on the stand
  add column if not exists tier text check (tier in ('premium','standard','value')),
  add column if not exists impulse_type text check (impulse_type in ('impulse','destination')),
  add column if not exists min_order_qty numeric(12,2),     -- supplier MOQ
  add column if not exists supplier_lead_days int,
  add column if not exists adjacent_product_ids uuid[];     -- confirmed shelf neighbours

create table if not exists retail_experiments (
  id uuid primary key default gen_random_uuid(),
  playbook_id text,                                         -- knowledge playbook that generated it
  title text not null,
  domain text not null,
  rec_type text not null,
  product_ids uuid[] not null default '{}',
  location text,
  change_description text not null,
  start_date date,
  end_date date,
  baseline jsonb,                                           -- metrics captured at start
  primary_metric text not null,
  secondary_metrics jsonb not null default '[]'::jsonb,
  guardrail_metrics jsonb not null default '[]'::jsonb,
  min_sample text,
  success_threshold text,
  failure_threshold text,
  stop_condition text,
  status text not null default 'proposed'
    check (status in ('proposed','running','complete','abandoned')),
  result jsonb,
  conclusion text,
  attribution_confidence text
    check (attribution_confidence in ('strong','moderate','weak','inconclusive')),
  decision text check (decision in ('keep','modify','reverse')),
  owner_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);
create index if not exists idx_retail_experiments_status on retail_experiments(status);

do $$
begin
  execute 'alter table retail_experiments enable row level security';
  execute 'drop policy if exists admin_all on retail_experiments';
  execute 'create policy admin_all on retail_experiments for all to authenticated using (true) with check (true)';
end $$;
