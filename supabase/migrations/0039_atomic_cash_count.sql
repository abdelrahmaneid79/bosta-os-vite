-- =====================================================================
-- 0039: Cycle 13 hardening — atomic cash count.
--
-- Closes the known 3-round-trip race in recordCashCount (client did: insert
-- cash_reconciliations -> insert money_movements adjustment -> RPC
-- recalc_money_account, as 3 separate network calls). A failure between calls
-- could leave a reconciliation row with no matching adjustment, or an
-- adjustment posted without the account balance being recalculated.
--
-- record_cash_count() does all three in ONE transaction, modelled on the same
-- pattern as record_physical_count() (0008): advisory lock to serialize
-- concurrent counts on the same account, insert, conditional adjustment,
-- recalc — all-or-nothing. NO financial math changes: same tables, same
-- columns, same difference formula, same opening-baseline rule (baseline
-- differences are informational only and never post an adjustment).
-- =====================================================================

create or replace function record_cash_count(
  p_account_id uuid,
  p_count_date date,
  p_counted numeric,
  p_expected numeric,
  p_notes text,
  p_is_opening_baseline boolean,
  p_verification text,
  p_counted_source text,
  p_bank_balance numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_diff numeric;
  v_existing_id uuid;
  v_existing_diff numeric;
begin
  -- Idempotent replay: a retry with the same key returns the original result
  -- instead of raising a duplicate-key error or double-posting an adjustment.
  if p_idempotency_key is not null then
    select id, round(counted_amount - expected_balance, 2)
      into v_existing_id, v_existing_diff
      from cash_reconciliations where idempotency_key = p_idempotency_key;
    if v_existing_id is not null then
      return jsonb_build_object('id', v_existing_id, 'difference', v_existing_diff, 'replayed', true);
    end if;
  end if;

  -- Serialize concurrent counts on the same account so two tabs can't both
  -- post an adjustment off the same stale "expected" figure.
  perform pg_advisory_xact_lock(hashtext('cash_reconciliations.' || p_account_id::text));

  v_diff := round(p_counted - p_expected, 2);

  insert into cash_reconciliations (
    account_id, count_date, counted_amount, expected_balance, notes,
    is_opening_baseline, verification, counted_source, bank_balance,
    opening_difference, idempotency_key
  ) values (
    p_account_id, p_count_date, p_counted, p_expected, p_notes,
    p_is_opening_baseline, p_verification, p_counted_source, p_bank_balance,
    case when p_is_opening_baseline then v_diff else null end, p_idempotency_key
  )
  returning id into v_id;

  -- A non-baseline count with a real difference posts a voidable adjustment
  -- movement and recalculates the account balance IN THE SAME TRANSACTION —
  -- a failure here now rolls back the reconciliation row too, instead of
  -- leaving it orphaned with no adjustment.
  if not p_is_opening_baseline and v_diff <> 0 then
    insert into money_movements (
      account_id, movement_date, movement_type, amount,
      reference_type, reference_id, notes, source_type
    ) values (
      p_account_id, p_count_date, 'adjustment', v_diff,
      'cash_reconciliation', v_id,
      coalesce(p_notes, 'Cash count: counted ' || p_counted || ' vs expected ' || p_expected),
      'manual'
    );
    perform recalc_money_account(p_account_id);
  end if;

  return jsonb_build_object('id', v_id, 'difference', v_diff, 'replayed', false);
end $$;

comment on function record_cash_count is
  'Atomic cash-count write: reconciliation row + conditional adjustment movement + balance recalc in one transaction (Cycle 13 hardening — replaces a 3-round-trip client sequence).';

grant execute on function record_cash_count(uuid, date, numeric, numeric, text, boolean, text, text, numeric, text) to authenticated;
