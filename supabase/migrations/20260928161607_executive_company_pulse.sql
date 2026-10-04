create or replace function public.analytics_executive_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_excluded_domains text[] default '{}'::text[],
  p_excluded_emails text[] default '{}'::text[],
  p_excluded_email_prefixes text[] default '{}'::text[],
  p_excluded_name_prefixes text[] default '{}'::text[],
  p_excluded_id_fragments text[] default '{}'::text[],
  p_bypass_coupon_codes text[] default array['BYPASS']::text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with real_users as materialized (
    select u.id, u.auth_id, u.created_at
    from public.users u
    where coalesce(u.deleted, false) = false
      and lower(trim(coalesce(u.email, ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and not (lower(trim(u.email)) = any(p_excluded_emails))
      and not (split_part(lower(trim(u.email)), '@', 2) = any(p_excluded_domains))
      and not exists (
        select 1 from unnest(p_excluded_email_prefixes) prefix
        where split_part(lower(trim(u.email)), '@', 1) like prefix || '%'
      )
      and split_part(lower(trim(u.email)), '@', 1)
        !~ '(^|[+._-])(codex|smoke|test|testing|e2e|qa)([+._-]|$)'
      and not exists (
        select 1 from unnest(p_excluded_name_prefixes) prefix
        where lower(trim(coalesce(u.name, ''))) like prefix || '%'
      )
      and (
        u.id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or not exists (
          select 1 from unnest(p_excluded_id_fragments) fragment
          where position(fragment in lower(u.id::text)) > 0
        )
      )
  ),
  messages_in_window as materialized (
    select message.user_id, message.session_id, message.content_type, message."timestamp"
    from public.messages message
    join real_users ru on ru.auth_id::text = message.user_id::text
    where message."timestamp" >= p_from
      and message."timestamp" < p_to
      and message.content_type in ('user', 'assistant')
  ),
  messages_today as materialized (
    select message.content_type
    from public.messages message
    join real_users ru on ru.auth_id::text = message.user_id::text
    where message."timestamp" >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      and message."timestamp" < ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata')
      and message.content_type in ('user', 'assistant')
  ),
  successful_payments as materialized (
    select payment.user_id, payment.amount, payment.plan_type, payment.created_at
    from public.payments payment
    join real_users ru on ru.id::text = payment.user_id::text
    where payment.created_at >= p_from
      and payment.created_at < p_to
      and lower(trim(coalesce(payment.payment_status, ''))) in ('paid', 'active', 'success')
      and coalesce(payment.amount, 0) > 0
      and not (upper(trim(coalesce(payment.coupon_code, ''))) = any(p_bypass_coupon_codes))
      and lower(concat_ws(' ', payment.user_id::text, payment.payment_id::text, payment.order_id::text))
        not like '%bypass%'
  ),
  usage_in_window as materialized (
    select
      usage.user_id,
      usage.model,
      usage.prompt_tokens,
      usage.completion_tokens,
      usage.total_tokens,
      usage.ok,
      usage.meta,
      usage.created_at,
      case
        when jsonb_typeof(usage.meta -> 'usage_cost_usd') = 'number'
          then (usage.meta ->> 'usage_cost_usd')::numeric
        else 0::numeric
      end as cost_usd,
      case
        when jsonb_typeof(usage.meta -> 'time_taken_ms') = 'number'
          then (usage.meta ->> 'time_taken_ms')::numeric
        else null::numeric
      end as latency_ms,
      case
        when jsonb_typeof(usage.meta -> 'cached_tokens') = 'number'
          then (usage.meta ->> 'cached_tokens')::bigint
        else 0::bigint
      end as cached_tokens,
      case
        when jsonb_typeof(usage.meta -> 'reasoning_tokens') = 'number'
          then (usage.meta ->> 'reasoning_tokens')::bigint
        else 0::bigint
      end as reasoning_tokens,
      case
        when jsonb_typeof(usage.meta -> 'image_tokens') = 'number'
          then (usage.meta ->> 'image_tokens')::bigint
        else 0::bigint
      end as image_tokens
    from public.token_usage_events usage
    join real_users ru on ru.auth_id::text = usage.user_id::text
    where usage.created_at >= p_from
      and usage.created_at < p_to
  ),
  message_metrics as (
    select
      count(*) filter (where content_type = 'user')::bigint as user_messages,
      count(*) filter (where content_type = 'assistant')::bigint as assistant_messages,
      count(distinct session_id) filter (where session_id is not null)::bigint as conversations,
      count(distinct user_id) filter (where content_type = 'user')::bigint as active_users
    from messages_in_window
  ),
  today_metrics as (
    select
      count(*)::bigint as total_messages,
      count(*) filter (where content_type = 'user')::bigint as user_messages,
      count(*) filter (where content_type = 'assistant')::bigint as assistant_messages
    from messages_today
  ),
  payment_metrics as (
    select
      coalesce(sum(amount), 0)::numeric as revenue_collected,
      count(*)::bigint as successful_payments,
      count(distinct user_id)::bigint as paid_customers,
      coalesce(avg(amount), 0)::numeric as average_payment,
      count(*) filter (where lower(coalesce(plan_type, '')) = 'monthly')::bigint as monthly_payments,
      count(*) filter (where lower(coalesce(plan_type, '')) = 'lifetime')::bigint as lifetime_payments
    from successful_payments
  ),
  usage_metrics as (
    select
      count(*)::bigint as generations,
      coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
      coalesce(sum(total_tokens), 0)::bigint as total_tokens,
      coalesce(sum(cost_usd), 0)::numeric as cost_usd,
      coalesce(sum(cached_tokens), 0)::bigint as cached_tokens,
      coalesce(sum(reasoning_tokens), 0)::bigint as reasoning_tokens,
      coalesce(sum(image_tokens), 0)::bigint as image_tokens,
      coalesce(avg(latency_ms), 0)::numeric as average_latency_ms,
      coalesce(percentile_cont(0.5) within group (order by latency_ms), 0)::numeric as p50_latency_ms,
      coalesce(percentile_cont(0.95) within group (order by latency_ms), 0)::numeric as p95_latency_ms,
      coalesce(count(*) filter (where ok)::numeric / nullif(count(*), 0), 0)::numeric as success_rate,
      count(*) filter (where coalesce(latency_ms, 0) > 10000)::bigint as slow_requests,
      count(*) filter (
        where meta ? 'failover_attempt'
          and coalesce(nullif(meta ->> 'failover_attempt', '')::integer, 0) > 0
      )::bigint as failover_requests,
      count(*) filter (where meta ? 'web_search_evidence' or meta ? 'source_count')::bigint as web_search_generations
    from usage_in_window
  ),
  top_models as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'model', model,
      'generations', generations,
      'tokens', tokens,
      'cost_usd', round(cost_usd, 4)
    ) order by generations desc), '[]'::jsonb) as items
    from (
      select
        coalesce(nullif(model, ''), 'Unknown') as model,
        count(*)::bigint as generations,
        coalesce(sum(total_tokens), 0)::bigint as tokens,
        coalesce(sum(cost_usd), 0)::numeric as cost_usd
      from usage_in_window
      group by 1
      order by generations desc
      limit 5
    ) ranked_models
  ),
  top_providers as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'provider', provider,
      'generations', generations
    ) order by generations desc), '[]'::jsonb) as items
    from (
      select
        coalesce(nullif(meta ->> 'openrouter_provider_id', ''), nullif(meta ->> 'provider', ''), 'Unknown') as provider,
        count(*)::bigint as generations
      from usage_in_window
      group by 1
      order by generations desc
      limit 5
    ) ranked_providers
  ),
  pulse_days as (
    select generate_series(
      greatest(date_trunc('day', p_from at time zone 'Asia/Kolkata'), date_trunc('day', p_to at time zone 'Asia/Kolkata') - interval '13 days'),
      date_trunc('day', p_to at time zone 'Asia/Kolkata') - interval '1 day',
      interval '1 day'
    )::date as day
  ),
  daily_messages as (
    select ("timestamp" at time zone 'Asia/Kolkata')::date as day,
      count(*) filter (where content_type = 'user')::bigint as messages
    from messages_in_window
    group by 1
  ),
  daily_tokens as (
    select (created_at at time zone 'Asia/Kolkata')::date as day,
      coalesce(sum(total_tokens), 0)::bigint as tokens
    from usage_in_window
    group by 1
  ),
  daily_revenue as (
    select (created_at at time zone 'Asia/Kolkata')::date as day,
      coalesce(sum(amount), 0)::numeric as revenue
    from successful_payments
    group by 1
  ),
  daily_pulse as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', pulse_days.day,
      'messages', coalesce(daily_messages.messages, 0),
      'tokens', coalesce(daily_tokens.tokens, 0),
      'revenue', coalesce(daily_revenue.revenue, 0)
    ) order by pulse_days.day), '[]'::jsonb) as items
    from pulse_days
    left join daily_messages using (day)
    left join daily_tokens using (day)
    left join daily_revenue using (day)
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'collected', round(payment_metrics.revenue_collected, 2),
      'successful_payments', payment_metrics.successful_payments,
      'paid_customers', payment_metrics.paid_customers,
      'average_payment', round(payment_metrics.average_payment, 2),
      'monthly_payments', payment_metrics.monthly_payments,
      'lifetime_payments', payment_metrics.lifetime_payments
    ),
    'engagement', jsonb_build_object(
      'new_users', (select count(*) from real_users where created_at >= p_from and created_at < p_to),
      'active_users', message_metrics.active_users,
      'user_messages', message_metrics.user_messages,
      'assistant_messages', message_metrics.assistant_messages,
      'conversations', message_metrics.conversations,
      'messages_per_active_user', round(message_metrics.user_messages::numeric / nullif(message_metrics.active_users, 0), 1),
      'today_messages', today_metrics.total_messages,
      'today_user_messages', today_metrics.user_messages,
      'today_assistant_messages', today_metrics.assistant_messages
    ),
    'ai', jsonb_build_object(
      'generations', usage_metrics.generations,
      'prompt_tokens', usage_metrics.prompt_tokens,
      'completion_tokens', usage_metrics.completion_tokens,
      'total_tokens', usage_metrics.total_tokens,
      'cost_usd', round(usage_metrics.cost_usd, 4),
      'cost_per_1k_tokens_usd', round((usage_metrics.cost_usd * 1000) / nullif(usage_metrics.total_tokens, 0), 6),
      'cached_tokens', usage_metrics.cached_tokens,
      'reasoning_tokens', usage_metrics.reasoning_tokens,
      'image_tokens', usage_metrics.image_tokens,
      'web_search_generations', usage_metrics.web_search_generations,
      'top_models', top_models.items,
      'top_providers', top_providers.items
    ),
    'reliability', jsonb_build_object(
      'average_latency_ms', round(usage_metrics.average_latency_ms),
      'p50_latency_ms', round(usage_metrics.p50_latency_ms),
      'p95_latency_ms', round(usage_metrics.p95_latency_ms),
      'success_rate', round(usage_metrics.success_rate, 4),
      'slow_requests', usage_metrics.slow_requests,
      'failover_requests', usage_metrics.failover_requests,
      'failover_rate', round(usage_metrics.failover_requests::numeric / nullif(usage_metrics.generations, 0), 4)
    ),
    'daily_pulse', daily_pulse.items
  )
  from message_metrics, today_metrics, payment_metrics, usage_metrics, top_models, top_providers, daily_pulse;
$$;

revoke all on function public.analytics_executive_summary(
  timestamptz,
  timestamptz,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[]
) from public, anon, authenticated;

grant execute on function public.analytics_executive_summary(
  timestamptz,
  timestamptz,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[]
) to service_role;

comment on function public.analytics_executive_summary(
  timestamptz,
  timestamptz,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[]
) is 'Returns the protected company-level analytics pulse for real users without transferring raw messages or token events.';
