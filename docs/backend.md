# UCHI backend (Supabase)

Project `Uchi - Barber`, ref `kvnnikyjsvhxpdftfagj`, Postgres 17. The contract is
`docs/ARCHITECTURE.md`; this file documents what is actually deployed and where it
differs. The schema is fully reproducible from `supabase/migrations/` (applied in
order 0001 to 0006; the repo files are byte-identical to what was applied).

| migration | content |
|---|---|
| 0001_extensions_and_tables | `btree_gist` in schema `extensions`, all tables, checks, exclusion constraint, indexes |
| 0002_seed | settings, staff, services, service_staff (mirrors `assets/booking-data.js`), admin allowlist |
| 0003_security | `is_admin()`, last-admin trigger, GRANT/REVOKE, RLS policies |
| 0004_rpcs | `busy_slots`, `create_booking` |
| 0005_storage | bucket `gallery` and `storage.objects` policies |
| 0006_is_admin_private | `is_admin()` body moved to non-exposed schema `private` (advisor fix) |

## Tables (schema `public`)

All business times are Europe/Brussels; instants are `timestamptz`.

- `settings` (single row, `id = 1`): `open_days smallint[]` (0=Sun..6=Sat), `open_time`,
  `close_time`, `break_start`, `break_end` (both null or both set), `slot_step_minutes`,
  `lead_time_minutes`, `booking_horizon_days`, `updated_at`.
  Seed: `{1,2,3,4,5}`, 10:00-22:00, break 14:00-15:00, step 15, lead 60, horizon 60.
- `staff`: `id` (`labi`, `donovan`), `name`, `role`, `sort`, `active`.
- `services`: `id`, `name`, `nl`, `price numeric(8,2)`, `is_from`, `minutes`, `grp`, `sort`, `active`.
  Seed (sort order): knippen 35 from 45min cut; blowdry 35 from 45min blowdry; wassen 7.50 fixed 15min wash;
  highlights 60 from 90min colour; balayage 160 from 180min colour; roots 50 from 90min colour;
  kleuring 50 from 120min colour; toner 45 from 45min toner.
- `service_staff (service_id, staff_id)`: labi = knippen, blowdry, wassen; donovan = all 8.
- `bookings`: `id`, `created_at`, `starts_at`, `ends_at` (> starts), `staff_id` (not null),
  `service_ids text[]` (1..6), `total_price`, `price_is_from`, `total_minutes`,
  `customer_name` (1..80), `customer_email` (<=120), `customer_phone` (<=30, not null),
  `notes` (<=500, null), `status` (`confirmed|cancelled|completed|no_show`), `source` (`online|admin`).
  `EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'confirmed')`
  (constraint name `bookings_no_overlap`; ranges are half-open, so 10:00-10:45 and 10:45-11:30 do not clash;
  cancelled/completed/no_show rows never block).
  Indexes: `starts_at`, `customer_email`, `staff_id`.
- `time_off`: `id`, `staff_id` (null = whole salon), `starts_at`, `ends_at` (> starts), `reason` (<=200). Index `starts_at`, `staff_id`.
- `gallery_images`: `id`, `created_at`, `path` (unique, object path in bucket `gallery`), `caption` (<=140),
  `alt` (<=200), `sort`, `published` (default true), `width`, `height`.
- `admins`: `email` primary key. **Must be stored lower-case and trimmed** (check constraint; an
  upper-case insert fails with 23514, so lower-case it in the client).

## Access control

`public.is_admin()` returns true only for the caller's own session: signed in, not an anonymous
user, e-mail confirmed, not banned or deleted, and `lower(email)` in `public.admins`. It takes no
arguments, so it cannot be used to test other addresses. It is a SECURITY INVOKER wrapper around
`private.is_admin()` (SECURITY DEFINER, `search_path = ''`), which reads `auth.users`; schema
`private` is not exposed by the Data API. EXECUTE: `authenticated`, `service_role` only.

Table privileges (explicit; everything else revoked from `anon`/`authenticated`):

| table | anon | authenticated | RLS (authenticated) |
|---|---|---|---|
| settings | SELECT | SELECT, INSERT, UPDATE, DELETE | select all rows; writes admin only |
| staff, services | SELECT (active rows) | SELECT, INSERT, UPDATE, DELETE | select active rows, admin sees all; writes admin only |
| service_staff | SELECT | SELECT, INSERT, UPDATE, DELETE | select all; writes admin only |
| gallery_images | SELECT (published) | SELECT, INSERT, UPDATE, DELETE | select published, admin sees all; writes admin only |
| bookings | none (42501 permission denied) | SELECT, INSERT, UPDATE, DELETE | admin only (non-admin sees 0 rows, inserts fail RLS) |
| time_off | none | SELECT, INSERT, UPDATE, DELETE | admin only |
| admins | none | SELECT, INSERT, DELETE (no UPDATE) | admin only |

Deleting the last admin raises `P0001: cannot delete the last admin` (statement-level trigger
`admins_keep_one`; applies to every role, including the service role).

Also: `alter default privileges ... in schema public revoke execute on functions from anon, authenticated`.
Any new function in `public` must be granted explicitly before the API can call it.

### Storage

Bucket `gallery`: public, 10 MB (`10485760`), `image/jpeg, image/png, image/webp, image/avif`.
Public files are served by the public URL (`getPublicUrl`), which needs no policy.
`storage.objects` policies, all `to authenticated` with `bucket_id = 'gallery' and is_admin()`:
INSERT, UPDATE, DELETE, and SELECT (see deviations). No anon policy, so anon cannot list the bucket.

## RPCs

Both are SECURITY DEFINER, `search_path = ''`, schema-qualified, no dynamic SQL, EXECUTE for
`anon`, `authenticated`, `service_role`.

### `busy_slots(p_from date, p_to date)` returns `table(staff_id, starts_at, ends_at)`

Busy intervals overlapping the Brussels calendar days `p_from..p_to` inclusive: confirmed bookings,
staff time off, and whole-salon time off expanded to every active stylist. No customer columns.
Range cap: `p_to` is clamped to `p_from + 61` (62 days). A null or inverted range returns no rows.

```js
const { data, error } = await sb.rpc('busy_slots', { p_from: '2026-09-22', p_to: '2026-11-20' });
// data: [{ staff_id: 'labi', starts_at: '2026-09-22T08:00:00+00:00', ends_at: '2026-09-22T08:45:00+00:00' }, ...]
```

### `create_booking(...)` returns `jsonb`

```js
const { data, error } = await sb.rpc('create_booking', {
  p_service_ids: ['knippen', 'wassen'],
  p_staff_id: null,            // null or '' = first free capable stylist, in staff sort order
  p_date: '2026-09-22',        // Brussels calendar date
  p_time: '10:00',             // 'HH:MM' Brussels wall clock, 00:00-23:59
  p_name: 'Sam', p_email: 'sam@example.com', p_phone: '+32 470 00 00 00',
  p_notes: null,
  p_hp: ''                     // honeypot, must be empty
});
// success: { ok: true, id, staff_id, staff_name, starts_at, ends_at, total_price, price_is_from, total_minutes }
// failure: { ok: false, error: 'slot_taken' }   (error is null in both cases; check data.ok)
```

All text inputs are trimmed; e-mail is lower-cased; service ids are trimmed and stored in service
sort order. Totals come from the database. The first failing check is returned:

| code | meaning |
|---|---|
| `rejected` | honeypot filled, or `p_date` null |
| `invalid_services` | null/empty/more than 6, blank or duplicate id, unknown or inactive service, two services share `grp` |
| `invalid_staff` | stylist unknown/inactive, or does not offer every chosen service (or nobody does, when null) |
| `off_grid` | `p_time` not `HH:MM`, or start not a multiple of `slot_step_minutes` after `open_time` |
| `closed` | weekday not in `open_days`, settings row missing, or whole-salon time off overlaps |
| `outside_hours` | start before `open_time` or end after `close_time` |
| `in_break` | the visit overlaps `break_start..break_end` |
| `too_soon` | start earlier than now (Brussels) + `lead_time_minutes`; this also covers past dates |
| `too_far` | date later than today (Brussels) + `booking_horizon_days` |
| `invalid_contact` | name not 1..80 or contains control characters; e-mail not 3..120 or not `x@y.tld`; phone not 1..30 or contains control characters; notes over 500 |
| `rate_limited` | e-mail already has 3 future confirmed bookings, or created 5 bookings in the last hour |
| `slot_taken` | the stylist (or every capable stylist) has time off or a confirmed booking overlapping, or the insert hit the exclusion/unique constraint |

Exact evaluation order: honeypot (`rejected`), `invalid_services`, `invalid_staff`, null date
(`rejected`), malformed time (`off_grid`), `closed` (weekday), `outside_hours`, `off_grid`, `in_break`,
`too_soon`, `too_far`, `invalid_contact`, `rate_limited`, `closed` (whole-salon time off), `slot_taken`.

## Admin writes

Admins write tables directly through RLS (e.g. `sb.from('bookings').insert({... , source: 'admin'})`).
The exclusion constraint still rejects overlapping confirmed bookings with Postgres error `23P01`.

## Adding another admin

In the SQL editor (or from `/admin` while signed in as an admin):

```sql
insert into public.admins (email) values ('new.person@example.com');  -- lower-case
```

The person then needs a Supabase Auth user with that e-mail and a confirmed address.

## Manual dashboard steps for the owner

These are Auth/project settings, not database objects, so no migration can set them.

1. Create the login: Authentication > Users > Add user, with `info@uchi.be` (or
   `charlesmuwangam@gmail.com`), auto-confirm the e-mail, choose the password yourself.
   Alternatively sign up once at `/admin` if the page offers it and confirm the e-mail.
2. After every admin has an account: Authentication > Sign In / Providers > disable
   "Allow new users to sign up". (Non-admin accounts can read nothing private anyway, but
   there is no reason to allow them.)
3. Authentication > URL Configuration: set Site URL to the production domain and add it
   (and the Netlify URL) to Redirect URLs.
4. Recommended: Authentication > Attack Protection > enable leaked-password protection
   (https://supabase.com/docs/guides/auth/password-security) if the plan allows it.

## Deviations from the contract

1. **Admin-only SELECT policy on `storage.objects`** for bucket `gallery`. Supabase Storage needs
   SELECT together with UPDATE for upsert/overwrite, and the admin needs to list the bucket.
   Anonymous visitors still have no SELECT/list policy.
2. **`public.is_admin()` is SECURITY INVOKER** and delegates to `private.is_admin()` (SECURITY
   DEFINER). Same name, same result; the privileged part is no longer reachable at `/rest/v1/rpc`.
3. **`busy_slots` clamps** an over-long range instead of raising an error.
4. **Error-code mapping for cases the contract does not name**: malformed `p_time` -> `off_grid`;
   null `p_date` -> `rejected`; past start -> `too_soon`; whole-salon time off -> `closed`; stylist
   time off -> `slot_taken`.
5. **Phone is required** (1..30), matching the booking form, where it is a required field.
6. Extra indexes on `bookings(staff_id)`, `time_off(staff_id)`, `service_staff(staff_id)` for foreign keys.

## Remaining advisor warnings (accepted by design)

`0028 anon_security_definer_function_executable` and `0029 authenticated_security_definer_function_executable`
for `busy_slots` and `create_booking`
(https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
They must be callable by visitors, and must be definer because visitors cannot read `bookings`.
Each exposes only what the contract allows: busy intervals without customer data, and a fully
validated insert.

## Not proven

The admin-positive path (a real admin reading/writing through RLS and uploading to storage) was not
exercised, because that needs an Auth user and creating one was out of scope. The non-admin and anon
paths were proven. After the owner's login exists, a quick check: sign in at `/admin`, confirm the
bookings list loads, and `select public.is_admin()` returns true for that session.

## Booking confirmation e-mail (migration 0007)

Every confirmed booking with an e-mail address gets a confirmation through
**Resend**: HTML, plain text and an `.ics` calendar invite. An `AFTER INSERT`
trigger on `public.bookings` queues the HTTPS call with `pg_net`, so it only
fires for committed bookings and can never slow down or break a booking.
Phone bookings entered in /admin without an e-mail send nothing.

- Resend key: Supabase Vault secret `resend_api_key` (sending-only key). Never in the repo.
- Settings: `private.email_config` (single row).
- Log: `private.email_log`; delivery answers: `select * from private.email_delivery;`
- Preview an e-mail without sending: `select private.booking_confirmation_payload('<booking id>');`

### Modes

| mode | behaviour |
|---|---|
| `sandbox` (current) | `uchi.be` not yet verified at Resend. Sends from `onboarding@resend.dev` to `sandbox_to` (the Resend account owner) with the real client named in the subject. No client receives anything. |
| `live` | Sends from `UCHI <info@uchi.be>` to the client, reply-to `info@uchi.be`. |
| `off` | Sends nothing. |

### Going live when the OVH domain arrives

1. In OVH, add the DNS records Resend gave for `uchi.be` (domain already created in Resend, region eu-west-1):
   - TXT `resend._domainkey` (DKIM value shown in Resend > Domains > uchi.be)
   - MX `send` → `feedback-smtp.eu-west-1.amazonses.com`, priority 10
   - TXT `send` → `v=spf1 include:amazonses.com ~all`
   - CNAME `rsend` → `send.forge.rmta.net`
   These live on the `send` / `resend._domainkey` / `rsend` sub-names, so they do not clash with OVH's own mailbox MX records for `info@uchi.be`.
2. In Resend > Domains > uchi.be, press Verify and wait for "verified".
3. Run: `update private.email_config set mode = 'live', updated_at = now();`
4. When the site itself moves to uchi.be: `update private.email_config set site_url = 'https://uchi.be', updated_at = now();` (used for the logo image and the site link in the e-mail).
