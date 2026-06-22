-- BostaOS schema — single-admin. Run in the Supabase SQL editor.
-- Security model: every table is row-locked to its owner (auth.uid()).
-- Even though the app is single-admin, owner-scoped RLS keeps the anon key safe.

-- ── Extensions ────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── Helper: default owner = current user ──────────────────────────────────
-- We set owner_id app-side too, but a trigger guarantees it server-side.
create or replace function public.set_owner_id()
returns trigger language plpgsql as $$
begin
  if new.owner_id is null then
    new.owner_id := auth.uid();
  end if;
  return new;
end; $$;

-- ── Tables ────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name_en text not null,
  name_ar text,
  sku text,
  unit text not null default 'kg',
  category text,
  sale_price numeric,
  is_active boolean not null default true,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  alias text not null,
  unique (owner_id, alias)
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  product_id uuid references public.products(id) on delete set null,
  qty numeric not null default 0,
  unit_price numeric not null default 0,
  total numeric not null default 0,
  source text not null default 'manual',
  verified boolean not null default false,
  note text,
  import_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  vendor text,
  product_id uuid references public.products(id) on delete set null,
  qty numeric not null default 0,
  unit_cost numeric not null default 0,
  total numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  category text not null default 'other',
  amount numeric not null default 0,
  payment_method text,
  is_withdrawal boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

-- Single source of truth for stock on-hand.
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  product_id uuid not null references public.products(id) on delete cascade,
  type text not null,                 -- purchase | sale | adjustment
  qty_delta numeric not null,         -- +in / -out
  unit_cost numeric,                  -- weighted cost captured at movement time
  ref_table text,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  opening numeric not null default 0,
  counted numeric not null default 0,
  cash_added numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.cheque_periods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date,
  deductions numeric not null default 0,
  expected numeric,
  received numeric,
  status text not null default 'open',  -- open | closed | received | reconciled | flagged
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  file_path text,
  status text not null default 'pending',  -- pending | parsed | approved | rejected
  is_historical boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  parsed jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- ── Indexes ───────────────────────────────────────────────────────────────
create index if not exists idx_sales_date on public.sales(owner_id, date);
create index if not exists idx_purchases_date on public.purchases(owner_id, date);
create index if not exists idx_expenses_date on public.expenses(owner_id, date);
create index if not exists idx_moves_product on public.inventory_movements(owner_id, product_id);

-- ── View: live stock on-hand + weighted cost per product ──────────────────
create or replace view public.v_inventory_position as
select
  m.owner_id,
  m.product_id,
  sum(m.qty_delta) as on_hand,
  case
    when sum(case when m.qty_delta > 0 then m.qty_delta else 0 end) > 0
    then sum(case when m.qty_delta > 0 then m.qty_delta * coalesce(m.unit_cost,0) else 0 end)
         / sum(case when m.qty_delta > 0 then m.qty_delta else 0 end)
    else 0
  end as weighted_cost
from public.inventory_movements m
group by m.owner_id, m.product_id;

-- ── Triggers: stamp owner_id ──────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['products','product_aliases','sales','purchases','expenses',
    'inventory_movements','cash_counts','cheque_periods','import_jobs','audit_log','settings']
  loop
    execute format('drop trigger if exists trg_owner_%1$s on public.%1$s;', t);
    execute format('create trigger trg_owner_%1$s before insert on public.%1$s
      for each row execute function public.set_owner_id();', t);
  end loop;
end $$;

-- ── RLS: owner-only ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['products','product_aliases','sales','purchases','expenses',
    'inventory_movements','cash_counts','cheque_periods','import_jobs','audit_log','settings']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists p_owner_all on public.%I;', t);
    execute format($p$create policy p_owner_all on public.%I
      for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());$p$, t);
  end loop;
end $$;
