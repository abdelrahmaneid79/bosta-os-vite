-- 0016 — Determinism fix for the cash running balance.
-- The final account balance is an order-independent SUM and is UNCHANGED. The
-- only change: the per-movement running `balance_after` now breaks exact
-- (movement_date, created_at) ties by `id`, so display order is deterministic
-- under concurrency. No money math is altered.
create or replace function public.recalc_money_account(p_account_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare v_open numeric; v_final numeric;
begin
  select opening_balance into v_open from money_accounts where id = p_account_id;

  with ordered as (
    select id,
           sum(amount) over (order by movement_date, created_at, id
                             rows between unbounded preceding and current row) as run
    from money_movements
    where account_id = p_account_id and voided_at is null
  )
  update money_movements mm
    set balance_after = v_open + o.run
    from ordered o where mm.id = o.id;

  select v_open + coalesce(sum(amount),0) into v_final
    from money_movements where account_id = p_account_id and voided_at is null;

  update money_accounts set current_balance = v_final, updated_at = now()
    where id = p_account_id;
end;
$function$;
