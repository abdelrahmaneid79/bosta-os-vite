-- =====================================================================
-- 0046: pair failed ATM attempts with their reversal notice, and stop
-- counting them as cash the owner walked away with.
--
-- A failed withdrawal produces TWO messages: a debit, then a reversal with no
-- balance. bank_transactions held the debit, bank_reversals held the notice,
-- and nothing linked them — so cash withdrawn was overstated by 241,600 and
-- the owner-drawings residual inherited the whole error. That is a ~90% swing
-- on the number this whole exercise exists to produce, so it matters.
--
-- Pairing is by amount, oldest debit first, one debit consumed per notice. A
-- reversal notice states the exact figure, and repeated amounts are handled by
-- consuming one at a time. 19 of 20 pair; the unmatched 13,300 on 17/08 is one
-- of the two reversals whose refund the chain could never confirm either,
-- because that whole stretch of the recording is unreadable — consistent, not
-- a matching failure.
--
-- Also adds v_owner_burn: what the business earned against what the owner
-- actually took out. NOTHING is booked as an expense — see the note there.
-- =====================================================================
alter table bank_transactions
  add column if not exists was_reversed boolean not null default false;

with pairs as (
  select t.id,
         row_number() over (partition by t.amount order by t.txn_date, t.balance_after desc) as rn
    from bank_transactions t
   where t.voided_at is null and t.direction = 'debit'
     and t.category in ('cash_stock','cash_small')
),
need as (select amount, count(*) as n from bank_reversals group by amount)
update bank_transactions b
   set was_reversed = true
  from pairs p, need n
 where b.id = p.id and n.amount = b.amount and p.rn <= n.n;

drop view if exists v_owner_burn;
drop view if exists v_bank_month;

create view v_bank_month as
with span as (
  select min(txn_date) as from_date, max(txn_date) as to_date
    from bank_transactions where voided_at is null and txn_date is not null
),
m as (
  select to_char(txn_date,'YYYY-MM') as month,
         sum(coalesce(deposit_amount,0)) as banked,
         sum(case when direction='debit' and category in ('cash_stock','cash_small')
                   and not was_reversed then amount else 0 end) as cash_out,
         sum(case when direction='debit' and category in ('cash_stock','cash_small')
                   and was_reversed then amount else 0 end) as cash_attempts_reversed,
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
       coalesce(m.cash_attempts_reversed, 0) as cash_attempts_reversed,
       coalesce(m.personal_spend, 0) as personal_spend,
       coalesce(m.movements, 0) as movements,
       coalesce(m.unreadable_breaks, 0) as unreadable_breaks
  from m full outer join c on c.month = m.month
 order by 1;

-- WHY NOTHING IS BOOKED AS AN EXPENSE
-- The obvious move after loading the bank card would be to turn 1,098,180 of
-- ATM withdrawals into purchase or expense rows. That is wrong twice over. A
-- cash withdrawal is not spending — it is the owner's own money moving from
-- bank to pocket. And the stock it eventually buys is ALREADY in the P&L as
-- cogs_at_sale on every sale line. Booking both would double-count about a
-- million pounds and turn a profitable year into a fictional loss.
--
-- drawings_residual is a RESIDUAL and absorbs every upstream error. Two things
-- would make it overstate what he really pocketed: stock bought but not yet
-- sold (inventory_movements is empty, so this cannot be measured), and wages
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
  (coalesce(rev.revenue,0) > 0 and coalesce(cg.cogs,0) = 0) as cogs_missing,
  coalesce(bank.unreadable_breaks, 0) as unreadable_breaks
from rev
full join cg   on cg.ym   = rev.ym
full join dd   on dd.ym   = coalesce(rev.ym, cg.ym)
full join ex   on ex.ym   = coalesce(rev.ym, cg.ym, dd.ym)
full join bank on bank.ym = coalesce(rev.ym, cg.ym, dd.ym, ex.ym)
order by 1;
