-- =====================================================================
-- BostaOS — financial tie-out (READ-ONLY; run anytime in the SQL editor)
-- Every row must return bad = 0. A non-zero row means a cached money value
-- has drifted from its ledger truth and needs recalc (never hand-editing).
--   settlement_drift      → run recalc_settlement_period(period_id)
--   money_account_drift   → run recalc_money_account(account_id)
--   reconciled_flag_drift → run check_sale_reconciliation(sale_id)
--   revenue_charge_drift  → run recalc_settlement_period(period_id)
--   rent_dup              → duplicate rent rows in a month: void the extras
--   stock_cache_drift     → run recompute_product_costs(product_id)
--   cheque_mm_duplication → same cheque present in BOTH cheques and
--                           money_movements(cheque_inflow): one must be voided
-- =====================================================================

-- 1) settlement period caches vs recomputed truth
select 'settlement_drift' check_name, count(*) bad from (
  select sp.id,
    sp.accumulated_revenue,
    coalesce((select sum(s.total_amount) from sales s where s.settlement_period_id = sp.id and s.voided_at is null),0) true_rev,
    sp.total_deductions,
    coalesce((select sum(d.amount) from settlement_deductions d where d.settlement_period_id = sp.id and d.voided_at is null),0) true_ded,
    sp.net_expected
  from settlement_periods sp where sp.voided_at is null
) x
where x.accumulated_revenue <> x.true_rev
   or x.total_deductions <> x.true_ded
   or x.net_expected <> round(x.true_rev - x.true_ded, 2)

union all
-- 2) money account cached balance vs movement sum
select 'money_account_drift', count(*) from (
  select a.id from money_accounts a
  where a.current_balance <> a.opening_balance +
    coalesce((select sum(m.amount) from money_movements m where m.account_id = a.id and m.voided_at is null),0)
) y

union all
-- 3) sales.reconciled vs tolerance recheck (max(abs, pct·total) from app_settings)
select 'reconciled_flag_drift', count(*) from (
  select s.id, s.reconciled,
    (not exists(select 1 from sale_items si where si.sale_id = s.id and si.voided_at is null))
    or abs(s.total_amount - coalesce((select sum(si.line_total) from sale_items si where si.sale_id = s.id and si.voided_at is null),0))
       <= greatest(coalesce(get_setting_numeric('recon_tolerance_abs'), 5),
                   coalesce(get_setting_numeric('recon_tolerance_pct'), 0.005) * s.total_amount) as should_be
  from sales s where s.voided_at is null
) z where z.reconciled <> z.should_be

union all
-- 4) auto revenue_charge = round(monthly revenue × rate, 2) where not overridden
select 'revenue_charge_drift', count(*) from (
  select d.id from settlement_deductions d
  join settlement_periods sp on sp.id = d.settlement_period_id
  where d.deduction_type='revenue_charge' and d.manual_override=false
    and d.voided_at is null and sp.voided_at is null
    and d.amount <> round(sp.accumulated_revenue * coalesce(d.rate,0), 2)
) w

union all
-- 5) rent seeded exactly once per period (flat, never doubled)
select 'rent_dup', count(*) from (
  select settlement_period_id from settlement_deductions
  where deduction_type='rent' and voided_at is null group by 1 having count(*) > 1
) v

union all
-- 6) products stock/cost caches vs full ledger replay (WAC contract)
select 'stock_cache_drift', count(*) from (
  select p.id from products p
  where p.current_stock <> coalesce((
    select sum(m.quantity) from inventory_movements m
    where m.product_id = p.id and m.voided_at is null),0)
) u

union all
-- 7) cheque double-entry: a cheques row AND a cheque_inflow movement for the
--    same (date, amount) means the same money is recorded twice
select 'cheque_mm_duplication', count(*) from (
  select mm.id from money_movements mm
  where mm.voided_at is null and mm.movement_type = 'cheque_inflow'
    and exists (select 1 from cheques c where c.voided_at is null
                  and c.received_date = mm.movement_date
                  and c.amount_received = mm.amount)
) t;
