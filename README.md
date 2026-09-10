# JILL SCUTT — ISU-style preview

A visual-direction pitch mockup. Not a live business site.

Reproduces the page composition **and interaction model** of
[isu-antwerp.com](https://www.isu-antwerp.com/) — logo placement, the two
typefaces, the vertical left-hand nav, the centred hero, and the signature
two-column list with a rule down its centre — carrying the JILL SCUTT wordmark.

INTRO and CONTACT swap in place on the homepage; RESERVATION is a separate
page. That is exactly how the reference site behaves.

Everything was measured off the live reference (its source HTML, its
`css/style.css`, and computed styles read in the browser) rather than eyeballed.
The measurements, and the places this deliberately diverges, are documented at
the top of `assets/site.css`.

## ⚠ The contact details are Labi's, not JILL SCUTT's

The address, phone number, email, Instagram handle and the inbox the booking
form writes to belong to **Labi** (Klapdorp 37, Antwerp) and are used here as
stand-in filler, by request. **They are live.** Anyone who taps the phone
number or sends a booking request reaches Labi. Replace them before this is
shown anywhere it could be mistaken for real contact information.

## Booking

The reservation page implements the booking itself, in the site's own
typography, rather than embedding a third-party widget. Four choices —
stylist, services, day, time — then a details form. Services are a set, not
one item: a cut and a colour and a wash are one visit, while two ways of
pricing the same cut are not, which is what the `group` field on each service
expresses.

**Why not the widget ISU uses.** ISU's reservation page is a single iframe
pointing at **onlineafspraken.nl**. It does embed cross-origin
(`x-frame-options: ALLOWALL`), so that is not the obstacle. The obstacle is the
`key` in their URL: it names *ISU's own diary*. Embedding it here would send
this salon's customers into a competitor's calendar. That is not a styling
problem and restyling the colours does not fix it.

**What it would take to go live.** An onlineafspraken.nl account on the
**Groei** tier — €32,50/month billed annually, €40,00 monthly, 2–10 resources,
14-day free trial, no free tier. That tier lists *"widgets per resource"*,
which is exactly the Labi/Donovan split: their platform scopes staff lists per
appointment-type group, so a stylist who does not perform a service simply does
not appear in that service's picker. ISU's own live widget shows this — two
pickers, *"Cut or blowdry by"* and *"Color by"*, with different staff in each.
Once the key exists, `assets/booking-provider.js` is the only file that
changes; the full URL format, the seven colour slots and the two traps in them
are decoded in that file's header.

Their REST API exists but is the wrong tool here: Pro tier only (€65/month) and
its request signature needs the account secret at call time, which on a static
site means publishing the salon's diary credentials to every visitor.

**Until then**, the form composes a complete appointment request — service,
price, duration, stylist, date, time, contact details — and hands it to the
salon by e-mail. The button says *request* and the confirmation says the salon
confirms, because until a person or a real diary answers, that is what has
happened.

## The price list is genderless

By instruction. There is one cutting entry, from 35, priced by the length of
the hair and the work it takes rather than by who is in the chair. No label,
no Dutch `nl` string, no fallback row and no line of copy may reintroduce the
split — `booking-test.mjs` greps every shipped file for gendered wording, and
`verify.mjs` checks the rendered page including `title` and `aria-label`
attributes, where such a word could hide without being visible.

## Data

`assets/booking-data.js` is the single source of truth for hours, staff and
prices. The contact section's hours table, the reservation page's service list
and the slot calculator all read from it, so they cannot drift apart.

Three values in it are **assumptions, not supplied facts**, and are flagged as
such in the file: the exact hour of the one-hour afternoon break (14:00–15:00),
the per-service durations (including the 45 minutes now reserved for a cut,
which replaced two entries carrying 30 and 45), and the 60-minute same-day
lead time.

## Assets

- **Logo** — the supplied JILL SCUTT wordmark, 782×86, lifted onto
  transparency. Alpha comes from inverted luminance with a white-point
  correction, so the letterforms keep their antialiasing and the margins are
  alpha 0 exactly — the source screenshot carried faint banding rows that a
  straight inversion left as a grey veil.
- **Hero** — two portraits that cross-fade on tap, both 1440×1920, EXIF
  stripped, WebP at 480/720/1080/1440 with a JPEG fallback. The second was
  tone-matched to the first by transferring the first's per-luminance colour
  offsets, so the fade carries no colour shift.
- **Fonts** — Bebas Neue and Abel, both OFL, self-hosted WOFF2. Licences ship
  alongside them in `assets/fonts/`.
- **Zero third-party requests.** No CDN, no analytics, no cookies, on either
  page. This is true again now the Setmore iframe is gone, and stops being true
  the moment a planner widget is embedded.

## Local preview

```
powershell -File ../serve-isu-preview.ps1
```
→ http://localhost:4219/

No build step — static HTML.

## Verifying

```
node tools/booking-test.mjs
node tools/verify.mjs
node tools/motion-check.mjs
```

`booking-test.mjs` is 127 unit tests over the slot calculator, the service
combinations and the price list, in Node, with no browser. It also greps every
shipped file for gendered wording and fails if any reappears. The slot maths is the one part of this site
that can be quietly wrong — it always renders *a* list of times, and a list of
times looks correct no matter which ones are missing — so the expected counts
were worked out by hand before the code was run.

`verify.mjs` drives a real headless Chrome and clicks the site the way a
visitor would: swaps the hero photograph, walks the entire booking flow, and
checks the Labi/Donovan exclusion holds in both directions in the live DOM,
that no offered time overruns the break or closing, that the published hours
equal the bookable hours, and that the page still states its prices and hours
with JavaScript disabled. Add `VERIFY_SHOTS=.shots` to capture screenshots.

`motion-check.mjs` samples transforms over time to prove the reveal and the
page transition actually animate rather than jumping — something a screenshot
cannot show.

```
VERIFY_ORIGIN=https://fietsenrekk.github.io/isu-style-preview node tools/verify.mjs
```
runs the same suite against the deployed URL.
