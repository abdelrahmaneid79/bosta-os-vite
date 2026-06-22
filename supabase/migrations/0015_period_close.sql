-- 0015 — Accounting period close / lock (financial control).
-- Additive and safe-by-default: with no locked periods the guard is a no-op, so
-- every existing workflow is unaffected. Once the owner locks a month, dated
-- writes into that month are rejected at the database — closed books stay closed.

create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique,            -- first day of the month
  status text not null default 'open' check (status in ('open','locked')),
  locked_at timestamptz, locked_by text, note text,
  created_at timestamptz not null default now()
);

alter table public.accounting_periods enable row level security;
drop policy if exists admin_all on public.accounting_periods;
create policy admin_all on public.accounting_periods for all to authenticated using (true) with check (true);

create or replace function public.assert_period_open(d date)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if d is null then return; end if;
  if exists (select 1 from public.accounting_periods
             where period_month = date_trunc('month', d)::date and status = 'locked') then
    raise exception 'accounting period % is locked; unlock it before posting or editing dated entries', to_char(d,'YYYY-MM');
  end if;
end $$;

-- Generic guard: the guarded table's date column name is passed as a trigger arg.
create or replace function public.period_lock_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  perform public.assert_period_open((to_jsonb(new) ->> tg_argv[0])::date);
  return new;
end $$;

drop trigger if exists aaa_period_lock on public.sales;
create trigger aaa_period_lock before insert or update on public.sales
  for each row execute function public.period_lock_guard('sale_date');
drop trigger if exists aaa_period_lock on public.expenses;
create trigger aaa_period_lock before insert or update on public.expenses
  for each row execute function public.period_lock_guard('expense_date');
drop trigger if exists aaa_period_lock on public.money_movements;
create trigger aaa_period_lock before insert or update on public.money_movements
  for each row execute function public.period_lock_guard('movement_date');
drop trigger if exists aaa_period_lock on public.purchase_batches;
create trigger aaa_period_lock before insert or update on public.purchase_batches
  for each row execute function public.period_lock_guard('purchase_date');

create or replace function public.lock_period(p_month date)
returns void language sql security invoker set search_path = public, pg_temp as $$
  insert into public.accounting_periods(period_month, status, locked_at)
  values (date_trunc('month', p_month)::date, 'locked', now())
  on conflict (period_month) do update set status = 'locked', locked_at = now();
$$;

create or replace function public.unlock_period(p_month date)
returns void language sql security invoker set search_path = public, pg_temp as $$
  update public.accounting_periods set status = 'open', locked_at = null
  where period_month = date_trunc('month', p_month)::date;
$$;

grant execute on function public.lock_period(date) to authenticated;
grant execute on function public.unlock_period(date) to authenticated;
