-- =====================================================================
-- 0031: enforce ONE active daily sale per (location_id, sale_date).
-- Promoted from supabase/proposed/0017 (2026-07-12). Precondition met:
-- duplicate_active_sale_days sweep returned zero groups before applying.
--
-- WHY a PARTIAL index (where voided_at is null):
--   * Re-entering a day after voiding the old header still works.
--   * Historical and live rows for the same day still collide — the
--     canonical "one record per day" rule.
-- The app-level check-then-insert guard in createSale remains as the
-- friendly-error layer; this index is the race-proof backstop.
--
-- ROLLBACK: drop index if exists uq_sales_active_day;
-- =====================================================================

create unique index if not exists uq_sales_active_day
  on public.sales (location_id, sale_date)
  where voided_at is null;
