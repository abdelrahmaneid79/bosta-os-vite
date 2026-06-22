-- =====================================================================
-- P1-3  Duplicate active daily-sale sweep   (READ-ONLY — safe to run)
-- Source of truth: STABILITY_SPRINT_REPORT_2026-06-21.md
--
-- Rule being checked: there must be AT MOST ONE non-voided sale header
-- per (location_id, sale_date). Duplicates double-count revenue and
-- inflate settlement accumulation (the trigger sums all non-voided
-- sales in the period).
--
-- This script ONLY reads. It performs no INSERT / UPDATE / DELETE.
-- Run it in the Supabase SQL editor BEFORE applying the unique index
-- in supabase/proposed/0017_uq_active_sale_day.PROPOSED.sql.
-- =====================================================================

-- 1) Headline — how big is the problem?
--    duplicate_day_groups = number of (location, day) pairs with >1 active row
--    extra_active_rows    = rows that must be resolved (sum of count-1)
select
  count(*)                          as duplicate_day_groups,
  coalesce(sum(active_rows - 1), 0) as extra_active_rows
from (
  select location_id, sale_date, count(*) as active_rows
  from public.sales
  where voided_at is null
  group by location_id, sale_date
  having count(*) > 1
) d;

-- 2) Detail — one row per offending day, with the colliding records so the
--    owner can decide which is canonical (DO NOT auto-delete).
select
  location_id,
  sale_date,
  count(*)                                     as active_rows,
  round(sum(total_amount), 2)                  as combined_total,
  array_agg(id            order by created_at) as sale_ids,
  array_agg(total_amount  order by created_at) as amounts,
  array_agg(source_type   order by created_at) as sources,
  array_agg(is_historical order by created_at) as historical_flags,
  array_agg(created_at    order by created_at) as created_ats
from public.sales
where voided_at is null
group by location_id, sale_date
having count(*) > 1
order by location_id, sale_date;

-- If query (1) returns duplicate_day_groups = 0, the table is clean and the
-- proposed unique index can be applied safely. If it returns rows, resolve
-- them first by VOIDING the wrong duplicate(s) (soft-void, never hard delete)
-- — the owner chooses which row stays. Re-run this report until it is clean.
