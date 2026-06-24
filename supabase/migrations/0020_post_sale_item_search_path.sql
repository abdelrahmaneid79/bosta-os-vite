-- =====================================================================
-- BostaOS — Migration 0020: pin search_path on post_sale_item_movement
--
-- Security hardening. 0019 redefined this function without a fixed search_path
-- (flagged by the database linter: function_search_path_mutable). Re-create it
-- identically but with `set search_path = public, pg_temp`. Non-breaking, safe
-- to re-run.
-- =====================================================================
create or replace function post_sale_item_movement(p_sale_item_id uuid)
returns void language plpgsql
set search_path = public, pg_temp
as $$
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
  v_cost        numeric;
  v_qty_base    numeric;
  v_cogs        numeric;
  v_gate_open   boolean;
begin
  select sale_id, product_id, quantity, voided_at
    into v_sale_id, v_product_id, v_quantity, v_si_voided
    from sale_items where id = p_sale_item_id;
  if not found or v_si_voided is not null then return; end if;

  if v_product_id is null then
    update sale_items set cogs_at_sale = null where id = p_sale_item_id;
    return;
  end if;

  select sale_date, location_id, voided_at
    into v_sale_date, v_location_id, v_sale_voided
    from sales where id = v_sale_id;
  if not found or v_sale_voided is not null then return; end if;

  select coalesce(base_units_per_sale_unit, 1), avg_cost, reference_cost
    into v_factor, v_avg, v_ref
    from products where id = v_product_id;

  v_qty_base := v_quantity * v_factor;
  if v_qty_base = 0 then
    update sale_items set cogs_at_sale = null where id = p_sale_item_id;
    return;
  end if;

  v_cost := case when v_avg is not null and v_avg > 0 then v_avg
                 when v_ref is not null and v_ref > 0 then v_ref
                 else null end;

  if v_cost is not null then v_cogs := v_qty_base * v_cost; else v_cogs := null; end if;
  update sale_items set cogs_at_sale = v_cogs where id = p_sale_item_id;

  select (value #>> '{}')::date into v_start
    from app_settings where key = 'inventory_tracking_start_date';
  v_gate_open := v_start is not null and v_sale_date >= v_start;
  if not v_gate_open then return; end if;

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
