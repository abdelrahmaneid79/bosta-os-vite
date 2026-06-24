-- =====================================================================
-- BostaOS — Migration 0019: reference cost (per-sale COGS without purchases)
--
-- Additive + non-breaking. Adds products.reference_cost: an owner/backfilled
-- per-base-unit cost used to snapshot COGS when there is no weighted-average
-- cost yet (no purchase_batches). Unlike avg_cost (a DERIVED cache the WAC
-- engine recomputes from the inventory ledger), reference_cost is NEVER touched
-- by recompute — so it survives sale movements and seeds real COGS for
-- historical product-line imports.
--
-- Also reworks post_sale_item_movement so that:
--   * COGS basis = coalesce(avg_cost when > 0, reference_cost)  ← fallback
--   * cogs_at_sale is snapshotted whenever a cost is known, INDEPENDENT of the
--     inventory tracking gate (a cost is a cost; profitability shouldn't require
--     committing to live stock deduction).
--   * the stock-deduction inventory_movement is STILL gated by
--     inventory_tracking_start_date exactly as before (unchanged behaviour).
--
-- Safe to re-run. Run in the Supabase SQL editor.
-- =====================================================================

alter table products
  add column if not exists reference_cost numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_reference_cost_check') then
    alter table products add constraint products_reference_cost_check
      check (reference_cost is null or reference_cost >= 0);
  end if;
end $$;

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
  v_ref         numeric;
  v_cost        numeric;    -- effective COGS basis (avg_cost, else reference_cost)
  v_qty_base    numeric;
  v_cogs        numeric;    -- positive COGS magnitude for this line
  v_gate_open   boolean;
begin
  select sale_id, product_id, quantity, voided_at
    into v_sale_id, v_product_id, v_quantity, v_si_voided
    from sale_items where id = p_sale_item_id;
  if not found or v_si_voided is not null then
    return;
  end if;

  if v_product_id is null then
    update sale_items set cogs_at_sale = null where id = p_sale_item_id;
    return;
  end if;

  select sale_date, location_id, voided_at
    into v_sale_date, v_location_id, v_sale_voided
    from sales where id = v_sale_id;
  if not found or v_sale_voided is not null then
    return;
  end if;

  select coalesce(base_units_per_sale_unit, 1), avg_cost, reference_cost
    into v_factor, v_avg, v_ref
    from products where id = v_product_id;

  v_qty_base := v_quantity * v_factor;
  if v_qty_base = 0 then
    update sale_items set cogs_at_sale = null where id = p_sale_item_id;
    return;
  end if;

  -- COGS basis: real weighted-average cost when present, else the reference cost.
  v_cost := case when v_avg is not null and v_avg > 0 then v_avg
                 when v_ref is not null and v_ref > 0 then v_ref
                 else null end;

  -- Snapshot COGS whenever a cost is known — independent of the tracking gate.
  if v_cost is not null then
    v_cogs := v_qty_base * v_cost;
  else
    v_cogs := null;
  end if;
  update sale_items set cogs_at_sale = v_cogs where id = p_sale_item_id;

  -- Stock movement (deduction) stays gated by the tracking start date.
  select (value #>> '{}')::date into v_start
    from app_settings where key = 'inventory_tracking_start_date';
  v_gate_open := v_start is not null and v_sale_date >= v_start;
  if not v_gate_open then
    return;  -- profitability captured above; no stock movement before tracking start
  end if;

  insert into inventory_movements(
    product_id, location_id, movement_date, movement_type,
    quantity, unit_cost, total_cost,
    reference_type, reference_id, source_type, verification
  ) values (
    v_product_id, v_location_id, v_sale_date, 'sale',
    -v_qty_base, v_cost, v_cogs,
    'sale_item', p_sale_item_id, 'manual', 'verified'
  );
end;
$$;

grant execute on function post_sale_item_movement(uuid) to authenticated;
