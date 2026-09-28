create table if not exists public.growth_links (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  destination_path text not null default '/',
  utm_source text not null,
  utm_medium text not null,
  utm_campaign text not null,
  active boolean not null default true,
  expires_at timestamptz,
  created_by_user_id uuid,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_links_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint growth_links_destination_internal check (destination_path like '/%')
);

create table if not exists public.growth_link_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.growth_links(id) on delete cascade,
  visitor_id uuid not null,
  referrer_host text,
  device_class text,
  created_at timestamptz not null default now()
);

create table if not exists public.growth_link_attributions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.growth_links(id) on delete cascade,
  auth_user_id uuid not null unique,
  user_email text,
  attributed_at timestamptz not null default now()
);

create index if not exists growth_links_created_idx
  on public.growth_links (created_at desc);
create index if not exists growth_link_clicks_link_created_idx
  on public.growth_link_clicks (link_id, created_at desc);
create index if not exists growth_link_clicks_link_visitor_idx
  on public.growth_link_clicks (link_id, visitor_id);
create index if not exists growth_link_attributions_link_created_idx
  on public.growth_link_attributions (link_id, attributed_at desc);

alter table public.growth_links enable row level security;
alter table public.growth_link_clicks enable row level security;
alter table public.growth_link_attributions enable row level security;

revoke all on table public.growth_links from anon, authenticated;
revoke all on table public.growth_link_clicks from anon, authenticated;
revoke all on table public.growth_link_attributions from anon, authenticated;

grant all on table public.growth_links to service_role;
grant all on table public.growth_link_clicks to service_role;
grant all on table public.growth_link_attributions to service_role;

comment on table public.growth_links is 'Internal growth campaign links created by authorized analytics users.';
comment on table public.growth_link_clicks is 'Privacy-minimized click events for growth links; raw IP addresses are not stored.';
comment on table public.growth_link_attributions is 'First-touch growth-link attribution keyed by authenticated user id.';
