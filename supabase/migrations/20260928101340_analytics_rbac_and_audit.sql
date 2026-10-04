create table if not exists public.analytics_access (
  email text primary key,
  role text not null check (role in ('owner', 'product_growth', 'analyst', 'support')),
  enabled boolean not null default true,
  granted_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_access_email_lowercase check (email = lower(email))
);

create table if not exists public.analytics_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_email text not null,
  action text not null,
  target_user_id text,
  target_message_id text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_audit_actor_created_idx
  on public.analytics_audit_log (actor_email, created_at desc);
create index if not exists analytics_audit_target_created_idx
  on public.analytics_audit_log (target_user_id, created_at desc);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  user_id text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_name_created_idx
  on public.analytics_events (event_name, created_at desc);
create index if not exists analytics_events_user_created_idx
  on public.analytics_events (user_id, created_at desc);

alter table public.analytics_access enable row level security;
alter table public.analytics_audit_log enable row level security;
alter table public.analytics_events enable row level security;

revoke all on table public.analytics_access from anon, authenticated;
revoke all on table public.analytics_audit_log from anon, authenticated;
revoke all on table public.analytics_events from anon, authenticated;

grant all on table public.analytics_access to service_role;
grant all on table public.analytics_audit_log to service_role;
grant all on table public.analytics_events to service_role;

insert into public.analytics_access (email, role, enabled, granted_by_email)
values ('siddharth.nag@himeera.com', 'owner', true, 'system-bootstrap')
on conflict (email) do nothing;

comment on table public.analytics_access is 'Named internal access to Meera analytics and sensitive conversation review.';
comment on table public.analytics_audit_log is 'Append-only audit history for sensitive analytics actions.';
comment on table public.analytics_events is 'First-party product events used by the internal analytics funnel.';
