-- =====================================================================
-- 0034: recommendation OUTCOME tracking (Cycle 6) — ADDITIVE ONLY.
-- Extends strategist_actions rather than adding a table: an outcome is the
-- lifecycle tail of the action itself (existing rows keep working;
-- outcome_state defaults to 'not_started').
--   baseline           immutable comparison snapshot taken when the action
--                      was accepted: {period, capturedAt, impactEgp,
--                      evidence[] (verbatim metric refs), findingId,
--                      resolutionCriteria} — references + values, never a
--                      recomputable financial source of truth
--   success_criteria   the engine's resolution rule at acceptance time
--   review_date        acceptance date + reviewPeriodDays (owner-tunable)
--   outcome_state      deterministic verdict (persistence/outcomes.ts)
--   outcome_metrics    the before/after numbers + the attribution caveat
-- =====================================================================

alter table strategist_actions
  add column if not exists baseline jsonb,
  add column if not exists success_criteria text,
  add column if not exists review_date date,
  add column if not exists outcome_state text not null default 'not_started'
    check (outcome_state in ('not_started','in_progress','awaiting_data','improved','no_meaningful_change','worsened','inconclusive','cancelled')),
  add column if not exists outcome_metrics jsonb,
  add column if not exists evaluated_at timestamptz;

create index if not exists idx_strategist_actions_review
  on strategist_actions(outcome_state, review_date)
  where finding_id is not null;
