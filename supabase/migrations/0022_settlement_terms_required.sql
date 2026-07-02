-- =====================================================================
-- BostaOS — Migration 0022: no inlined settlement defaults (audit item A5)
--
-- ensure_monthly_settlement_period silently fell back to literal 15000 /
-- 0.03 when location_terms had no effective row — masking missing terms
-- with hard-coded business numbers (charter: rent & rate are configurable,
-- NEVER inlined). Now a missing term raises loudly; values come ONLY from
-- location_terms. Behavior is identical whenever terms exist (they do for
-- every live location since 0010's coverage backfill).
-- =====================================================================
create or replace function ensure_monthly_settlement_period(p_location_id uuid, p_month date)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_id uuid; v_rent numeric; v_rate numeric;
begin
  select id into v_id from settlement_periods
    where location_id = p_location_id and start_date = v_start and voided_at is null;
  if v_id is not null then
    return v_id;
  end if;

  select rent_amount, charge_rate into v_rent, v_rate
    from get_effective_terms(p_location_id, v_start);

  -- Loud, not silent: a missing term is a configuration error to fix in
  -- Settings (location_terms), never a number to invent here.
  if v_rent is null then
    raise exception 'ensure_monthly_settlement_period: no effective RENT term for location % on % — add one in location_terms', p_location_id, v_start;
  end if;
  if v_rate is null then
    raise exception 'ensure_monthly_settlement_period: no effective REVENUE_CHARGE term for location % on % — add one in location_terms', p_location_id, v_start;
  end if;

  insert into settlement_periods (location_id, start_date, end_date, status)
    values (p_location_id, v_start, v_end, 'open')
    returning id into v_id;

  insert into settlement_deductions
    (settlement_period_id, deduction_type, amount, rate, manual_override, notes)
  values
    (v_id, 'rent',           v_rent, null,   false, 'Monthly rent / stand fee (from location_terms; editable)'),
    (v_id, 'revenue_charge', 0,      v_rate, false, 'Auto: monthly revenue × rate');

  return v_id;
end;
$$;
