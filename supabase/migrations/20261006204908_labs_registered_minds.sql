-- Only a server aggregate is exposed. No identities or inferred geography leave the database.
create or replace function public.labs_registered_minds()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select jsonb_build_object('registeredMinds',count(*),'updatedAt',now())
  from public.users
  where deleted is not true
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and split_part(lower(email),'@',2) not in ('example.com','example.net','example.org','example.invalid','invalid','local','localhost','himeera.com')
    and lower(email) !~ '^(codex-|test-|smoke-|e2e-|qa-)'
    and split_part(lower(email),'@',1) !~ '(^|[+._-])(codex|smoke|test|testing|e2e|qa)([+._-]|$)'
    and lower(coalesce(name,'')) !~ '^(codex|memory keyword smoke)'
    and lower(id) !~ '(bypass|smoke|codex|test|e2e)';
$$;
revoke all on function public.labs_registered_minds() from public, anon, authenticated;
grant execute on function public.labs_registered_minds() to service_role;
