-- 0040_cheque_settlement_cycles.sql
-- Smart cheque-cycle tracking: every mall settlement cheque carries the EXACT date range
-- of sales it settled, so any trading day resolves to exactly one cheque, and any cheque
-- resolves to its exact days. The mall pays on variable cycles (monthly in the 20%-commission
-- era, ~7-14 day cycles in the rent+3% era); this models that natively instead of forcing
-- everything into calendar months.
--
-- Cycle date ranges + gross were populated one-time from the authoritative mall statement
-- workbook ("bosta cheques 30.10 till june.xlsx"), matched by cheque net → statement.
-- Verified: cycles are contiguous & non-overlapping across the whole business life
-- (2024-10-01 → 2026-07-13) — every pound is linked to a specific day and a specific cheque.

alter table cheques
  add column if not exists cycle_start date,
  add column if not exists cycle_end   date,
  add column if not exists cycle_gross numeric;

comment on column cheques.cycle_start is 'First calendar day of the sales cycle this cheque settled (mall statement period start)';
comment on column cheques.cycle_end   is 'Last calendar day of the sales cycle this cheque settled';
comment on column cheques.cycle_gross is 'Mall-recorded gross sales for the cycle (net = amount_received; deductions = cycle_gross - amount_received)';

-- "which cheque settled this day?" — the every-pound-traceable lookup
create or replace function cheque_for_date(p_date date)
returns table(cheque_id uuid, cycle_start date, cycle_end date, cycle_days int,
              cycle_gross numeric, net_received numeric, received_date date)
language sql stable set search_path to 'public','pg_temp' as $$
  select id, cycle_start, cycle_end, (cycle_end - cycle_start + 1), cycle_gross, amount_received, received_date
  from cheques
  where voided_at is null and cycle_start is not null and amount_received <> 32000  -- exclude the separate "nuts deal"
    and cycle_start <= p_date and cycle_end >= p_date
  order by cycle_start limit 1;
$$;

-- the settlement cheque ledger: each cheque, its exact cycle, days, gross→deductions→net,
-- and the POS sales actually recorded inside that range (cross-check).
create or replace view v_cheque_ledger as
select c.id, c.cycle_start, c.cycle_end, (c.cycle_end - c.cycle_start + 1) as cycle_days,
  c.received_date, c.cycle_gross,
  round(c.cycle_gross - c.amount_received, 2) as deductions,
  c.amount_received as net_received,
  (select round(coalesce(sum(s.total_amount),0)::numeric,2) from sales s
     where s.voided_at is null and s.sale_date between c.cycle_start and c.cycle_end) as pos_sales_in_range
from cheques c
where c.voided_at is null and c.cycle_start is not null and c.amount_received <> 32000;
