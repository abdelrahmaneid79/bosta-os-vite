-- 0014 — Double-entry general ledger, parallel to the verified money engine.
-- Additive only: the existing settlement/WAC/cash logic is unchanged. This adds a
-- proper debit/credit ledger that downstream postings can write to, with the two
-- controls institutional accounting requires: balanced entries (Σdebit=Σcredit)
-- and immutability of posted entries (you reverse, you never edit or delete).

do $$ begin
  if not exists (select 1 from pg_type where typname = 'gl_account_type') then
    create type public.gl_account_type as enum ('asset','liability','equity','revenue','expense');
  end if;
end $$;

create table if not exists public.gl_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type public.gl_account_type not null,
  normal_balance char(1) not null check (normal_balance in ('D','C')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.gl_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  memo text,
  source_type text,
  source_id uuid,
  status text not null default 'posted' check (status in ('posted','void')),
  reverses uuid references public.gl_entries(id),
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);
create index if not exists idx_gl_entries_date on public.gl_entries(entry_date);
create index if not exists idx_gl_entries_source on public.gl_entries(source_type, source_id);

create table if not exists public.gl_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.gl_entries(id) on delete cascade,
  account_id uuid not null references public.gl_accounts(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  memo text,
  constraint gl_line_one_side check ((debit > 0) <> (credit > 0))
);
create index if not exists idx_gl_lines_entry on public.gl_lines(entry_id);
create index if not exists idx_gl_lines_account on public.gl_lines(account_id);

-- Balanced-entry control: Σdebit must equal Σcredit per entry. Deferred so a
-- multi-line entry is validated at commit, not mid-insert.
create or replace function public.gl_assert_balanced()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_eid uuid; v_d numeric; v_c numeric;
begin
  v_eid := coalesce(new.entry_id, old.entry_id);
  if not exists (select 1 from public.gl_entries where id = v_eid) then return null; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_d, v_c
    from public.gl_lines where entry_id = v_eid;
  if v_d = 0 then raise exception 'GL entry % has no lines', v_eid; end if;
  if v_d <> v_c then raise exception 'GL entry % unbalanced: debit % <> credit %', v_eid, v_d, v_c; end if;
  return null;
end $$;

drop trigger if exists trg_gl_balanced on public.gl_lines;
create constraint trigger trg_gl_balanced
  after insert or update or delete on public.gl_lines
  deferrable initially deferred
  for each row execute function public.gl_assert_balanced();

-- Immutability: lines never change; entries can only flip posted -> void.
create or replace function public.gl_lines_immutable()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin raise exception 'GL lines are immutable; post a reversing entry'; end $$;

drop trigger if exists trg_gl_lines_no_update on public.gl_lines;
create trigger trg_gl_lines_no_update before update on public.gl_lines
  for each row execute function public.gl_lines_immutable();
drop trigger if exists trg_gl_lines_no_delete on public.gl_lines;
create trigger trg_gl_lines_no_delete before delete on public.gl_lines
  for each row when (pg_trigger_depth() = 0) execute function public.gl_lines_immutable();

create or replace function public.gl_entries_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'GL entries are immutable; reverse instead of delete'; end if;
  if (new.entry_date, new.memo, new.source_type, new.source_id, new.posted_at, new.created_at, new.reverses)
     is distinct from
     (old.entry_date, old.memo, old.source_type, old.source_id, old.posted_at, old.created_at, old.reverses) then
    raise exception 'GL entry core fields are immutable (only void metadata may change)';
  end if;
  return new;
end $$;

drop trigger if exists trg_gl_entries_guard on public.gl_entries;
create trigger trg_gl_entries_guard before update or delete on public.gl_entries
  for each row execute function public.gl_entries_guard();

-- Trial balance (security_invoker so it honours the caller's RLS).
create or replace view public.gl_trial_balance
with (security_invoker = true) as
select a.code, a.name, a.type, a.normal_balance,
  coalesce(sum(l.debit), 0) as debit_total,
  coalesce(sum(l.credit), 0) as credit_total,
  case when a.normal_balance = 'D'
       then coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0)
       else coalesce(sum(l.credit),0) - coalesce(sum(l.debit),0) end as balance
from public.gl_accounts a
left join public.gl_lines l on l.account_id = a.id
left join public.gl_entries e on e.id = l.entry_id and e.status = 'posted'
group by a.id, a.code, a.name, a.type, a.normal_balance
order by a.code;

-- Posting RPC: one balanced journal entry. Lines = [{account, debit?, credit?, memo?}].
create or replace function public.gl_post_entry(
  p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_id uuid; r jsonb; v_acc uuid;
begin
  insert into public.gl_entries(entry_date, memo, source_type, source_id)
  values (p_date, p_memo, p_source_type, p_source_id) returning id into v_id;
  for r in select * from jsonb_array_elements(p_lines) loop
    select id into v_acc from public.gl_accounts where code = (r->>'account');
    if v_acc is null then raise exception 'unknown GL account code %', r->>'account'; end if;
    insert into public.gl_lines(entry_id, account_id, debit, credit, memo)
    values (v_id, v_acc, coalesce((r->>'debit')::numeric, 0), coalesce((r->>'credit')::numeric, 0), r->>'memo');
  end loop;
  return v_id;
end $$;
grant execute on function public.gl_post_entry(date, text, text, uuid, jsonb) to authenticated;

-- RLS (single-admin model, consistent with the rest of the schema; immutability
-- is enforced by the triggers above, not by the policy).
alter table public.gl_accounts enable row level security;
alter table public.gl_entries  enable row level security;
alter table public.gl_lines    enable row level security;
drop policy if exists admin_all on public.gl_accounts;
drop policy if exists admin_all on public.gl_entries;
drop policy if exists admin_all on public.gl_lines;
create policy admin_all on public.gl_accounts for all to authenticated using (true) with check (true);
create policy admin_all on public.gl_entries  for all to authenticated using (true) with check (true);
create policy admin_all on public.gl_lines    for all to authenticated using (true) with check (true);

-- Chart of accounts for Bosta Bites (EGP, single entity).
insert into public.gl_accounts(code, name, type, normal_balance) values
  ('1000','Cash on hand','asset','D'),
  ('1100','Settlement receivable (Hyper Hub)','asset','D'),
  ('1200','Inventory','asset','D'),
  ('3000','Owner equity','equity','C'),
  ('3100','Owner drawings','equity','D'),
  ('4000','Sales revenue','revenue','C'),
  ('5000','Cost of goods sold','expense','D'),
  ('6000','Rent expense','expense','D'),
  ('6100','Revenue-share fee','expense','D'),
  ('6200','Operating expenses','expense','D'),
  ('6300','Salaries','expense','D')
on conflict (code) do nothing;
