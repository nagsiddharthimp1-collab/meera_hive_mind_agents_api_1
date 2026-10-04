create index if not exists users_created_at_idx
  on public.users (created_at desc);

create index if not exists messages_user_activity_idx
  on public.messages ("timestamp", user_id)
  where content_type = 'user';

create index if not exists payments_created_user_idx
  on public.payments (created_at, user_id)
  include (payment_status, amount, coupon_code, payment_id, order_id);

create index if not exists analytics_events_funnel_idx
  on public.analytics_events (event_name, created_at)
  include (user_id);

create or replace function public.analytics_funnel_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_excluded_domains text[] default '{}'::text[],
  p_excluded_emails text[] default '{}'::text[],
  p_excluded_email_prefixes text[] default '{}'::text[],
  p_excluded_name_prefixes text[] default '{}'::text[],
  p_excluded_id_fragments text[] default '{}'::text[],
  p_bypass_coupon_codes text[] default array['BYPASS']::text[]
)
returns table (
  signups bigint,
  payment_page_opened bigint,
  paid bigint,
  active bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with real_users as materialized (
    select
      u.id,
      u.auth_id,
      u.created_at
    from public.users u
    where coalesce(u.deleted, false) = false
      and lower(trim(coalesce(u.email, ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and not (lower(trim(u.email)) = any(p_excluded_emails))
      and not (split_part(lower(trim(u.email)), '@', 2) = any(p_excluded_domains))
      and not exists (
        select 1
        from unnest(p_excluded_email_prefixes) prefix
        where split_part(lower(trim(u.email)), '@', 1) like prefix || '%'
      )
      and split_part(lower(trim(u.email)), '@', 1)
        !~ '(^|[+._-])(codex|smoke|test|testing|e2e|qa)([+._-]|$)'
      and not exists (
        select 1
        from unnest(p_excluded_name_prefixes) prefix
        where lower(trim(coalesce(u.name, ''))) like prefix || '%'
      )
      and (
        u.id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or not exists (
          select 1
          from unnest(p_excluded_id_fragments) fragment
          where position(fragment in lower(u.id::text)) > 0
        )
      )
  ),
  signup_users as materialized (
    select id, auth_id
    from real_users
    where created_at >= p_from
      and created_at < p_to
  )
  select
    (select count(*) from signup_users) as signups,
    (
      select count(distinct su.id)
      from public.analytics_events event
      join signup_users su on su.auth_id::text = event.user_id
      where event.event_name = 'payment_page_opened'
        and event.created_at >= p_from
        and event.created_at < p_to
    ) as payment_page_opened,
    (
      select count(distinct su.id)
      from public.payments payment
      join signup_users su on su.id::text = payment.user_id::text
      where payment.created_at >= p_from
        and payment.created_at < p_to
        and lower(trim(coalesce(payment.payment_status, ''))) in ('paid', 'active', 'success')
        and coalesce(payment.amount, 0) > 0
        and not (upper(trim(coalesce(payment.coupon_code, ''))) = any(p_bypass_coupon_codes))
        and lower(concat_ws(' ', payment.user_id::text, payment.payment_id::text, payment.order_id::text))
          not like '%bypass%'
    ) as paid,
    (
      select count(distinct ru.id)
      from public.messages message
      join real_users ru on ru.auth_id::text = message.user_id::text
      where message.content_type = 'user'
        and message."timestamp" >= p_from
        and message."timestamp" < p_to
    ) as active;
$$;

revoke all on function public.analytics_funnel_summary(
  timestamptz,
  timestamptz,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[]
) from public, anon, authenticated;

grant execute on function public.analytics_funnel_summary(
  timestamptz,
  timestamptz,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[]
) to service_role;

comment on function public.analytics_funnel_summary(
  timestamptz,
  timestamptz,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[]
) is 'Computes the protected analytics funnel in one database aggregate without transferring raw message rows.';
