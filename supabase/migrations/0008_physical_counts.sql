-- =====================================================================
-- BostaOS — Migration 0008: physical counts / actual-vs-expected (Session 10.5)
--
-- Adds a physical stock-count system that compares ACTUAL counted stock to the
-- EXPECTED ledger balance and reconciles through the EXISTING inventory ledger.
-- The ledger stays the source of truth: a count writes an
-- inventory_movements(type='count', quantity = difference) row, and the 0006
-- recompute trigger (trg_inv_mov_sync_stock -> recompute_product_costs) lands
-- current_stock on the counted value. products.current_stock is NEVER written
-- directly here, and there is NO alternative adjustment mechanism.
--
-- physical_counts is the INSIGHT/source document (expected/actual/variance
-- snapshot) for history and health views; the movement is the stock effect,
-- linked by reference_type='physical_count' / reference_id = physical_counts.id.
--
-- UNIT DECISION: counts are entered and stored in the product BASE UNIT, because
--   * it is the simplest reconciliation (counted_qty maps 1:1 to stock),
--   * it avoids sale-unit conversion ambiguity,
--   * it matches the units the ledger already stores,
--   * a future UI can convert display values (via base_units_per_sale_unit) if
--     the owner prefers to count in sale units — without changing this schema.
--
-- Costing: count movements are COST-NEUTRAL (unit_cost/total_cost NULL). Under
-- 0006 an inflow without unit_cost (and any outflow) leaves avg_cost unchanged,
-- so counts never change avg_cost, never create COGS, never create expenses.
--
-- NAMING NOTE: the audit "verification" column is named `verification` (type
-- verification_status) to match every existing table (sale_items,
-- purchase_batches, inventory_movements) — not `verification_status`.
--
-- LOCATIONS: the locations table already exists (referenced by location_terms
-- and inventory_movements.location_id), so the location_id FK below is retained
-- and safe.
--
-- app_settings: verified shape is (key PK, value jsonb, updated_at). `on
-- conflict (key)` is valid (same upsert key used by the tolerances setting).
--
-- MULTIPLE COUNTS PER DAY: ALLOWED by design — there is intentionally NO unique
-- constraint on (product_id, count_date). Each count reads the CURRENT stock at
-- confirm time and reconciles to its counted value, so repeated counts on the
-- same day compose correctly (the next count's expected = stock after the prior
-- count). Counts are locked per product (SELECT ... FOR UPDATE) to serialize
-- concurrent counts of the same product.
--
-- Out of scope (deferred): app code, RPC callers, pages, components, the
-- derived status labels (slightly-off / major-mismatch are computed in the app
-- from the app_settings thresholds seeded below), and any count UI.
--
-- Safe to re-run (create table/index if not exists, create or replace funcs,
-- guarded policy/trigger, on-conflict-do-nothing seeds). Run in the SQL editor.
-- =====================================================================

-- 1) Source document. quantities are in the product BASE UNIT (signed
--    difference allowed; counted_qty cannot be negative). avg_cost_at_count /
--    value_impact / variance_pct are frozen snapshots for insight; status is
--    derived in the app (no column). location_id is nullable for future
--    multi-location.
create table if not exists physical_counts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  location_id uuid references locations(id),
  count_date date not null default current_date,
  expected_qty numeric(14,3) not null,
  counted_qty numeric(14,3) not null check (counted_qty >= 0),
  difference numeric(14,3) not null,
  avg_cost_at_count numeric(14,4),       -- snapshot; may be 0 when cost unknown
  value_impact numeric(14,2),            -- difference * avg_cost_at_count
  variance_pct numeric(7,2),             -- NULL when expected_qty = 0
  notes text,
  source_type source_type not null default 'manual',
  verification verification_status not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);

create index if not exists idx_physical_counts_product
  on physical_counts (product_id, count_date desc)
  where voided_at is null;

-- 2) updated_at maintenance (shared helper). Drop-then-create = re-runnable.
drop trigger if exists trg_physical_counts_upd on physical_counts;
create trigger trg_physical_counts_upd before update on physical_counts
  for each row execute function set_updated_at();

-- 3) RLS — single-admin V1, matching every existing table.
alter table physical_counts enable row level security;
drop policy if exists admin_all on physical_counts;
create policy admin_all on physical_counts
  for all to authenticated using (true) with check (true);

-- 4) Count-status thresholds (percent). Seeded only if absent so owner edits
--    are preserved on re-run. Read by the app to label slightly-off / major.
insert into app_settings (key, value) values
  ('inventory_count_minor_variance_pct', to_jsonb(2)),
  ('inventory_count_major_variance_pct', to_jsonb(20))
on conflict (key) do nothing;

-- 5) Record a physical count atomically: snapshot expected/avg, write the
--    physical_counts row + the linked 'count' movement (only when there is a
--    non-zero difference), and let the recompute trigger land stock on actual.
--    Cost-neutral: unit_cost/total_cost stay NULL.
create or replace function record_physical_count(
  p_product_id   uuid,
  p_counted_qty  numeric,
  p_location_id  uuid,
  p_notes        text
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_expected numeric;
  v_avg      numeric;
  v_diff     numeric;
  v_variance numeric;
  v_value    numeric;
  v_id       uuid;
begin
  -- Lock the product row so concurrent counts of the same product serialize:
  -- each sees the committed stock left by the prior count before computing diff.
  select current_stock, avg_cost
    into v_expected, v_avg
    from products where id = p_product_id
    for update;
  if not found then
    raise exception 'record_physical_count: product % not found', p_product_id;
  end if;
  if p_counted_qty is null or p_counted_qty < 0 then
    raise exception 'record_physical_count: counted quantity must be >= 0';
  end if;

  v_diff     := p_counted_qty - v_expected;
  v_variance := case when v_expected <> 0
                     then round((v_diff / v_expected) * 100, 2)
                     else null end;
  v_value    := case when v_avg is not null
                     then round(v_diff * v_avg, 2)
                     else null end;

  insert into physical_counts (
    product_id, location_id, count_date, expected_qty, counted_qty,
    difference, avg_cost_at_count, value_impact, variance_pct, notes
  ) values (
    p_product_id, p_location_id, current_date, v_expected, p_counted_qty,
    v_diff, v_avg, v_value, v_variance, p_notes
  )
  returning id into v_id;

  -- Only post a ledger movement when stock actually changes.
  if v_diff <> 0 then
    insert into inventory_movements (
      product_id, location_id, movement_date, movement_type,
      quantity, unit_cost, total_cost,
      reference_type, reference_id, source_type, verification, notes
    ) values (
      p_product_id, p_location_id, current_date, 'count',
      v_diff, null, null,
      'physical_count', v_id, 'manual', 'verified', p_notes
    );
  end if;

  return jsonb_build_object(
    'count_id',     v_id,
    'expected_qty', v_expected,
    'counted_qty',  p_counted_qty,
    'difference',   v_diff,
    'variance_pct', v_variance,
    'value_impact', v_value
  );
end;
$$;

-- 6) Void a count: void its linked movement (recompute restores the pre-count
--    stock) and void the physical_counts row. Idempotent; returns product_id.
create or replace function void_physical_count(p_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_product_id uuid;
begin
  select product_id into v_product_id from physical_counts where id = p_id;
  if not found then
    raise exception 'void_physical_count: count % not found', p_id;
  end if;

  update inventory_movements
    set voided_at = now(), void_reason = 'Count voided'
    where reference_type = 'physical_count'
      and reference_id   = p_id
      and voided_at is null;

  update physical_counts
    set voided_at = coalesce(voided_at, now()),
        void_reason = coalesce(void_reason, 'Voided')
    where id = p_id;

  return v_product_id;
end;
$$;

-- 7) Grants — single-admin V1 (SECURITY INVOKER; RLS governs table writes).
grant execute on function record_physical_count(uuid, numeric, uuid, text) to authenticated;
grant execute on function void_physical_count(uuid) to authenticated;
