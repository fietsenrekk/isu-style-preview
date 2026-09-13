# UCHI — architecture contract

Static site (no build step) served by **Netlify** (site `labiwebsite`, auto-deploys
`main` of github.com/fietsenrekk/isu-style-preview), backed by **Supabase**
free tier (project `Uchi - Barber`, ref `kvnnikyjsvhxpdftfagj`, eu-west-1).

Every part below is built against this document. If you need to change a
contract, change it here first.

## Pages and URLs

| URL | File | In nav |
|---|---|---|
| `/` | `index.html` | forwards to `/home` (Netlify 301 + JS fallback) |
| `/home` | `home.html` | INTRO / CONTACT are in-page sections (`/home#intro`, `/home#contact`) |
| `/gallery` | `gallery.html` | GALLERY |
| `/reservation` | `reservation.html` | RESERVATION |
| `/admin` | `admin.html` | **never linked from the public site**, `noindex` |

Public nav order everywhere (desktop left nav and mobile burger):
`INTRO, CONTACT, GALLERY, RESERVATION` (mobile adds `HOME` first). Every page
carries the full nav, so any page is reachable from any page.

## Shared browser globals / files

- `assets/vendor/supabase-2.116.0.js` — pinned UMD build of @supabase/supabase-js,
  defines `window.supabase`. Self-hosted: no third-party scripts run on the site.
- `assets/supabase-config.js` — `window.UCHI_SUPABASE = { url, key }` (publishable key).
- `assets/js/sb.js` — `window.UchiDB.client()` returns one shared client with NO session persistence (public pages).
  `/admin` calls `UchiDB.client({ public: false })` to persist and refresh the admin session.
  Script order on every page: vendor/supabase-2.116.0.js, supabase-config.js, js/sb.js, then page scripts.
- `assets/booking-data.js` — static fallback catalogue (`window.SHOP`), same shape as before.
- `assets/catalog.js` — `window.UchiCatalog.load(): Promise<SHOP>`; builds the SHOP
  object from the database (settings/staff/services/service_staff), falls back to
  `window.SHOP` if the network or database fails, never rejects.

## Design language (public and admin)

Paper `#fcfcfc`, ink `#000`, grey `#888`. Display face **Bebas Neue**, text face
**Abel** (self-hosted in `assets/fonts/`). ISU easings `--ease1 cubic-bezier(.37,1.12,.51,.9)`,
`--ease2 cubic-bezier(.19,1,.22,1)`. New smooth in/out curve for page and menu
transitions: `--ease-io: cubic-bezier(.76,0,.24,1)`. No em dashes in any visible copy.
No gendered wording anywhere.

## Database (schema `public`, Postgres 17)

Timezone for all business logic: **Europe/Brussels**. Timestamps stored as `timestamptz`.

```
settings        id smallint pk check (id = 1)
                open_days smallint[]      -- 0=Sun..6=Sat, default {1,2,3,4,5}
                open_time time            -- 10:00
                close_time time           -- 22:00
                break_start time null     -- 14:00
                break_end time null       -- 15:00
                slot_step_minutes smallint  -- 15
                lead_time_minutes smallint  -- 60
                booking_horizon_days smallint -- 60
                updated_at timestamptz

staff           id text pk ('labi','donovan'), name text, role text, sort smallint, active bool

services        id text pk ('knippen','blowdry','wassen','highlights','balayage','roots','kleuring','toner')
                name text, nl text, price numeric(8,2), is_from bool, minutes smallint,
                grp text, sort smallint, active bool

service_staff   service_id text fk, staff_id text fk, pk(service_id, staff_id)

bookings        id uuid pk default gen_random_uuid()
                created_at timestamptz default now()
                starts_at timestamptz, ends_at timestamptz (ends > starts)
                staff_id text fk
                service_ids text[]
                total_price numeric(8,2), price_is_from bool, total_minutes smallint
                customer_name text (1..80), customer_email text (<=120), customer_phone text (<=30),
                notes text (<=500) null
                status text check in ('confirmed','cancelled','completed','no_show') default 'confirmed'
                source text check in ('online','admin') default 'online'
                EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
                  WHERE (status = 'confirmed')     -- database-level double-booking guard

time_off        id uuid pk, staff_id text null (null = whole salon), starts_at, ends_at, reason text null

gallery_images  id uuid pk, created_at, path text unique (object path in bucket 'gallery'),
                caption text null (<=140), alt text null (<=200), sort int, published bool default true,
                width int null, height int null

admins          email text pk (lower-case)
```

Seed: settings/staff/services/service_staff exactly as `assets/booking-data.js`.
Admin allowlist seeded with the site owner's login e-mail(s).

### Row-level security

RLS on every table. `public.is_admin()` = `security definer`, `stable`,
`search_path = ''`; true when the caller is authenticated, their auth.users row
has a confirmed e-mail, and `lower(email)` is in `public.admins`.

| table | anon / authenticated non-admin | admin |
|---|---|---|
| settings, staff, services, service_staff | SELECT (active rows only for staff/services) | ALL |
| gallery_images | SELECT where published | ALL |
| bookings | **nothing** (no select/insert/update/delete) | ALL |
| time_off | nothing | ALL |
| admins | nothing | SELECT/INSERT/DELETE (cannot delete the last admin) |

Storage bucket `gallery`: public read, 10 MB limit, mime `image/jpeg,image/png,image/webp,image/avif`.
`storage.objects` INSERT/UPDATE/DELETE only when `bucket_id = 'gallery' and public.is_admin()`.
No anon SELECT/list policy.

### RPCs (all `security definer`, `set search_path = ''`, EXECUTE granted explicitly)

`busy_slots(p_from date, p_to date)` → `table(staff_id text, starts_at timestamptz, ends_at timestamptz)`
- anon + authenticated. Range capped at 62 days. Returns confirmed bookings and
  time_off (whole-salon rows expanded to every active staff). No customer data.

`create_booking(p_service_ids text[], p_staff_id text, p_date date, p_time text,
p_name text, p_email text, p_phone text, p_notes text, p_hp text)` → `jsonb`
- anon + authenticated. `p_staff_id` may be null = first available capable stylist.
- `p_time` is `'HH:MM'` local Brussels time. `p_hp` is a honeypot, must be empty.
- Validates server-side, never trusting the client: services exist, active,
  unique, 1..6 of them, no two share `grp`; stylist active and does every
  service; open day; inside open/close; no overlap with break; start on the
  slot grid; not in the past, at least lead time ahead, within horizon; no
  time_off overlap; no confirmed booking overlap; name/e-mail/phone/notes
  lengths and e-mail format; rate limit (≤ 3 future confirmed bookings per
  e-mail, ≤ 5 bookings created per e-mail in the last hour).
- Computes `total_minutes`, `total_price`, `price_is_from` from the database, not the client.
- Returns `{ ok: true, id, staff_id, staff_name, starts_at, ends_at, total_price, price_is_from, total_minutes }`
  or `{ ok: false, error: '<code>' }` with codes:
  `invalid_services`, `invalid_staff`, `closed`, `outside_hours`, `in_break`,
  `off_grid`, `too_soon`, `too_far`, `slot_taken`, `invalid_contact`, `rate_limited`, `rejected`.
  A unique/exclusion violation is caught and returned as `slot_taken`.

`admin_upsert_booking(...)` is not needed; admins write `bookings` directly
through RLS (source = 'admin'), and the exclusion constraint still guards overlaps.

## Security baseline

- Netlify `_headers`: strict CSP (`default-src 'self'`; `script-src 'self'`; `style-src 'self'`;
  `img-src 'self' data: blob: https://kvnnikyjsvhxpdftfagj.supabase.co`;
  `connect-src 'self' https://kvnnikyjsvhxpdftfagj.supabase.co wss://kvnnikyjsvhxpdftfagj.supabase.co`;
  `font-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `object-src 'none'`),
  HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (camera/mic/geolocation off), `X-Frame-Options: DENY`.
  **Therefore: no inline `<script>`, no inline `style=""` attributes, no `on*=` handlers,
  no `javascript:` URLs anywhere.** Setting `element.style.x` from JS is allowed.
- `/admin` also gets `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.
- All user-supplied text is rendered with `textContent`, never `innerHTML`.
