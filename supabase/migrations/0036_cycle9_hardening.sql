-- =====================================================================
-- 0036: Cycle 9 production hardening — ADDITIVE ONLY.
--
-- Nothing here rewrites history or changes an existing value. It adds:
--   * daily-close lifecycle: version, confidence, source-data timestamp,
--     stale detection, owner confirmations, auto-detected snapshot, reopen
--     trail — so a close is an auditable versioned record, not a boolean.
--   * operational_exceptions: ONE canonical lifecycle store for every
--     operational issue (stable deterministic id), consumed by Alerts,
--     Missing-Data and the Strategist instead of three parallel systems.
--   * strategist_actions execution timestamps (accepted/started/overdue) +
--     linked_exception_id so recommendation execution can be tracked.
--   * idempotency_key on the high-risk mutation tables (+ unique partial
--     indexes) so a double-click / retry / concurrent tab cannot create a
--     duplicate financial record.
--
-- Cash/stock manual adjustments reuse existing structures (money_movements
-- 'adjustment' type; physical_counts) — no new financial account is created.
-- =====================================================================

/* ── daily-close lifecycle ─────────────────────────────────────────────── */
alter table daily_closes
  add column if not exists version int not null default 1,
  add column if not exists confidence text not null default 'medium'
    check (confidence in ('high','medium','low')),
  add column if not exists source_data_at timestamptz,          -- max(updated_at) of the day's records at close time
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_reason text,
  add column if not exists confirmations jsonb not null default '{}'::jsonb,  -- owner attestations BostaOS cannot derive
  add column if not exists auto_detected jsonb not null default '[]'::jsonb,  -- derived checklist snapshot at close time
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by text,
  add column if not exists reopen_reason text;

-- widen the status vocabulary to the Cycle 9 state machine
-- (open / ready / complete / partial / estimated / no_trading / reopened;
--  'voided' is represented by voided_at, not a status value).
alter table daily_closes drop constraint if exists daily_closes_status_check;
alter table daily_closes
  add constraint daily_closes_status_check
  check (status in ('open','ready','complete','partial','estimated','no_trading','reopened'));

/* ── canonical operational-exception lifecycle ─────────────────────────── */
create table if not exists operational_exceptions (
  id text primary key,                       -- STABLE deterministic id (type + entity/date)
  type text not null,
  severity text not null
    check (severity in ('critical','high','medium','low','info')),
  status text not null default 'open'
    check (status in ('open','acknowledged','in_progress','resolved','dismissed','reopened','suppressed')),
  title text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  recurrence_count int not null default 1,
  last_severity_rank int not null default 0, -- lets "materially worsened" reopen a dismissed issue
  last_amount numeric(14,2),
  resolved_at timestamptz,
  reopened_at timestamptz,
  acknowledged_at timestamptz,
  dismissed_at timestamptz,
  dismiss_reason text,
  suppressed_until date,
  owner_note text,
  linked_action_id uuid references strategist_actions(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists idx_op_exceptions_status on operational_exceptions(status);
create index if not exists idx_op_exceptions_last_seen on operational_exceptions(last_seen_at desc);

/* ── recommendation execution tracking ────────────────────────────────── */
alter table strategist_actions
  add column if not exists accepted_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists overdue_notified_at timestamptz,
  add column if not exists linked_exception_id text;

/* ── idempotency keys (double-submit / retry / concurrent-tab safety) ──── */
alter table expenses            add column if not exists idempotency_key text;
alter table money_movements     add column if not exists idempotency_key text;
alter table cheques             add column if not exists idempotency_key text;
alter table cash_reconciliations add column if not exists idempotency_key text;
alter table physical_counts     add column if not exists idempotency_key text;

create unique index if not exists uq_expenses_idem            on expenses(idempotency_key)             where idempotency_key is not null;
create unique index if not exists uq_movements_idem           on money_movements(idempotency_key)      where idempotency_key is not null;
create unique index if not exists uq_cheques_idem             on cheques(idempotency_key)              where idempotency_key is not null;
create unique index if not exists uq_cash_recon_idem          on cash_reconciliations(idempotency_key) where idempotency_key is not null;
create unique index if not exists uq_physical_counts_idem     on physical_counts(idempotency_key)      where idempotency_key is not null;

/* ── RLS — single-owner model, matching every other table ─────────────── */
do $$
begin
  execute 'alter table operational_exceptions enable row level security';
  execute 'drop policy if exists admin_all on operational_exceptions';
  execute 'create policy admin_all on operational_exceptions for all to authenticated using (true) with check (true)';
end $$;
