-- =====================================================================
-- BostaOS — Migration 0003: inventory ledger (ADR-001)
--
-- Makes the ledger the SOURCE OF TRUTH for stock. products.current_stock
-- becomes a cache that is recomputed from inventory_movements and is never
-- written directly by application code. Additive and non-breaking.
--
-- Scope (Session 7): product stock balances via a movement ledger only.
-- This migration does NOT create purchase batches (Session 8), does NOT
-- deduct stock from sales (Session 10), and does NOT compute weighted-average
-- cost or profitability (Session 9). The cost columns below exist but stay
-- NULL/unused for now — they are reserved for future purchase/sale costing.
-- =====================================================================

-- 1) Movement types — a signed-quantity ledger; the type records the cause.
create type inventory_movement_type as enum (
  'opening',     -- initial stock load
  'purchase',    -- stock in, from a purchase batch     (Session 8)
  'sale',        -- stock out, from a sale line          (Session 10)
  'adjustment',  -- manual correction (+/-)
  'count',       -- physical-count reconciliation delta
  'wastage',     -- spoilage / shrinkage (out)
  'return',      -- customer / supplier return
  'transfer'     -- inter-location transfer (signed)
);

-- 2) The ledger. Quantity is SIGNED, in the product base unit (grams for
--    weight items). unit_cost / total_cost are reserved for future
--    purchase/sale costing (Session 9+); they stay NULL in Session 7.
create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  location_id uuid references locations(id),
  movement_date date not null default current_date,
  movement_type inventory_movement_type not null,
  quantity numeric(14,3) not null,            -- signed (+in / -out), base unit
  unit_cost numeric(14,4),                    -- reserved for costing; NULL in Session 7
  total_cost numeric(14,2),                   -- reserved for costing; NULL in Session 7
  reference_type text,                        -- 'purchase_batch' | 'sale_item' | 'count' | ...
  reference_id uuid,                          -- soft link (no hard FK; provider-agnostic)
  notes text,
  source_type source_type not null default 'manual',
  verification verification_status not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
create index idx_inv_mov_product on inventory_movements(product_id, movement_date)
  where voided_at is null;
create index idx_inv_mov_ref on inventory_movements(reference_type, reference_id);
create trigger trg_inv_mov_upd before update on inventory_movements
  for each row execute function set_updated_at();

-- 3) Recompute the cache from the ledger (ADR-001). current_stock is derived,
--    never authoritative. avg_cost is left to Session 9 (weighted average)
--    and stays 0 here.
create or replace function recompute_product_stock(p_product_id uuid)
returns void language plpgsql as $$
declare v_stock numeric;
begin
  select coalesce(sum(quantity), 0) into v_stock
    from inventory_movements
    where product_id = p_product_id and voided_at is null;
  update products set current_stock = v_stock, updated_at = now()
    where id = p_product_id;
end;
$$;

-- 4) Keep the cache in sync in-transaction. AFTER any ledger write the
--    affected product is recomputed; a product change recomputes old + new;
--    voids fall out of the function's non-voided filter. Touches only
--    products (whose own trigger is just set_updated_at), so no recursion.
create or replace function inventory_movements_sync_stock()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_product_stock(old.product_id);
    return old;
  end if;
  perform recompute_product_stock(new.product_id);
  if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
    perform recompute_product_stock(old.product_id);
  end if;
  return null;
end;
$$;
create trigger trg_inv_mov_sync_stock
  after insert or update or delete on inventory_movements
  for each row execute function inventory_movements_sync_stock();

-- 5) RLS — single-admin V1, matching every existing table.
alter table inventory_movements enable row level security;
create policy admin_all on inventory_movements
  for all to authenticated using (true) with check (true);
