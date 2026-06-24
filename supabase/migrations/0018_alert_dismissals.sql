-- =====================================================================
-- BostaOS — Migration 0018: cross-device alert dismissals
--
-- Additive + non-breaking. Each row is one dismissed alert key; the app
-- prunes a key automatically once its underlying alert stops being generated
-- (auto-resolved), so dismissing never hides a future recurrence forever.
-- Safe to re-run.
-- =====================================================================
create table if not exists public.alert_dismissals (
  key text primary key,
  dismissed_at timestamptz not null default now()
);

alter table public.alert_dismissals enable row level security;
drop policy if exists admin_all on public.alert_dismissals;
create policy admin_all on public.alert_dismissals
  for all to authenticated using (true) with check (true);
