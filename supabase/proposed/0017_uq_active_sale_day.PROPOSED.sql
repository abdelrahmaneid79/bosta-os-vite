-- =====================================================================
-- PROPOSED MIGRATION — DO NOT APPLY YET.
-- Deliberately placed in supabase/proposed/ (NOT supabase/migrations/) so
-- it cannot be auto-applied. Move it into migrations/ only after approval
-- AND after the sweep below returns zero duplicates.
--
-- P1-3: enforce ONE active daily sale per (location_id, sale_date).
-- Source of truth: STABILITY_SPRINT_REPORT_2026-06-21.md
--
-- PRECONDITION (required):
--   Run  supabase/maintenance/duplicate_active_sale_days_report.sql
--   and confirm  duplicate_day_groups = 0.
--   This index will FAIL to build while active duplicates exist. Do not
--   auto-clean — the owner decides which duplicate row is canonical and
--   soft-voids the rest.
--
-- WHY a PARTIAL index (where voided_at is null):
--   * Re-entering a day after voiding the old header still works.
--   * Historical and live rows for the same day still collide, which is
--     exactly the canonical "one record per day" rule we want.
-- =====================================================================

create unique index if not exists uq_sales_active_day
  on public.sales (location_id, sale_date)
  where voided_at is null;

-- ---------------------------------------------------------------------
-- LARGE-TABLE ALTERNATIVE (manual session only):
-- `create index concurrently` cannot run inside a transaction, and
-- Supabase migrations run in one. If the sales table is large enough that
-- a brief lock matters, run this by hand in a non-transactional session
-- INSTEAD of the statement above:
--
--   create unique index concurrently if not exists uq_sales_active_day
--     on public.sales (location_id, sale_date)
--     where voided_at is null;
--
-- ROLLBACK:
--   drop index if exists uq_sales_active_day;
-- ---------------------------------------------------------------------
