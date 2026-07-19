-- =====================================================================
-- 0042: The Banque Misr card ****8300 ledger, read off the owner's SMS.
-- ADDITIVE ONLY. Nothing here changes sales, cheques or expenses; this is a
-- new, parallel record of what the *bank* saw, so the books can be checked
-- against it.
--
-- WHY THIS EXISTS
-- The mall pays by cheque. The owner banks part of each cheque and keeps the
-- rest as cash, then draws more cash from ATMs to buy stock. None of that was
-- visible anywhere in BostaOS. 13 months of bank SMS were transcribed from a
-- screen recording (8 Jul 2025 → 17 Jul 2026) and are loaded here.
--
-- WHAT IS TRUSTWORTHY, AND WHAT IS NOT
-- Every SMS states the balance left after it, so the rows chain together and a
-- missing message shows up as a break. `chain_gap` records that break:
--   0        → this row follows its predecessor exactly. Nothing hid.
--   > 0      → money arrived with no SMS. `deposit_amount` holds how much.
--   < 0      → money left with no SMS (the recording skipped a message).
-- `balance_derived` marks the ONE row whose balance was computed from the rows
-- either side rather than read, because its message was clipped off screen.
--
-- CATEGORY IS OWNER-EDITABLE. The import sets a first guess; `category_edited`
-- protects any row the owner has corrected, so a re-import never clobbers it.
-- =====================================================================

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  txn_date date,                       -- null only where the date was unreadable
  merchant text,                       -- verbatim ATM/shop descriptor from the SMS
  place text,                          -- 'Gardenia' | 'El Rehab' | 'Nasr City' | ...
  bank text,                           -- whose machine, for ATM rows
  direction text not null default 'debit' check (direction in ('debit','credit')),
  amount numeric(12,2),
  balance_after numeric(12,2),
  category text not null default 'unknown',
  side text not null default 'personal' check (side in ('business','personal','check','ignore')),
  category_edited boolean not null default false,   -- owner corrected it; leave alone
  note text,
  chain_gap numeric(12,2),             -- balance_after minus what the chain predicted
  deposit_amount numeric(12,2),        -- money that arrived just before this row
  is_reversal_refund boolean not null default false,
  balance_derived boolean not null default false,
  seen_count int not null default 1,   -- how many video frames showed this message
  raw text,
  source text not null default 'sms_recording_2026_07',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);
create index if not exists idx_bank_txn_date on bank_transactions(txn_date);
create index if not exists idx_bank_txn_cat  on bank_transactions(category);
create unique index if not exists idx_bank_txn_balance
  on bank_transactions(source, balance_after, amount) where voided_at is null;

-- Failed ATM attempts. The bank texts a debit, then a reversal with NO balance.
-- The money never left, so these must never be counted as spending — they live
-- in their own table rather than polluting the ledger.
create table if not exists bank_reversals (
  id uuid primary key default gen_random_uuid(),
  day_month text,                      -- 'DD/MM' as printed; the SMS shows no year
  txn_date date,
  merchant text,
  amount numeric(12,2) not null,
  refund_confirmed boolean not null default false,   -- chain shows the money returning
  note text,
  source text not null default 'sms_recording_2026_07',
  created_at timestamptz not null default now()
);

-- What the bank says, month by month, against what the cheque book says.
-- `banked` is what the balance chain shows arriving; `kept_as_cash` is the rest
-- of the cheque money — the part that never entered this account.
create or replace view v_bank_month as
with m as (
  select to_char(txn_date,'YYYY-MM') as month,
         sum(coalesce(deposit_amount,0))                                   as banked,
         sum(case when direction='debit' and category in ('cash_stock','cash_small')
                  then amount else 0 end)                                  as cash_out,
         sum(case when direction='debit' and side='personal'
                  then amount else 0 end)                                  as personal_spend,
         count(*)                                                          as movements,
         count(*) filter (where chain_gap is not null and abs(chain_gap) > 10
                            and coalesce(deposit_amount,0) = 0
                            and not is_reversal_refund)                    as unreadable_breaks
    from bank_transactions
   where voided_at is null and txn_date is not null
   group by 1
),
c as (
  select to_char(received_date,'YYYY-MM') as month,
         sum(net_received) as cheques_net,
         count(*)          as cheque_count
    from v_cheque_ledger
   where received_date is not null
   group by 1
)
select coalesce(m.month, c.month)                       as month,
       coalesce(c.cheques_net, 0)                       as cheques_net,
       coalesce(c.cheque_count, 0)                      as cheque_count,
       coalesce(m.banked, 0)                            as banked,
       coalesce(c.cheques_net, 0) - coalesce(m.banked,0) as kept_as_cash,
       coalesce(m.cash_out, 0)                          as cash_out,
       coalesce(m.personal_spend, 0)                    as personal_spend,
       coalesce(m.movements, 0)                         as movements,
       coalesce(m.unreadable_breaks, 0)                 as unreadable_breaks
  from m full outer join c on c.month = m.month
 order by 1;

do $$
begin
  execute 'alter table bank_transactions enable row level security';
  execute 'drop policy if exists admin_all on bank_transactions';
  execute 'create policy admin_all on bank_transactions for all to authenticated using (true) with check (true)';
  execute 'alter table bank_reversals enable row level security';
  execute 'drop policy if exists admin_all on bank_reversals';
  execute 'create policy admin_all on bank_reversals for all to authenticated using (true) with check (true)';
end $$;
