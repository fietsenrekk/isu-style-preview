-- 0007 booking confirmation email
--
-- Every confirmed booking that carries an e-mail address sends the client a
-- confirmation through Resend: HTML + plain text + an .ics calendar invite.
--
-- How it runs: an AFTER INSERT trigger on public.bookings queues an HTTPS call
-- with pg_net. pg_net's queue is transactional, so a booking that rolls back
-- never sends, and the call happens after commit, so a slow or failing mail
-- provider can never slow down or break a booking.
--
-- The Resend key lives in Supabase Vault (secret name 'resend_api_key'), never
-- in this file or the website.
--
-- MODES (private.email_config.mode):
--   sandbox  uchi.be is not verified at Resend yet. Resend only allows sending
--            from onboarding@resend.dev to the account owner, so every
--            confirmation goes to sandbox_to with the real client named in the
--            subject. Nothing reaches clients.
--   live     from 'UCHI <info@uchi.be>' to the client, reply-to info@uchi.be.
-- Go live, once the domain shows "verified" in Resend:
--   update private.email_config set mode = 'live';
-- Stop all sending:
--   update private.email_config set mode = 'off';

create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ------------------------------------------------------------------ config --
create table if not exists private.email_config (
  id               smallint primary key default 1 check (id = 1),
  mode             text not null default 'sandbox' check (mode in ('sandbox', 'live', 'off')),
  from_live        text not null default 'UCHI <info@uchi.be>',
  reply_to_live    text not null default 'info@uchi.be',
  from_sandbox     text not null default 'UCHI <onboarding@resend.dev>',
  sandbox_to       text not null,
  site_url         text not null default 'https://labiwebsite.netlify.app',
  salon_phone      text not null default '+32 498 80 30 33',
  salon_address    text not null default 'Klapdorp 37, 2000 Antwerpen',
  updated_at       timestamptz not null default now()
);
insert into private.email_config (id, sandbox_to)
values (1, 'charlesmuwangam@gmail.com')
on conflict (id) do nothing;

-- --------------------------------------------------------------------- log --
create table if not exists private.email_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  booking_id  uuid,
  kind        text not null,
  mode        text not null,
  recipient   text not null,
  request_id  bigint,
  error       text
);
create index if not exists email_log_booking_idx on private.email_log (booking_id);

revoke all on all tables in schema private from public, anon, authenticated;

-- ----------------------------------------------------------------- helpers --
create or replace function private.html_escape(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(coalesce(p, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

create or replace function private.ics_escape(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(coalesce(p, ''),
    '\', '\\'), ';', '\;'), ',', '\,'), E'\n', '\n');
$$;

-- 35.00 -> '35', 7.50 -> '7.50'
create or replace function private.money(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p = trunc(p) then trunc(p)::text else to_char(p, 'FM999990.00') end;
$$;

-- ----------------------------------------------------------------- payload --
-- Builds the full Resend request body for one booking without sending it, so
-- the content can be inspected and tested on its own.
create or replace function private.booking_confirmation_payload(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b          public.bookings%rowtype;
  cfg        private.email_config%rowtype;
  staff_name text;
  loc_start  timestamp;
  loc_end    timestamp;
  day_long   text;
  day_short  text;
  time_range text;
  total      text;
  rows_html  text := '';
  rows_text  text := '';
  names      text := '';
  s          record;
  html       text;
  plain      text;
  ics        text;
  subject    text;
  recipient  text;
  sender     text;
  reply_to   text;
  first_name text;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking % not found', p_booking_id;
  end if;
  select * into cfg from private.email_config where id = 1;
  select st.name into staff_name from public.staff st where st.id = b.staff_id;

  loc_start  := b.starts_at at time zone 'Europe/Brussels';
  loc_end    := b.ends_at   at time zone 'Europe/Brussels';
  day_long   := to_char(loc_start, 'FMDay FMDD FMMonth YYYY');
  day_short  := to_char(loc_start, 'Dy FMDD Mon');
  time_range := to_char(loc_start, 'HH24:MI') || ' - ' || to_char(loc_end, 'HH24:MI');
  total      := case when b.price_is_from then 'from ' else '' end || private.money(b.total_price) || ' euro';
  first_name := split_part(btrim(b.customer_name), ' ', 1);

  for s in
    select sv.name, sv.price, sv.is_from
    from unnest(b.service_ids) with ordinality as u(service_id, ord)
    join public.services sv on sv.id = u.service_id
    order by u.ord
  loop
    names := names || case when names = '' then '' else ', ' end || s.name;
    rows_html := rows_html
      || '<tr><td style="padding:6px 16px 6px 0;text-align:right;width:50%;border-right:3px solid #000;font-size:15px;">'
      || private.html_escape(s.name)
      || '</td><td style="padding:6px 0 6px 16px;text-align:left;font-size:15px;">'
      || case when s.is_from then 'from ' else '' end || private.money(s.price)
      || '</td></tr>';
    rows_text := rows_text || '  ' || s.name || ': ' || case when s.is_from then 'from ' else '' end
      || private.money(s.price) || E' euro\n';
  end loop;

  if cfg.mode = 'live' then
    recipient := b.customer_email;
    sender    := cfg.from_live;
    reply_to  := cfg.reply_to_live;
    subject   := 'Your UCHI appointment: ' || day_short || ', ' || to_char(loc_start, 'HH24:MI');
  else
    recipient := cfg.sandbox_to;
    sender    := cfg.from_sandbox;
    reply_to  := cfg.sandbox_to;
    subject   := '[TEST for ' || b.customer_email || '] Your UCHI appointment: '
                 || day_short || ', ' || to_char(loc_start, 'HH24:MI');
  end if;

  html :=
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    || '<meta name="viewport" content="width=device-width,initial-scale=1">'
    || '<title>' || private.html_escape(subject) || '</title></head>'
    || '<body style="margin:0;padding:0;background:#fcfcfc;color:#000;font-family:Helvetica,Arial,sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fcfcfc;">'
    || '<tr><td align="center" style="padding:40px 16px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">'
    || '<tr><td align="right" style="padding-bottom:36px;">'
    || '<img src="' || cfg.site_url || '/assets/brand/uchi-logo.png" width="150" height="55" alt="UCHI, hair is hair" style="display:block;border:0;">'
    || '</td></tr>'
    || '<tr><td style="font-size:26px;font-weight:bold;letter-spacing:.02em;padding-bottom:10px;">YOUR APPOINTMENT IS BOOKED</td></tr>'
    || '<tr><td style="font-size:15px;line-height:22px;padding-bottom:28px;">Hi '
    || private.html_escape(first_name)
    || ', thanks for booking at UCHI. Here are your details.</td></tr>'
    || '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #000;border-bottom:1px solid #000;">'
    || '<tr><td style="padding:14px 16px 6px 0;text-align:right;width:50%;border-right:3px solid #000;font-size:15px;">DATE</td>'
    || '<td style="padding:14px 0 6px 16px;font-size:15px;font-weight:bold;">' || private.html_escape(day_long) || '</td></tr>'
    || '<tr><td style="padding:6px 16px 6px 0;text-align:right;border-right:3px solid #000;font-size:15px;">TIME</td>'
    || '<td style="padding:6px 0 6px 16px;font-size:15px;font-weight:bold;">' || time_range || '</td></tr>'
    || '<tr><td style="padding:6px 16px 14px 0;text-align:right;border-right:3px solid #000;font-size:15px;">STYLIST</td>'
    || '<td style="padding:6px 0 14px 16px;font-size:15px;font-weight:bold;">' || private.html_escape(coalesce(staff_name, b.staff_id)) || '</td></tr>'
    || rows_html
    || '<tr><td style="padding:14px 16px 14px 0;text-align:right;border-right:3px solid #000;font-size:15px;">TOTAL</td>'
    || '<td style="padding:14px 0 14px 16px;font-size:15px;font-weight:bold;">' || total || '</td></tr>'
    || '</table></td></tr>'
    || '<tr><td style="font-size:13px;line-height:19px;color:#555;padding-top:10px;">Prices marked "from" depend on hair length and the work involved.</td></tr>'
    || '<tr><td style="font-size:15px;line-height:22px;padding-top:28px;">'
    || '<strong>UCHI</strong><br>' || private.html_escape(cfg.salon_address) || '</td></tr>'
    || '<tr><td style="font-size:15px;line-height:22px;padding-top:18px;">'
    || 'Need to change or cancel? Call <a href="tel:' || replace(cfg.salon_phone, ' ', '') || '" style="color:#000;">'
    || cfg.salon_phone || '</a> at least 4 hours before your appointment.'
    || '</td></tr>'
    || '<tr><td style="font-size:13px;line-height:19px;color:#555;padding-top:18px;">The calendar invite attached to this e-mail adds the appointment to your phone.</td></tr>'
    || '<tr><td style="font-size:12px;color:#888;padding-top:36px;border-top:1px solid #ddd;margin-top:28px;">'
    || '<a href="' || cfg.site_url || '/home" style="color:#888;">UCHI</a> &middot; hair is hair</td></tr>'
    || '</table></td></tr></table></body></html>';

  plain :=
    'YOUR APPOINTMENT IS BOOKED' || E'\n\n'
    || 'Hi ' || first_name || E', thanks for booking at UCHI.\n\n'
    || 'Date:    ' || day_long || E'\n'
    || 'Time:    ' || time_range || E'\n'
    || 'Stylist: ' || coalesce(staff_name, b.staff_id) || E'\n\n'
    || rows_text
    || 'Total:   ' || total || E'\n\n'
    || 'UCHI, ' || cfg.salon_address || E'\n'
    || 'Need to change or cancel? Call ' || cfg.salon_phone || E' at least 4 hours before your appointment.\n';

  ics := concat_ws(E'\r\n',
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UCHI//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' || b.id::text || '@uchi.be',
    'DTSTAMP:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
    'DTSTART:' || to_char(b.starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
    'DTEND:'   || to_char(b.ends_at   at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
    'SUMMARY:' || private.ics_escape('UCHI: ' || names),
    'LOCATION:' || private.ics_escape('UCHI, ' || cfg.salon_address),
    'DESCRIPTION:' || private.ics_escape('With ' || coalesce(staff_name, b.staff_id) || '. To change or cancel call ' || cfg.salon_phone || '.'),
    'END:VEVENT',
    'END:VCALENDAR') || E'\r\n';

  return jsonb_build_object(
    'from', sender,
    'to', jsonb_build_array(recipient),
    'reply_to', reply_to,
    'subject', subject,
    'html', html,
    'text', plain,
    'attachments', jsonb_build_array(jsonb_build_object(
      'filename', 'uchi-appointment.ics',
      'content', replace(encode(convert_to(ics, 'UTF8'), 'base64'), E'\n', ''),
      'content_type', 'text/calendar; charset=utf-8'
    )),
    'tags', jsonb_build_array(jsonb_build_object('name', 'category', 'value', 'booking_confirmation'))
  );
end;
$$;

-- -------------------------------------------------------------------- send --
create or replace function private.send_booking_confirmation(p_booking_id uuid)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cfg     private.email_config%rowtype;
  body    jsonb;
  api_key text;
  req_id  bigint;
begin
  select * into cfg from private.email_config where id = 1;
  if cfg.mode = 'off' then
    return null;
  end if;

  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if api_key is null then
    insert into private.email_log (booking_id, kind, mode, recipient, error)
    values (p_booking_id, 'confirmation', cfg.mode, '', 'resend_api_key missing from vault');
    return null;
  end if;

  body := private.booking_confirmation_payload(p_booking_id);

  select net.http_post(
    url := 'https://api.resend.com/emails',
    body := body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key,
      'Idempotency-Key', 'uchi-confirm-' || p_booking_id::text
    ),
    timeout_milliseconds := 10000
  ) into req_id;

  insert into private.email_log (booking_id, kind, mode, recipient, request_id)
  values (p_booking_id, 'confirmation', cfg.mode, body->'to'->>0, req_id);

  return req_id;
end;
$$;

-- ----------------------------------------------------------------- trigger --
create or replace function private.bookings_after_insert_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and coalesce(btrim(new.customer_email), '') <> '' then
    begin
      perform private.send_booking_confirmation(new.id);
    exception when others then
      -- A mail problem must never cost the salon a booking.
      insert into private.email_log (booking_id, kind, mode, recipient, error)
      values (new.id, 'confirmation', 'unknown', coalesce(new.customer_email, ''), sqlerrm);
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_send_confirmation on public.bookings;
create trigger bookings_send_confirmation
  after insert on public.bookings
  for each row execute function private.bookings_after_insert_email();

-- ------------------------------------------------------- delivery overview --
-- Latest sends joined with Resend's HTTP answer (pg_net keeps responses ~6h).
create or replace view private.email_delivery as
  select l.created_at, l.booking_id, l.mode, l.recipient, l.error,
         r.status_code, left(r.content::text, 300) as response
  from private.email_log l
  left join net._http_response r on r.id = l.request_id
  order by l.created_at desc;

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;
