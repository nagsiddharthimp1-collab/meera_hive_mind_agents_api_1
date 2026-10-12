-- Only server-side analytics routes may execute this read-only reporting function.
-- Native uuid joins preserve the existing user/time indexes. Message content is never selected.
create or replace function public.analytics_dashboard_source_v1(
  p_from timestamptz, p_to timestamptz, p_section text, p_exclusions jsonb default '{}'::jsonb
) returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
with real_users as materialized (
  select u.id, u.auth_id, u.name, u.email, u.created_at
  from public.users u
  where coalesce(u.deleted,false)=false and u.created_at < p_to
    and lower(trim(coalesce(u.email,''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and not exists(select 1 from jsonb_array_elements_text(coalesce(p_exclusions->'domains','[]'::jsonb)) d where split_part(lower(trim(u.email)),'@',2)=d)
    and not exists(select 1 from jsonb_array_elements_text(coalesce(p_exclusions->'emails','[]'::jsonb)) e where lower(trim(u.email))=e)
    and not exists(select 1 from jsonb_array_elements_text(coalesce(p_exclusions->'email_prefixes','[]'::jsonb)) e where starts_with(split_part(lower(trim(u.email)),'@',1),e))
    and split_part(lower(trim(u.email)),'@',1) !~ '(^|[+._-])(codex|smoke|test|testing|e2e|qa)([+._-]|$)'
    and not exists(select 1 from jsonb_array_elements_text(coalesce(p_exclusions->'name_prefixes','[]'::jsonb)) n where starts_with(lower(trim(coalesce(u.name,''))),n))
    and (u.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists(select 1 from jsonb_array_elements_text(coalesce(p_exclusions->'id_fragments','[]'::jsonb)) f where position(f in lower(u.id))>0))
), activity as (
  select u.id as user_id, (m.timestamp at time zone 'UTC')::date::text as timestamp, 'user'::text as content_type, count(*) as count
  from real_users u join public.messages m on m.user_id=u.auth_id
  where p_section='product' and m.content_type='user' and m.timestamp >= p_from-(p_to-p_from) and m.timestamp < p_to
  group by u.id,(m.timestamp at time zone 'UTC')::date
), payments as (
  select p.payment_id,p.user_id,p.amount,p.payment_status,p.payment_date,p.created_at,p.coupon_code,p.order_id
  from public.payments p join real_users u on u.id=p.user_id
  where p_section='product' and coalesce(p.payment_date,p.created_at)<p_to
    and coalesce(p.amount,0)>0
    and not exists(select 1 from jsonb_array_elements_text(coalesce(p_exclusions->'bypass_codes','["bypass"]'::jsonb)) b where lower(trim(coalesce(p.coupon_code,'')))=b)
    and lower(concat_ws(' ',p.user_id,p.payment_id::text,p.order_id)) not like '%bypass%'
), usage as materialized (
  select e.event_id,e.created_at,coalesce(nullif(e.model,''),'Unknown') as model,e.total_tokens,e.ok,
    case when e.created_at>=p_from then 'current' else 'previous' end as period,
    (p_from + floor(extract(epoch from (e.created_at-p_from)) / (case when p_to-p_from>interval '100 days' then 604800 else 86400 end)) * (case when p_to-p_from>interval '100 days' then interval '7 days' else interval '1 day' end))::date::text as bucket_date,
    case when coalesce(e.meta->>'usage_cost_usd','') ~ '^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' then (e.meta->>'usage_cost_usd')::numeric else null end as cost,
    case when coalesce(e.meta->>'time_taken_ms','') ~ '^[0-9]+(\.[0-9]+)?$' then (e.meta->>'time_taken_ms')::numeric else null end as latency
  from real_users u join public.token_usage_events e on e.user_id=u.auth_id
  where p_section='ai' and e.created_at>=p_from-(p_to-p_from) and e.created_at<p_to
), grouped as (
  select period,bucket_date,model,grouping(bucket_date) as gday,grouping(model) as gmodel,
    count(*) as requests,coalesce(sum(total_tokens),0) as tokens,sum(cost) as cost,
    count(cost)::numeric/nullif(count(*),0) as "costCoverage",
    count(*) filter(where ok)::numeric/nullif(count(*),0) as success,
    percentile_cont(0.5) within group(order by latency) as p50,
    percentile_cont(0.95) within group(order by latency) as p95,
    count(latency)::numeric/nullif(count(*),0) as "latencyCoverage"
  from usage group by grouping sets((period),(period,bucket_date),(period,model))
)
select case when p_section='product' then jsonb_build_object(
  'users',coalesce((select jsonb_agg(to_jsonb(u)) from real_users u),'[]'::jsonb),
  'messages',coalesce((select jsonb_agg(to_jsonb(a)) from activity a),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(to_jsonb(p)) from payments p),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object('user_id',e.user_id,'event_name',e.event_name,'created_at',e.created_at)) from public.analytics_events e join real_users u on e.user_id=u.auth_id::text where e.event_name='payment_page_opened' and e.created_at>=p_from-(p_to-p_from) and e.created_at<p_to),'[]'::jsonb),
  'attributions',coalesce((select jsonb_agg(jsonb_build_object('auth_user_id',a.auth_user_id,'link_id',a.link_id,'attributed_at',a.attributed_at)) from public.growth_link_attributions a join real_users u on a.auth_user_id=u.auth_id where a.attributed_at<p_to),'[]'::jsonb),
  'links',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'utm_source',l.utm_source)) from public.growth_links l),'[]'::jsonb),
  'warnings','[]'::jsonb
) when p_section='ai' then jsonb_build_object(
  'groups',coalesce((select jsonb_agg(to_jsonb(g)) from grouped g),'[]'::jsonb),
  'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r.date desc,r.id desc) from (
    select event_id as id,created_at as date,model,total_tokens as tokens,ok,cost,latency from usage where period='current' order by created_at desc,event_id desc limit 100
  ) r),'[]'::jsonb)
) else null end;
$$;
revoke all on function public.analytics_dashboard_source_v1(timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.analytics_dashboard_source_v1(timestamptz,timestamptz,text,jsonb) to service_role;
comment on function public.analytics_dashboard_source_v1(timestamptz,timestamptz,text,jsonb) is 'Read-only analytics metadata and aggregates. Server service role only; Next.js routes enforce analytics RBAC. No conversation content.';
