-- =====================================================================
-- BostaOS — Migration 0002: cheque lifecycle support (ADDITIVE)
--
-- Purpose: enable a fuller cheque lifecycle for Treasury (Session 6):
--   richer statuses, an optional due date, and pre-receipt "expected"
--   cheques. Strictly additive — existing rows are untouched, and NO
--   revenue, settlement, expense, or cash logic is modified.
--
-- Safe to re-run (IF NOT EXISTS guards). Run in the Supabase SQL editor.
-- =====================================================================

-- 1) New cheque_status values (additive). Existing values
--    ('pending','received','reconciled') are retained and unchanged.
alter type cheque_status add value if not exists 'expected';
alter type cheque_status add value if not exists 'deposited';
alter type cheque_status add value if not exists 'cleared';
alter type cheque_status add value if not exists 'cancelled';

-- 2) Optional due date. Nullable, so every existing cheque row becomes
--    due_date = NULL automatically; nothing is rewritten.
alter table cheques add column if not exists due_date date;

-- 3) Allow pre-receipt "expected" cheques. Before a cheque is received we
--    do not yet have a received_date or an amount_received, so both become
--    nullable. expected_amount stays NOT NULL (it is the settlement
--    net_expected, always known when a cheque is anticipated). The existing
--    generated column `difference = amount_received - expected_amount`
--    simply yields NULL while amount_received is NULL — no error, no change
--    to its definition.
alter table cheques alter column received_date drop not null;
alter table cheques alter column amount_received drop not null;
