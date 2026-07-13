-- =====================================================================
-- 0035: Cycle 8 activation — ADDITIVE ONLY.
-- Turns "unknowable" into "known" via live operational baselines without
-- corrupting history. Extends existing count tables (never duplicates them)
-- and adds structured amounts to strategist actions + a daily-close log.
--
--  * cash_reconciliations / physical_counts gain is_opening_baseline so the
--    FIRST verified count is modeled as a baseline, and any gap vs the
--    historical ledger is an OPENING DIFFERENCE — never an expense/loss/
--    withdrawal/shrinkage.
--  * cash_reconciliations gains verification, counted_source, bank_balance
--    (bank tracked separately from drawer; null = not tracked).
--  * strategist_actions gain structured financial fields so an accepted
--    financial action joins the obligation calendar / affordability / forecast.
--  * daily_closes: the operating-close log (one row per day/location).
-- Live-operations start date lives in app_settings key 'live_operations'
-- (owner-confirmed), alongside the existing books_start.
-- =====================================================================

alter table cash_reconciliations
  add column if not exists is_opening_baseline boolean not null default false,
  add column if not exists verification text not null default 'verified'
    check (verification in ('verified','estimated')),
  add column if not exists counted_source text not null default 'manual',
  add column if not exists bank_balance numeric(14,2),      -- null = not tracked
  add column if not exists opening_difference numeric(14,2),-- ledger-expected − counted, baseline only
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

alter table physical_counts
  add column if not exists is_opening_baseline boolean not null default false;

alter table strategist_actions
  add column if not exists amount numeric(14,2),
  add column if not exists recurring_amount numeric(14,2),
  add column if not exists recurrence text check (recurrence in ('once','monthly','weekly')),
  add column if not exists expected_date date,
  add column if not exists latest_date date,
  add column if not exists funding_status text not null default 'unfunded'
    check (funding_status in ('unfunded','funded','partial'));

create table if not exists daily_closes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  close_date date not null,
  status text not null default 'partial'
    check (status in ('complete','partial','estimated','no_trading')),
  completeness numeric(5,2) not null default 0,     -- 0–100
  checklist jsonb not null default '[]'::jsonb,      -- [{key,ok,note}]
  key_numbers jsonb,                                 -- {revenue, expenses, ...} snapshot refs
  unresolved jsonb not null default '[]'::jsonb,
  next_action text,
  notes text,
  closed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  unique (location_id, close_date)
);
create index if not exists idx_daily_closes_date on daily_closes(close_date desc);

-- RLS — single-owner model, matching every other table
do $$
begin
  execute 'alter table daily_closes enable row level security';
  execute 'drop policy if exists admin_all on daily_closes';
  execute 'create policy admin_all on daily_closes for all to authenticated using (true) with check (true)';
end $$;
