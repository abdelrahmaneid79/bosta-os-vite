-- =====================================================================
-- 0032: sale-line "void" becomes a SOFT void (was a hard DELETE).
-- The app promised "never a hard money delete" — delete_sale_item was the
-- one exception: it soft-voided the inventory movement but DELETEd the
-- sale_items row, destroying the line-level audit trail.
-- Now the row stays, stamped voided_at/void_reason, exactly like sales,
-- expenses, cheques and movements. Every read and check_sale_reconciliation
-- already filter `voided_at is null`, so sums are unchanged.
-- Idempotent on already-voided lines; returns the parent sale id.
-- =====================================================================

create or replace function delete_sale_item(p_id uuid)
returns uuid language plpgsql as $$
declare v_sale_id uuid;
begin
  select sale_id into v_sale_id from sale_items where id = p_id and voided_at is null;
  if v_sale_id is null then
    return null;  -- missing or already voided
  end if;

  update inventory_movements
    set voided_at = now(), void_reason = 'Sale item voided'
    where reference_type = 'sale_item'
      and reference_id   = p_id
      and voided_at is null;

  update sale_items
    set voided_at = now(), void_reason = 'Voided by owner', updated_at = now()
    where id = p_id;

  perform check_sale_reconciliation(v_sale_id);
  return v_sale_id;
end;
$$;
