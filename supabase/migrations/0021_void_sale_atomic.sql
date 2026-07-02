-- =====================================================================
-- BostaOS — Migration 0021: atomic void_sale (audit item B2)
--
-- Voiding a sale day was TWO app calls (void_sale_movements RPC, then a
-- separate header update). A failure between them left the books half
-- updated: stock restored but revenue still counted. One function = one
-- transaction; the existing sales trigger recalcs the settlement period.
-- Idempotent: an already-voided sale returns without changes.
-- =====================================================================
create or replace function void_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_voided timestamptz;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Voided by owner');
begin
  select voided_at into v_voided from sales where id = p_sale_id;
  if not found then
    raise exception 'void_sale: sale % not found', p_sale_id;
  end if;
  if v_voided is not null then
    return; -- already voided; movements were voided in the same transaction
  end if;

  -- 1) void every active inventory movement of the day's lines (stock restores
  --    via the ledger recompute trigger)
  update inventory_movements m
    set voided_at = now(), void_reason = v_reason
    where m.reference_type = 'sale_item'
      and m.voided_at is null
      and m.reference_id in (select id from sale_items where sale_id = p_sale_id);

  -- 2) void the header (fires trg_sales_recalc_settlement -> period recalc)
  update sales
    set voided_at = now(), void_reason = v_reason
    where id = p_sale_id;
end;
$$;

grant execute on function void_sale(uuid, text) to authenticated;
