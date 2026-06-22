-- 0010 — Backfill settlement-term coverage for historical periods.
--
-- ROOT CAUSE this addresses: inserting a sale fires the per-row settlement
-- trigger, which seeds a deduction from `location_terms` via get_effective_terms.
-- For a back-dated month that predates the location's earliest term, no term is
-- effective → a NULL rent/share flows into a NOT NULL settlement column → the
-- whole (atomic) historical insert rolls back. Live current-month sales work
-- because the current month always has effective terms.
--
-- FIX (data, not function): guarantee every location has terms effective from
-- its earliest sale onward. Months that predate the real terms get an EXPLICIT
-- ZERO term (rent 0 / share 0) so net_expected = sales (rule: missing = 0). Real
-- terms are never modified. Idempotent: re-running inserts nothing once covered.
--
-- NOTE: the importer also calls the equivalent app-layer ensureTermsCoverage()
-- at commit time, so this migration is a backfill for any sales that already
-- exist; it is a no-op when none do.

insert into location_terms (location_id, term_type, amount, rate, effective_from, effective_to, notes)
select fs.location_id,
       tt.term_type,
       case when tt.term_type = 'rent' then 0 else null end,            -- rent amount
       case when tt.term_type = 'revenue_charge' then 0 else null end,  -- share rate
       fs.min_date,
       case when et.min_eff is null then null else (et.min_eff - 1) end,
       'Backfilled by 0010: no terms for this historical period (treated as 0).'
from (
  select location_id, min(sale_date) as min_date
  from sales
  where voided_at is null
  group by location_id
) fs
cross join (values ('rent'::term_type), ('revenue_charge'::term_type)) as tt(term_type)
left join (
  select location_id, term_type, min(effective_from) as min_eff
  from location_terms
  group by location_id, term_type
) et on et.location_id = fs.location_id and et.term_type = tt.term_type
where (et.min_eff is null or et.min_eff > fs.min_date)
  and not exists (
    select 1 from location_terms lt
    where lt.location_id = fs.location_id
      and lt.term_type = tt.term_type
      and lt.effective_from <= fs.min_date
  );
