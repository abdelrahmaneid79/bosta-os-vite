-- 0012 — Security hardening surfaced by the live Supabase advisor scan during
-- production certification. Purely additive/non-destructive: no data, no engine
-- logic, no policy semantics change.
--
-- (a) ERROR security_definer_view: the two reporting views ran with the view
--     owner's privileges, bypassing the querying user's RLS. Switch them to
--     security_invoker so they enforce the caller's RLS. Definitions unchanged.
-- (b) WARN function_search_path_mutable: pin a safe search_path on every public
--     function so name resolution can't be hijacked by a mutable search_path.

alter view public.v_active_sales set (security_invoker = true);
alter view public.v_open_settlement set (security_invoker = true);

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end
$$;
