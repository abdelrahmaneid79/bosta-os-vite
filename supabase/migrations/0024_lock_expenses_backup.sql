-- =====================================================================
-- BostaOS — Migration 0024: close the expenses-backup exposure (audit B1)
--
-- expenses_backup_20260629 (190 rows) had RLS DISABLED — readable and
-- writable by anyone holding the public anon key, no login required
-- (Supabase advisor ERROR rls_disabled_in_public). Owner chose to KEEP
-- the table: enabling RLS with no policies = default-deny for anon and
-- authenticated. The service role (SQL editor / dashboard) still reads it.
-- =====================================================================
alter table expenses_backup_20260629 enable row level security;
