-- =====================================================================
-- 0045: what the business earned vs what the owner actually took out,
-- and cash-out measured from the balance chain rather than inferred.
--
-- WHY NOTHING IS BOOKED AS AN EXPENSE
-- The obvious move after loading the bank card would be to turn 1,098,180 of
-- ATM withdrawals into purchase or expense rows. That is wrong twice over. A
-- cash withdrawal is not spending — it is the owner's own money moving from
-- bank to pocket. And the stock it eventually buys is ALREADY in the P&L as
-- cogs_at_sale on every sale line. Booking both would double-count about a
-- million pounds and turn a profitable year into a fictional loss. So the
-- withdrawals stay as what they are and this reconciles rather than invents.
--
-- HOW CASH OUT IS MEASURED, AND A BUG NOT TO REPEAT
-- A failed ATM attempt sends a debit and then a reversal notice carrying no
-- balance. An earlier attempt at this added a was_reversed flag and paired
-- reversals to debits BY AMOUNT ALONE. That mis-paired 8 of 20 — a reversal
-- on 27/01 claimed a 4,000 withdrawal on 17/08 — and, worse, it flagged rows
-- where dedupe had already merged a failed attempt and its successful retry
-- into one row (both reported the same balance), deleting 23,000 of cash that
-- genuinely left.
--
-- The balance chain already answers this without inference: when a refund
-- lands, it shows up as an upward gap on the next row (is_reversal_refund).
-- So cash out = cash debits MINUS the refunds the chain actually observes.
-- Purely measured, and it handles the merged case correctly by construction.
-- The flag is gone; do not bring it back.
--
-- Of 254,900 in reversal notices the chain observes 218,600 returning. The
-- other 36,300 is two notices: the 23,000 whose merged row already nets out,
-- and a 13,300 whose debit message the recording never captured at all.
-- =====================================================================
drop view if exists v_owner_burn;
drop view if exists v_bank_month;
alter table bank_transactions drop column if exists was_reversed;

create view v_bank_month as
with span as (
  select min(txn_date) as from_date, max(txn_date) as to_date
    from bank_transactions where voided_at is null and txn_date is not null
),
m as (
  select to_char(txn_date,'YYYY-MM') as month,
         sum(coalesce(deposit_amount,0)) as banked,
         sum(case when direction='debit' and category in ('cash_stock','cash_small')
                  then amount else 0 end)
           - sum(case when is_reversal_refund then coalesce(chain_gap,0) else 0 end) as cash_out,
         sum(case when is_reversal_refund then coalesce(chain_gap,0) else 0 end) as refunds_returned,
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
         sum(l.net_received) as cheques_net, count(*) as cheque_count
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
       coalesce(m.refunds_returned, 0) as refunds_returned,
       coalesce(m.personal_spend, 0) as personal_spend,
       coalesce(m.movements, 0) as movements,
       coalesce(m.unreadable_breaks, 0) as unreadable_breaks
  from m full outer join c on c.month = m.month
 order by 1;

-- drawings_residual is a RESIDUAL and absorbs every upstream error. Two things
-- would make it overstate what he really pocketed: stock bought but not yet
-- sold (inventory_movements is empty, so this cannot be measured) and wages
-- under-recorded (only ~46k of salary on file for 13 months). Both are shown
-- in the app rather than silently absorbed.
create view v_owner_burn as
with span as (
  select min(txn_date) as from_date, max(txn_date) as to_date
    from bank_transactions where voided_at is null and txn_date is not null
),
rev as (
  select to_char(s.sale_date,'YYYY-MM') as ym, sum(s.total_amount) as revenue
    from sales s, span sp
   where s.voided_at is null and s.sale_date between sp.from_date and sp.to_date group by 1
),
cg as (
  select to_char(s.sale_date,'YYYY-MM') as ym, sum(i.cogs_at_sale) as cogs
    from sale_items i join sales s on s.id = i.sale_id, span sp
   where i.voided_at is null and s.voided_at is null
     and s.sale_date between sp.from_date and sp.to_date group by 1
),
dd as (
  select to_char(l.received_date,'YYYY-MM') as ym, sum(l.deductions) as mall_deductions
    from v_cheque_ledger l, span sp
   where l.received_date between sp.from_date and sp.to_date group by 1
),
ex as (
  select to_char(e.expense_date,'YYYY-MM') as ym,
         coalesce(sum(e.amount) filter (where c.name = 'Inventory purchases'), 0) as inventory_recorded,
         coalesce(sum(e.amount) filter (where c.name is distinct from 'Inventory purchases'), 0) as running_costs
    from expenses e left join expense_categories c on c.id = e.category_id, span sp
   where e.voided_at is null and e.expense_date between sp.from_date and sp.to_date group by 1
),
bank as (select month as ym, kept_as_cash, cash_out, personal_spend, unreadable_breaks from v_bank_month)
select
  coalesce(rev.ym, cg.ym, dd.ym, ex.ym, bank.ym) as month,
  coalesce(rev.revenue, 0) as revenue,
  coalesce(cg.cogs, 0) as cogs,
  coalesce(dd.mall_deductions, 0) as mall_deductions,
  coalesce(ex.running_costs, 0) as running_costs,
  coalesce(ex.inventory_recorded, 0) as inventory_recorded,
  coalesce(rev.revenue,0) - coalesce(dd.mall_deductions,0)
    - coalesce(cg.cogs,0) - coalesce(ex.running_costs,0) as profit,
  coalesce(bank.kept_as_cash, 0) as cash_kept_from_cheques,
  coalesce(bank.cash_out, 0) as cash_from_atm,
  coalesce(bank.kept_as_cash,0) + coalesce(bank.cash_out,0) as cash_available,
  coalesce(cg.cogs,0) + coalesce(ex.running_costs,0) as cash_the_business_needed,
  coalesce(bank.kept_as_cash,0) + coalesce(bank.cash_out,0)
    - coalesce(cg.cogs,0) - coalesce(ex.running_costs,0) as drawings_residual,
  coalesce(bank.personal_spend, 0) as personal_card_spend,
  -- Sales recorded but no cost of sales: the product breakdown is missing, so
  -- this month's profit would be the whole revenue. Excluded from every average.
  (coalesce(rev.revenue,0) > 0 and coalesce(cg.cogs,0) = 0) as cogs_missing,
  coalesce(bank.unreadable_breaks, 0) as unreadable_breaks
from rev
full join cg   on cg.ym   = rev.ym
full join dd   on dd.ym   = coalesce(rev.ym, cg.ym)
full join ex   on ex.ym   = coalesce(rev.ym, cg.ym, dd.ym)
full join bank on bank.ym = coalesce(rev.ym, cg.ym, dd.ym, ex.ym)
order by 1;
