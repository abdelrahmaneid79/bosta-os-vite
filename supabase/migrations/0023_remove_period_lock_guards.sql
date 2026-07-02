-- =====================================================================
-- BostaOS — Migration 0023: remove period-lock guard triggers (audit B3)
--
-- Period locking is on the project's deliberately-removed list, but its
-- guard triggers were still LIVE on four money tables. Dormant only while
-- accounting_periods stays empty — one stray lock row would block writes
-- app-wide with a cryptic error. Coverage was also inconsistent (never on
-- sale_items / cheques). The dormant tables (accounting_periods, gl_*,
-- audit_log) are left untouched; only the active guard machinery goes.
-- =====================================================================
drop trigger if exists aaa_period_lock on sales;
drop trigger if exists aaa_period_lock on expenses;
drop trigger if exists aaa_period_lock on money_movements;
drop trigger if exists aaa_period_lock on purchase_batches;
