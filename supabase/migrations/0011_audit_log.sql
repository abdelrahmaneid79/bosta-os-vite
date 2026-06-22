-- =====================================================================
-- BostaOS — Migration 0011: append-only audit log (observability)
--
-- A unified who/what/when event log for high-value actions (voids, deletes,
-- cash counts, settlement adjustments, imports). This SUPPLEMENTS the existing
-- per-record audit trail (every table already carries edited_at / voided_at /
-- void_reason, and imports/import_rows log every import) — it does not replace it.
--
-- Additive and non-breaking. No engine/trigger changes. The app writes via the
-- best-effort helper src/lib/audit.ts, which no-ops until this table exists, so
-- applying this migration is the only activation step (then sprinkle logAudit()).
--
-- Safe to re-run. Run in the Supabase SQL editor.
-- =====================================================================

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor text,                 -- auth uid, or 'system'
  action text not null,       -- e.g. 'sale.void', 'cheque.delete', 'cash.count'
  entity_type text not null,  -- e.g. 'sales', 'cheques', 'money_movements'
  entity_id uuid,             -- the affected row, when applicable
  detail jsonb,               -- arbitrary context (amounts, reason, before/after)
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_entity on audit_log (entity_type, entity_id);
create index if not exists idx_audit_log_time on audit_log (occurred_at desc);

-- RLS — single-admin V1, matching every existing table.
alter table audit_log enable row level security;
drop policy if exists admin_all on audit_log;
create policy admin_all on audit_log
  for all to authenticated using (true) with check (true);
