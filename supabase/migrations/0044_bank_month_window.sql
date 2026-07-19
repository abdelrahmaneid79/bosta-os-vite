-- =====================================================================
-- 0044: bound the bank month view to the window the SMS actually covers.
--
-- The recording starts 8 Jul 2025, but two cheques (2 Jul, 6 Jul) landed
-- before it. Counting them made July look like it had 56,436 "kept as cash"
-- when in truth the messages simply do not reach back that far — the app was
-- reporting an absence of evidence as evidence of cash kept. The cheque side
-- is now clamped to min/max txn_date, so every month compares like with like.
-- =====================================================================
create or replace view v_bank_month as
with span as (
  select min(txn_date) as from_date, max(txn_date) as to_date
    from bank_transactions where voided_at is null and txn_date is not null
),
m as (
  select to_char(txn_date,'YYYY-MM') as month,
         sum(coalesce(deposit_amount,0)) as banked,
         sum(case when direction='debit' and category in ('cash_stock','cash_small') then amount else 0 end) as cash_out,
         sum(case when direction='debit' and side='personal' then amount else 0 end) as personal_spend,
         count(*) as movements,
         count(*) filter (where chain_gap is not null and abs(chain_gap) > 10
                            and coalesce(deposit_amount,0) = 0 and not is_reversal_refund) as unreadable_breaks
    from bank_transactions
   where voided_at is null and txn_date is not null
   group by 1
),
c as (
  select to_char(l.received_date,'YYYY-MM') as month,
         sum(l.net_received) as cheques_net,
         count(*) as cheque_count
    from v_cheque_ledger l, span s
   where l.received_date between s.from_date and s.to_date
   group by 1
)
select coalesce(m.month, c.month) as month,
       coalesce(c.cheques_net, 0) as cheques_net,
       coalesce(c.cheque_count, 0) as cheque_count,
       coalesce(m.banked, 0) as banked,
       coalesce(c.cheques_net, 0) - coalesce(m.banked,0) as kept_as_cash,
       coalesce(m.cash_out, 0) as cash_out,
       coalesce(m.personal_spend, 0) as personal_spend,
       coalesce(m.movements, 0) as movements,
       coalesce(m.unreadable_breaks, 0) as unreadable_breaks
  from m full outer join c on c.month = m.month
 order by 1;
