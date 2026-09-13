-- UCHI 0001: extensions, tables, constraints, indexes.
-- Contract: docs/ARCHITECTURE.md "Database". Business timezone is Europe/Brussels;
-- all instants are stored as timestamptz.

create extension if not exists btree_gist with schema extensions;

create table public.settings (
  id                   smallint primary key default 1 check (id = 1),
  open_days            smallint[] not null default '{1,2,3,4,5}'
                         check (open_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  open_time            time not null default '10:00',
  close_time           time not null default '22:00',
  break_start          time null,
  break_end            time null,
  slot_step_minutes    smallint not null default 15 check (slot_step_minutes between 5 and 240),
  lead_time_minutes    smallint not null default 60 check (lead_time_minutes >= 0),
  booking_horizon_days smallint not null default 60 check (booking_horizon_days between 1 and 366),
  updated_at           timestamptz not null default now(),
  constraint settings_hours_order check (open_time < close_time),
  constraint settings_break_pair check ((break_start is null) = (break_end is null)),
  constraint settings_break_order check (break_start is null or break_start < break_end)
);

create table public.staff (
  id     text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  name   text not null check (char_length(name) between 1 and 80),
  role   text not null default 'Hairstylist' check (char_length(role) between 1 and 80),
  sort   smallint not null default 0,
  active boolean not null default true
);

create table public.services (
  id      text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  name    text not null check (char_length(name) between 1 and 80),
  nl      text not null check (char_length(nl) between 1 and 80),
  price   numeric(8,2) not null check (price >= 0),
  is_from boolean not null default false,
  minutes smallint not null check (minutes between 5 and 600),
  grp     text not null check (char_length(grp) between 1 and 40),
  sort    smallint not null default 0,
  active  boolean not null default true
);

create table public.service_staff (
  service_id text not null references public.services(id) on delete cascade,
  staff_id   text not null references public.staff(id) on delete cascade,
  primary key (service_id, staff_id)
);
create index service_staff_staff_id_idx on public.service_staff (staff_id);

create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  staff_id       text not null references public.staff(id) on delete restrict,
  service_ids    text[] not null check (cardinality(service_ids) between 1 and 6),
  total_price    numeric(8,2) not null check (total_price >= 0),
  price_is_from  boolean not null default false,
  total_minutes  smallint not null check (total_minutes > 0),
  customer_name  text not null check (char_length(customer_name) between 1 and 80),
  customer_email text not null check (char_length(customer_email) <= 120),
  customer_phone text not null check (char_length(customer_phone) <= 30),
  notes          text null check (notes is null or char_length(notes) <= 500),
  status         text not null default 'confirmed'
                   check (status in ('confirmed','cancelled','completed','no_show')),
  source         text not null default 'online' check (source in ('online','admin')),
  constraint bookings_time_order check (ends_at > starts_at),
  -- Database-level double-booking guard: one stylist, one confirmed booking at a time.
  constraint bookings_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed')
);
create index bookings_starts_at_idx on public.bookings (starts_at);
create index bookings_customer_email_idx on public.bookings (customer_email);
create index bookings_staff_id_idx on public.bookings (staff_id);

create table public.time_off (
  id        uuid primary key default gen_random_uuid(),
  staff_id  text null references public.staff(id) on delete cascade, -- null = whole salon
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  reason    text null check (reason is null or char_length(reason) <= 200),
  constraint time_off_time_order check (ends_at > starts_at)
);
create index time_off_starts_at_idx on public.time_off (starts_at);
create index time_off_staff_id_idx on public.time_off (staff_id);

create table public.gallery_images (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  path       text not null unique check (char_length(path) between 1 and 512),
  caption    text null check (caption is null or char_length(caption) <= 140),
  alt        text null check (alt is null or char_length(alt) <= 200),
  sort       integer not null default 0,
  published  boolean not null default true,
  width      integer null check (width is null or width > 0),
  height     integer null check (height is null or height > 0)
);

create table public.admins (
  email text primary key
    check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and position('@' in email) > 1)
);
