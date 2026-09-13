-- UCHI 0003: is_admin(), row-level security, table privileges, last-admin guard.
-- Contract: docs/ARCHITECTURE.md "Row-level security".
--
-- Two layers, both explicit:
--   1. GRANT/REVOKE decides which statements a role may attempt at all.
--      anon gets SELECT on the public catalogue and nothing else.
--      authenticated gets the writes an admin needs; RLS below narrows them to admins.
--   2. RLS policies decide which rows. Admin checks call (select public.is_admin())
--      so Postgres evaluates it once per statement, not once per row.

-- ---------------------------------------------------------------- is_admin --
-- True only for the caller's own session: signed in, not anonymous, e-mail
-- confirmed, not banned/deleted, and lower(email) on the allowlist. It takes no
-- arguments, so it cannot be used to probe whether some other address is an admin.
create or replace function public.is_admin()
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

revoke execute on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated, service_role;

-- ------------------------------------------------------ last admin guard --
create or replace function public.admins_keep_one()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.admins) then
    raise exception 'cannot delete the last admin' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

revoke execute on function public.admins_keep_one() from public, anon, authenticated;

create trigger admins_keep_one
  after delete on public.admins
  for each statement execute function public.admins_keep_one();

-- ---------------------------------------------------------- privileges --
revoke all on table
  public.settings, public.staff, public.services, public.service_staff,
  public.gallery_images, public.bookings, public.time_off, public.admins
from anon, authenticated;

grant select on table
  public.settings, public.staff, public.services, public.service_staff, public.gallery_images
to anon;

grant select, insert, update, delete on table
  public.settings, public.staff, public.services, public.service_staff,
  public.gallery_images, public.bookings, public.time_off
to authenticated;

grant select, insert, delete on table public.admins to authenticated;

-- Functions created later in schema public are not executable by the API roles
-- until granted explicitly.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- ------------------------------------------------------------------ RLS --
alter table public.settings       enable row level security;
alter table public.staff          enable row level security;
alter table public.services       enable row level security;
alter table public.service_staff  enable row level security;
alter table public.gallery_images enable row level security;
alter table public.bookings       enable row level security;
alter table public.time_off       enable row level security;
alter table public.admins         enable row level security;

-- settings
create policy settings_select on public.settings
  for select to anon, authenticated using (true);
create policy settings_admin_insert on public.settings
  for insert to authenticated with check ((select public.is_admin()));
create policy settings_admin_update on public.settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy settings_admin_delete on public.settings
  for delete to authenticated using ((select public.is_admin()));

-- staff
create policy staff_select_anon on public.staff
  for select to anon using (active);
create policy staff_select_auth on public.staff
  for select to authenticated using (active or (select public.is_admin()));
create policy staff_admin_insert on public.staff
  for insert to authenticated with check ((select public.is_admin()));
create policy staff_admin_update on public.staff
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy staff_admin_delete on public.staff
  for delete to authenticated using ((select public.is_admin()));

-- services
create policy services_select_anon on public.services
  for select to anon using (active);
create policy services_select_auth on public.services
  for select to authenticated using (active or (select public.is_admin()));
create policy services_admin_insert on public.services
  for insert to authenticated with check ((select public.is_admin()));
create policy services_admin_update on public.services
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy services_admin_delete on public.services
  for delete to authenticated using ((select public.is_admin()));

-- service_staff
create policy service_staff_select on public.service_staff
  for select to anon, authenticated using (true);
create policy service_staff_admin_insert on public.service_staff
  for insert to authenticated with check ((select public.is_admin()));
create policy service_staff_admin_update on public.service_staff
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy service_staff_admin_delete on public.service_staff
  for delete to authenticated using ((select public.is_admin()));

-- gallery_images
create policy gallery_images_select_anon on public.gallery_images
  for select to anon using (published);
create policy gallery_images_select_auth on public.gallery_images
  for select to authenticated using (published or (select public.is_admin()));
create policy gallery_images_admin_insert on public.gallery_images
  for insert to authenticated with check ((select public.is_admin()));
create policy gallery_images_admin_update on public.gallery_images
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy gallery_images_admin_delete on public.gallery_images
  for delete to authenticated using ((select public.is_admin()));

-- bookings: admins only (anon has no privileges at all)
create policy bookings_admin_all on public.bookings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- time_off: admins only
create policy time_off_admin_all on public.time_off
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- admins: admins may read, add and remove (never the last one: trigger above)
create policy admins_admin_select on public.admins
  for select to authenticated using ((select public.is_admin()));
create policy admins_admin_insert on public.admins
  for insert to authenticated with check ((select public.is_admin()));
create policy admins_admin_delete on public.admins
  for delete to authenticated using ((select public.is_admin()));
