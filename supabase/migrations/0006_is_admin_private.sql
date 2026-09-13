-- UCHI 0006: move the privileged body of is_admin() out of the exposed API schema.
-- Security advisor 0029 flagged public.is_admin() as a SECURITY DEFINER function
-- reachable at /rest/v1/rpc/is_admin. The contract keeps the name public.is_admin()
-- (every RLS policy calls it), so it becomes a SECURITY INVOKER wrapper around
-- private.is_admin(), which does the auth.users lookup and lives in a schema the
-- Data API does not expose. Behaviour is unchanged.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select true
    from auth.users u
    join public.admins a on a.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until < now())
    limit 1
  ), false);
$$;

revoke execute on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated, service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_admin();
$$;

revoke execute on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated, service_role;
