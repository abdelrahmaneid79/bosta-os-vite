-- =====================================================================
-- 0033: Strategist persistence (Cycle 4) — ADDITIVE ONLY.
-- Conversations + messages, insight lifecycle, owner action queue, and
-- lightweight feedback. These tables store REFERENCES, outputs, state and
-- interaction history — never authoritative financial calculations (the
-- read models over business tables remain the only source of truth).
--
-- Design notes:
--   * strategist_insights: ONE row per stable finding id (the deterministic
--     engine emits stable slugs like "margin-drop"); recurrence updates
--     last_seen_at/seen_count, disappearance auto-resolves, reappearance
--     after resolution reopens. Unique(finding_id) IS the dedup.
--   * strategist_actions: a partial unique index prevents duplicate OPEN
--     actions for the same underlying finding.
--   * RLS: the app's standard single-owner model (admin_all for
--     authenticated), matching every other table.
--   * Retention: messages cascade with their conversation; the app prunes
--     old conversations (keep the most recent 30) on write.
-- =====================================================================

create table if not exists strategist_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Conversation',
  mode text not null default 'question',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists strategist_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references strategist_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  -- user: {"text": "..."} · assistant: the VALIDATED structured response
  content jsonb not null,
  -- what the answer was grounded on: {generatedAt, period, lastDataDate}
  snapshot_meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_strategist_messages_conv
  on strategist_messages(conversation_id, created_at);

create table if not exists strategist_insights (
  id uuid primary key default gen_random_uuid(),
  finding_id text not null unique,
  class text not null,
  title text not null,
  detail text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  impact_egp numeric,
  urgency text not null default 'monitor',
  confidence text not null default 'medium',
  screen_link text not null default '/health',
  status text not null default 'active'
    check (status in ('active','acknowledged','resolved','dismissed','reopened')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  resolved_at timestamptz,
  dismissed_at timestamptz,
  owner_note text,
  period text
);
create index if not exists idx_strategist_insights_status on strategist_insights(status, last_seen_at desc);

create table if not exists strategist_actions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  source text not null check (source in ('finding','ai','owner','data_quality')),
  finding_id text,
  conversation_id uuid references strategist_conversations(id) on delete set null,
  category text not null default 'general',
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  status text not null default 'suggested'
    check (status in ('suggested','accepted','in_progress','completed','dismissed')),
  due_date date,
  screen_link text not null default '/health',
  expected_outcome text,
  completion_note text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  dismissed_at timestamptz
);
-- no duplicate OPEN action for the same underlying finding
create unique index if not exists uq_strategist_actions_open_finding
  on strategist_actions(finding_id)
  where finding_id is not null and status in ('suggested','accepted','in_progress');
create index if not exists idx_strategist_actions_status on strategist_actions(status, created_at desc);

create table if not exists strategist_feedback (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('message','insight','briefing')),
  subject_id uuid,
  verdict text not null check (verdict in ('useful','not_useful','incorrect','already_knew','acted_on')),
  reason text,
  snapshot_meta jsonb,
  created_at timestamptz not null default now()
);

-- RLS — single-owner app: any authenticated session is the owner.
do $$
declare t text;
begin
  foreach t in array array['strategist_conversations','strategist_messages','strategist_insights','strategist_actions','strategist_feedback'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists admin_all on %I', t);
    execute format('create policy admin_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
