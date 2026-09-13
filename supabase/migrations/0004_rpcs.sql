-- UCHI 0004: public RPCs busy_slots and create_booking.
-- Contract: docs/ARCHITECTURE.md "RPCs". Both are security definer with an empty
-- search_path, every identifier schema-qualified, no dynamic SQL.

-- ------------------------------------------------------------- busy_slots --
-- Busy intervals for [p_from, p_to] (Brussels calendar dates, inclusive).
-- The range is capped at 62 days: p_to is clamped to p_from + 61. A null or
-- inverted range returns no rows. No customer data is ever selected.
create or replace function public.busy_slots(p_from date, p_to date)
returns table (staff_id text, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (p_from::timestamp at time zone 'Europe/Brussels') as lo,
           ((least(p_to, p_from + 61) + 1)::timestamp at time zone 'Europe/Brussels') as hi
    where p_from is not null and p_to is not null and p_to >= p_from
  )
  select b.staff_id, b.starts_at, b.ends_at
  from public.bookings b cross join bounds
  where b.status = 'confirmed' and b.starts_at < bounds.hi and b.ends_at > bounds.lo
  union all
  select t.staff_id, t.starts_at, t.ends_at
  from public.time_off t cross join bounds
  where t.staff_id is not null and t.starts_at < bounds.hi and t.ends_at > bounds.lo
  union all
  select s.id, t.starts_at, t.ends_at
  from public.time_off t cross join public.staff s cross join bounds
  where t.staff_id is null and s.active and t.starts_at < bounds.hi and t.ends_at > bounds.lo
  order by 2, 1;
$$;

revoke execute on function public.busy_slots(date, date) from public, anon, authenticated;
grant execute on function public.busy_slots(date, date) to anon, authenticated, service_role;

-- --------------------------------------------------------- create_booking --
create or replace function public.create_booking(
  p_service_ids text[],
  p_staff_id    text,
  p_date        date,
  p_time        text,
  p_name        text,
  p_email       text,
  p_phone       text,
  p_notes       text,
  p_hp          text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids         text[];
  v_n           integer;
  v_found       integer;
  v_groups      integer;
  v_minutes     integer;
  v_price       numeric(8,2);
  v_is_from     boolean;
  v_staff       text := nullif(btrim(p_staff_id), '');
  v_name        text := btrim(coalesce(p_name, ''));
  v_email       text := lower(btrim(coalesce(p_email, '')));
  v_phone       text := btrim(coalesce(p_phone, ''));
  v_notes       text := nullif(btrim(coalesce(p_notes, '')), '');
  v_time        text := btrim(coalesce(p_time, ''));
  v_set         public.settings%rowtype;
  v_t           time;
  v_local_start timestamp;
  v_local_end   timestamp;
  v_now_local   timestamp;
  v_start       timestamptz;
  v_end         timestamptz;
  v_candidates  text[];
  v_cand        text;
  v_id          uuid;
  v_staff_name  text;
begin
  -- Honeypot: a real visitor never fills it.
  if coalesce(btrim(p_hp), '') <> '' then
    return jsonb_build_object('ok', false, 'error', 'rejected');
  end if;

  -- Services: 1..6, no blanks, unique, all exist and active, no two share a group.
  if p_service_ids is null or cardinality(p_service_ids) not between 1 and 6 then
    return jsonb_build_object('ok', false, 'error', 'invalid_services');
  end if;
  select array_agg(btrim(x)) into v_ids from unnest(p_service_ids) as u(x);
  if exists (select 1 from unnest(v_ids) as u(x) where x is null or x = '') then
    return jsonb_build_object('ok', false, 'error', 'invalid_services');
  end if;
  v_n := cardinality(v_ids);
  if (select count(distinct x) from unnest(v_ids) as u(x)) <> v_n then
    return jsonb_build_object('ok', false, 'error', 'invalid_services');
  end if;

  select count(*), count(distinct s.grp), sum(s.minutes), sum(s.price), bool_or(s.is_from),
         array_agg(s.id order by s.sort, s.id)
    into v_found, v_groups, v_minutes, v_price, v_is_from, v_ids
  from public.services s
  where s.id = any (v_ids) and s.active;
  if v_found <> v_n or v_groups <> v_n then
    return jsonb_build_object('ok', false, 'error', 'invalid_services');
  end if;

  -- Stylist: active and offers every chosen service. Null = every capable
  -- stylist, tried in staff sort order.
  select array_agg(st.id order by st.sort, st.id) into v_candidates
  from public.staff st
  where st.active
    and (v_staff is null or st.id = v_staff)
    and (select count(*) from public.service_staff ss
         where ss.staff_id = st.id and ss.service_id = any (v_ids)) = v_n;
  if v_candidates is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_staff');
  end if;

  -- Date and time.
  if p_date is null then
    return jsonb_build_object('ok', false, 'error', 'rejected');
  end if;
  if v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return jsonb_build_object('ok', false, 'error', 'off_grid');
  end if;
  v_t := v_time::time;

  select * into v_set from public.settings where id = 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  if not (extract(dow from p_date)::smallint = any (v_set.open_days)) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  v_local_start := p_date + v_t;
  v_local_end   := v_local_start + make_interval(mins => v_minutes);

  if v_t < v_set.open_time or v_local_end > p_date + v_set.close_time then
    return jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  if ((extract(epoch from (v_t - v_set.open_time))::integer / 60) % v_set.slot_step_minutes) <> 0 then
    return jsonb_build_object('ok', false, 'error', 'off_grid');
  end if;

  if v_set.break_start is not null
     and v_local_start < p_date + v_set.break_end
     and v_local_end   > p_date + v_set.break_start then
    return jsonb_build_object('ok', false, 'error', 'in_break');
  end if;

  -- Past / lead time / horizon, judged on the Brussels wall clock.
  v_now_local := now() at time zone 'Europe/Brussels';
  if v_local_start < v_now_local + make_interval(mins => v_set.lead_time_minutes) then
    return jsonb_build_object('ok', false, 'error', 'too_soon');
  end if;
  if p_date > v_now_local::date + v_set.booking_horizon_days then
    return jsonb_build_object('ok', false, 'error', 'too_far');
  end if;

  v_start := v_local_start at time zone 'Europe/Brussels';
  v_end   := v_local_end   at time zone 'Europe/Brussels';

  -- Contact details.
  if char_length(v_name) not between 1 and 80
     or v_name ~ '[[:cntrl:]]'
     or char_length(v_email) not between 3 and 120
     or v_email !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:].]{2,}$'
     or char_length(v_phone) not between 1 and 30
     or v_phone ~ '[[:cntrl:]]'
     or (v_notes is not null and char_length(v_notes) > 500) then
    return jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  -- Rate limit per e-mail. The advisory lock serialises concurrent requests
  -- for the same address so the counts cannot be raced.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('uchi.create_booking:' || v_email, 0));
  if (select count(*) from public.bookings b
      where b.customer_email = v_email and b.status = 'confirmed' and b.starts_at > now()) >= 3
     or (select count(*) from public.bookings b
      where b.customer_email = v_email and b.created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  -- Whole-salon time off.
  if exists (select 1 from public.time_off t
             where t.staff_id is null and t.starts_at < v_end and t.ends_at > v_start) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  -- First capable stylist who is free. The exclusion constraint is the final
  -- arbiter under concurrency; a violation moves on to the next candidate.
  foreach v_cand in array v_candidates loop
    continue when exists (select 1 from public.time_off t
                          where t.staff_id = v_cand and t.starts_at < v_end and t.ends_at > v_start);
    continue when exists (select 1 from public.bookings b
                          where b.staff_id = v_cand and b.status = 'confirmed'
                            and b.starts_at < v_end and b.ends_at > v_start);
    v_id := null;
    begin
      insert into public.bookings
        (starts_at, ends_at, staff_id, service_ids, total_price, price_is_from, total_minutes,
         customer_name, customer_email, customer_phone, notes, status, source)
      values
        (v_start, v_end, v_cand, v_ids, v_price, v_is_from, v_minutes,
         v_name, v_email, v_phone, v_notes, 'confirmed', 'online')
      returning id into v_id;
    exception when exclusion_violation or unique_violation then
      v_id := null;
    end;
    if v_id is not null then
      select st.name into v_staff_name from public.staff st where st.id = v_cand;
      return jsonb_build_object(
        'ok', true,
        'id', v_id,
        'staff_id', v_cand,
        'staff_name', v_staff_name,
        'starts_at', v_start,
        'ends_at', v_end,
        'total_price', v_price,
        'price_is_from', v_is_from,
        'total_minutes', v_minutes);
    end if;
  end loop;

  return jsonb_build_object('ok', false, 'error', 'slot_taken');
end;
$$;

revoke execute on function public.create_booking(text[], text, date, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_booking(text[], text, date, text, text, text, text, text, text)
  to anon, authenticated, service_role;
