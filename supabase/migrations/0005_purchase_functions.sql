-- =====================================================================
-- BostaOS — Migration 0005: purchase RPC functions (Phase 5, Session 8)
--
-- FUNCTIONS ONLY. No table/column/index/trigger/policy changes. Adds two
-- app-called transaction functions so a purchase batch and its inventory
-- movement are written (and voided) ATOMICALLY:
--
--   create_purchase(...)      one invoice → N (batch + 'purchase' movement) pairs
--   void_purchase_batch(...)  void a batch + its linked movement together
--
-- These are explicit, app-orchestrated transactions (called via supabase.rpc),
-- NOT an automatic doc→ledger trigger. The function body is the transaction:
-- any error rolls the whole call back, so there is never a batch without its
-- movement (no stock drift). products.current_stock stays a cache, recomputed
-- by the existing inventory_movements_sync_stock trigger (0003). Nothing here
-- reads or writes products.avg_cost — weighted COGS stays deferred (Session 9).
--
-- SECURITY INVOKER (default) so the single-admin RLS policies still govern.
-- Safe to re-run (create or replace). Run in the Supabase SQL editor.
-- =====================================================================

-- 1) Create one purchase invoice as N product lines, atomically. Each line
--    writes a purchase_batches row AND a matching inventory_movements row
--    (movement_type='purchase', positive base-unit quantity, soft-linked via
--    reference_type='purchase_batch' / reference_id=batch.id). total_cost is
--    taken as entered, or computed as round(quantity*unit_cost, 2) when omitted.
--    The action always passes source_type/verification; coalesce guards nulls.
create or replace function create_purchase(
  p_supplier_id   uuid,
  p_invoice_ref   text,
  p_purchase_date date,
  p_location_id   uuid,
  p_source_type   source_type,
  p_verification  verification_status,
  p_lines         jsonb
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_line        jsonb;
  v_batch_id    uuid;
  v_product_id  uuid;
  v_quantity    numeric(14,3);
  v_unit_cost   numeric(14,4);
  v_total_cost  numeric(14,2);
  v_src         source_type         := coalesce(p_source_type, 'manual');
  v_ver         verification_status := coalesce(p_verification, 'verified');
  v_batch_ids   uuid[] := '{}';
  v_product_ids uuid[] := '{}';
begin
  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'create_purchase: at least one line is required';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_quantity   := (v_line->>'quantity')::numeric;
    v_unit_cost  := (v_line->>'unit_cost')::numeric;
    v_total_cost := coalesce(
      (v_line->>'total_cost')::numeric,
      round(v_quantity * v_unit_cost, 2)
    );

    insert into purchase_batches(
      supplier_id, product_id, location_id, invoice_ref, purchase_date,
      quantity, unit_cost, total_cost, source_type, verification
    ) values (
      p_supplier_id, v_product_id, p_location_id, p_invoice_ref, p_purchase_date,
      v_quantity, v_unit_cost, v_total_cost, v_src, v_ver
    )
    returning id into v_batch_id;

    -- Ledger entry: stock IN, snapshotted cost. Exact column names per 0003.
    insert into inventory_movements(
      product_id, location_id, movement_date, movement_type,
      quantity, unit_cost, total_cost,
      reference_type, reference_id, source_type, verification
    ) values (
      v_product_id, p_location_id, p_purchase_date, 'purchase',
      v_quantity, v_unit_cost, v_total_cost,
      'purchase_batch', v_batch_id, v_src, v_ver
    );

    v_batch_ids   := v_batch_ids   || v_batch_id;
    v_product_ids := v_product_ids || v_product_id;
  end loop;

  -- product_ids may contain duplicates (same product on multiple lines); the
  -- caller dedupes for revalidation.
  return jsonb_build_object(
    'batch_ids',   to_jsonb(v_batch_ids),
    'product_ids', to_jsonb(v_product_ids)
  );
end;
$$;

-- 2) Void a purchase batch and its linked movement together, atomically.
--    STRICT: a batch with no linked movement is a stock-drift/integrity error
--    and raises (never silently succeeds). Idempotent only when the batch AND
--    its linked movement(s) are already voided → returns product_id. Returns
--    the batch's product_id so the caller can revalidate that product.
create or replace function void_purchase_batch(
  p_batch_id uuid,
  p_reason   text
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_product_id   uuid;
  v_batch_voided timestamptz;
  v_total_links  int;
  v_live_links   int;
  v_ts           timestamptz := now();
  v_reason       text := coalesce(nullif(btrim(p_reason), ''), 'Voided');
begin
  -- Batch must exist.
  select product_id, voided_at
    into v_product_id, v_batch_voided
  from purchase_batches
  where id = p_batch_id;
  if not found then
    raise exception 'void_purchase_batch: purchase batch % not found', p_batch_id;
  end if;

  -- Inspect the linked purchase movements: total, and how many are still live.
  select count(*), count(*) filter (where voided_at is null)
    into v_total_links, v_live_links
  from inventory_movements
  where reference_type = 'purchase_batch'
    and reference_id   = p_batch_id;

  -- Integrity: once Purchase Actions exist, every batch has a linked movement.
  -- A missing link means stock drift — surface it, do not hide it.
  if v_total_links = 0 then
    raise exception
      'void_purchase_batch: batch % has no linked inventory movement (stock-drift/integrity error)',
      p_batch_id;
  end if;

  -- Idempotent: batch already voided AND no live linked movement remains.
  if v_batch_voided is not null and v_live_links = 0 then
    return v_product_id;
  end if;

  -- Void the batch (preserve an existing void timestamp/reason if present).
  update purchase_batches
    set voided_at   = coalesce(voided_at, v_ts),
        void_reason = coalesce(void_reason, v_reason)
  where id = p_batch_id;

  -- Void any still-live linked movements; the sync trigger recomputes stock.
  update inventory_movements
    set voided_at   = v_ts,
        void_reason = v_reason
  where reference_type = 'purchase_batch'
    and reference_id   = p_batch_id
    and voided_at is null;

  return v_product_id;
end;
$$;

-- 3) Single-admin V1: let authenticated callers execute the RPCs (RLS still
--    governs the underlying table writes via SECURITY INVOKER).
grant execute on function create_purchase(uuid, text, date, uuid, source_type, verification_status, jsonb) to authenticated;
grant execute on function void_purchase_batch(uuid, text) to authenticated;
