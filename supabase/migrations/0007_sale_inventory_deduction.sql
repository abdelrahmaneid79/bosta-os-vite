-- =====================================================================
-- BostaOS — Migration 0007: automatic sale inventory deduction (Session 10)
--
-- Makes a sale line deduct stock through the ledger, atomically and
-- symmetric with the purchase RPCs (0005). Each qualifying sale_item gets a
-- linked inventory_movements(type='sale', negative quantity); COGS is
-- snapshotted onto sale_items.cogs_at_sale at write time and never mutated by
-- later purchases. products.current_stock / avg_cost stay derived caches
-- (0006 recompute trigger does the math; a 'sale' outflow is cost-neutral).
--
-- Locked behavior:
--   * Conversion: quantity_base = sale_items.quantity * products.base_units_per_sale_unit.
--   * Tracking gate: app_settings 'inventory_tracking_start_date'. UNSET =>
--     deduction DISABLED. Set => deduct only when sales.sale_date >= start.
--   * Oversell allowed (stock may go negative); never blocked.
--   * Missing/zero avg_cost => movement unit_cost/total_cost NULL and
--     cogs_at_sale NULL ("cost unknown"); sale still deducts.
--   * Edit = void old movement + create new; delete item = void movement then
--     delete; void/delete sale day = void_sale_movements() first.
--   * Anti-double-deduction: at most one ACTIVE movement per sale_item.
--
-- Out of scope (deferred): physical_counts / count system (Session 10.5 / 0008),
-- profitability (Session 11), dashboard changes, and any one-time backfill of
-- pre-existing sale_items (done deliberately AFTER the owner sets the start
-- date; existing lines gain a movement when next edited via update_sale_item).
--
-- Safe to re-run (add ... if not exists, create or replace, guarded constraint,
-- idempotent grants). Run in the Supabase SQL editor.
-- =====================================================================

-- 1) Per-product sale-unit -> base-unit conversion factor. Default 1 keeps
--    existing products behaving as "quantity is already in base units".
alter table products
  add column if not exists base_units_per_sale_unit numeric not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_base_units_per_sale_unit_check'
  ) then
    alter table products
      add constraint products_base_units_per_sale_unit_check
      check (base_units_per_sale_unit > 0);
  end if;
end $$;

-- 2) Anti-double-deduction: at most ONE non-voided movement may reference a
--    given sale_item. Partial-unique, scoped so it never affects purchase rows.
create unique index if not exists uq_inv_mov_active_sale_item
  on inventory_movements (reference_id)
  where reference_type = 'sale_item' and voided_at is null;

-- 3) Internal helper: (re)create the linked 'sale' movement for one sale_item
--    and snapshot its COGS — applying the conversion, tracking gate and
--    missing-cost rule. No-ops (and clears cogs) when deduction doesn't apply.
--    Callers MUST have voided any prior active movement first (see the index).
create or replace function post_sale_item_movement(p_sale_item_id uuid)
returns void language plpgsql as $$
declare
  v_sale_id     uuid;
  v_product_id  uuid;
  v_quantity    numeric;
  v_si_voided   timestamptz;
  v_sale_date   date;
  v_location_id uuid;
  v_sale_voided timestamptz;
  v_start       date;
  v_factor      numeric;
  v_avg         numeric;
  v_qty_base    numeric;
  v_unit_cost   numeric;
  v_total_cost  numeric;
begin
  select sale_id, product_id, quantity, voided_at
    into v_sale_id, v_product_id, v_quantity, v_si_voided
    from sale_items where id = p_sale_item_id;
  if not found or v_si_voided is not null then
    return;  -- missing or voided line: nothing to post
  end if;

  -- Unmatched line (no product) cannot deduct.
  if v_product_id is null then
    update sale_items set cogs_at_sale = null where id = p_sale_item_id;
    return;
  end if;

  select sale_date, location_id, voided_at
    into v_sale_date, v_location_id, v_sale_voided
    from sales where id = v_sale_id;
  if not found or v_sale_voided is not null then
    return;  -- parent sale gone/voided
  end if;

  -- Tracking gate: disabled when unset; skip lines before the start date.
  select (value #>> '{}')::date
    into v_start
    from app_settings where key = 'inventory_tracking_start_date';
  if v_start is null or v_sale_date < v_start then
    update sale_items set cogs_at_sale = null where id = p_sale_item_id;
    return;
  end if;

  select coalesce(base_units_per_sale_unit, 1), avg_cost
    into v_factor, v_avg
    from products where id = v_product_id;

  v_qty_base := v_quantity * v_factor;
  if v_qty_base = 0 then
    update sale_items set cogs_at_sale = null where id = p_sale_item_id;
    return;  -- zero-quantity line: no movement
  end if;

  -- Missing/zero avg_cost => cost unknown (NULL), but still deduct stock.
  if v_avg is not null and v_avg > 0 then
    v_unit_cost  := v_avg;
    v_total_cost := v_qty_base * v_avg;   -- positive COGS magnitude
  else
    v_unit_cost  := null;
    v_total_cost := null;
  end if;

  insert into inventory_movements(
    product_id, location_id, movement_date, movement_type,
    quantity, unit_cost, total_cost,
    reference_type, reference_id, source_type, verification
  ) values (
    v_product_id, v_location_id, v_sale_date, 'sale',
    -v_qty_base, v_unit_cost, v_total_cost,
    'sale_item', p_sale_item_id, 'manual', 'verified'
  );

  update sale_items set cogs_at_sale = v_total_cost where id = p_sale_item_id;
end;
$$;

-- 4) Create a sale line + its linked movement atomically, then reconcile.
create or replace function create_sale_item(
  p_sale_id          uuid,
  p_product_id       uuid,
  p_raw_product_name text,
  p_quantity         numeric,
  p_unit_price       numeric,
  p_line_total       numeric,
  p_notes            text
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into sale_items(
    sale_id, product_id, raw_product_name, quantity,
    unit_price, line_total, notes, verification
  ) values (
    p_sale_id, p_product_id, p_raw_product_name, p_quantity,
    p_unit_price, p_line_total, p_notes, 'verified'
  ) returning id into v_id;

  perform post_sale_item_movement(v_id);
  perform check_sale_reconciliation(p_sale_id);
  return v_id;
end;
$$;

-- 5) Edit a sale line: void the old movement FIRST (satisfies the unique
--    index), update the line, re-post a fresh movement + COGS snapshot.
create or replace function update_sale_item(
  p_id               uuid,
  p_product_id       uuid,
  p_raw_product_name text,
  p_quantity         numeric,
  p_unit_price       numeric,
  p_line_total       numeric,
  p_notes            text
) returns uuid language plpgsql as $$
declare v_sale_id uuid;
begin
  select sale_id into v_sale_id from sale_items where id = p_id;
  if v_sale_id is null then
    raise exception 'update_sale_item: sale item % not found', p_id;
  end if;

  update inventory_movements
    set voided_at = now(), void_reason = 'Sale item edited'
    where reference_type = 'sale_item'
      and reference_id   = p_id
      and voided_at is null;

  update sale_items set
    product_id       = p_product_id,
    raw_product_name = p_raw_product_name,
    quantity         = p_quantity,
    unit_price       = p_unit_price,
    line_total       = p_line_total,
    notes            = p_notes,
    cogs_at_sale     = null,        -- re-snapshotted by post (or left null)
    edited_at        = now()
  where id = p_id;

  perform post_sale_item_movement(p_id);
  perform check_sale_reconciliation(v_sale_id);
  return p_id;
end;
$$;

-- 6) Delete a sale line: void its movement (restores stock via recompute),
--    then remove the line; reconcile the day.
create or replace function delete_sale_item(p_id uuid)
returns uuid language plpgsql as $$
declare v_sale_id uuid;
begin
  select sale_id into v_sale_id from sale_items where id = p_id;
  if v_sale_id is null then
    return null;  -- already gone
  end if;

  update inventory_movements
    set voided_at = now(), void_reason = 'Sale item deleted'
    where reference_type = 'sale_item'
      and reference_id   = p_id
      and voided_at is null;

  delete from sale_items where id = p_id;
  perform check_sale_reconciliation(v_sale_id);
  return v_sale_id;
end;
$$;

-- 7) Void every active sale movement for a day's lines. Called BEFORE voiding
--    or deleting a sale so stock is restored through the ledger recompute.
create or replace function void_sale_movements(p_sale_id uuid)
returns void language plpgsql as $$
begin
  update inventory_movements m
    set voided_at = now(), void_reason = 'Sale voided/deleted'
    where m.reference_type = 'sale_item'
      and m.voided_at is null
      and m.reference_id in (select id from sale_items where sale_id = p_sale_id);
end;
$$;

-- 8) Grants — single-admin V1 (SECURITY INVOKER default; RLS still governs the
--    underlying table writes).
grant execute on function post_sale_item_movement(uuid) to authenticated;
grant execute on function create_sale_item(uuid, uuid, text, numeric, numeric, numeric, text) to authenticated;
grant execute on function update_sale_item(uuid, uuid, text, numeric, numeric, numeric, text) to authenticated;
grant execute on function delete_sale_item(uuid) to authenticated;
grant execute on function void_sale_movements(uuid) to authenticated;
