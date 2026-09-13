# UCHI — hair, Antwerp

Two hairstylists on Klapdorp, Antwerp: Labi and Donovan.

The page composition **and interaction model** follow
[isu-antwerp.com](https://www.isu-antwerp.com/) — logo placement, the two
typefaces, the vertical left-hand nav, the centred hero, and the signature
two-column list with a rule down its centre — carrying the UCHI wordmark.

INTRO and CONTACT swap in place on the homepage; RESERVATION is a separate
page. That is exactly how the reference site behaves.

Everything was measured off the live reference (its source HTML, its
`css/style.css`, and computed styles read in the browser) rather than eyeballed.
The measurements, and the places this deliberately diverges, are documented at
the top of `assets/site.css`.

## ⚠ Before this goes live on its own domain

1. **The domain is `uchi-antwerp.be`, not `uchi.be`.** `uchi.be` was checked on
   2026-09-13 and is already registered to someone else (since 2023-09-28,
   parked at one.com, publishing a null MX so it accepts no mail at all).
   `uchi-antwerp.be` returned *domain not found* at DNS Belgium the same day —
   unregistered — and mirrors ISU's own `isu-antwerp.com`. Register it before
   anyone else does.
2. **`info@uchi-antwerp.be` does not exist until the domain does.** The contact
   section, the reservation page and the booking form all send mail there.
   Until the domain is registered and a mailbox is set up on it, **every
   booking request bounces**. That is the single thing that must happen before
   the site is announced. The address is in `index.html`, `reservation.html`
   and `assets/booking-provider.js` (`INBOX`).
3. **Pointing the domain at GitHub Pages.** Add a `CNAME` file containing
   `uchi-antwerp.be` to the `gh-pages` branch, set the DNS records GitHub
   documents for apex domains, and enable HTTPS in the repository's Pages
   settings. Do not add the `CNAME` before the DNS exists — it breaks the
   current github.io address until it resolves.
4. **The two homepage photographs are other people's.** The first came from
   @joruhairstudio's Instagram and the second from another Instagram post.
   They were fine for a preview; on a live commercial site they need the
   owners' permission, or UCHI's own photographs in their place. Both slots are
   3:4 and swap without layout changes.
5. **Still stand-in:** the address (Klapdorp 37) and Labi's Instagram
   (`labi_antwerp`) carried over from the earlier build. Confirm both.

## Contact details

| | |
|---|---|
| Phone | +32 498 80 30 33 (`tel:+32498803033`) |
| E-mail | info@uchi-antwerp.be — see above |
| Instagram | @labi_antwerp · @donovanhairdresser |

## Booking

The reservation page implements the booking itself, in the site's own
typography, rather than embedding a third-party widget. Four choices —
stylist, services, day, time — then a details form. Services are a set, not
one item: a cut and a colour and a wash are one visit, while two colour
processes are not, which is what the `group` field on each service expresses.

**Why not the widget ISU uses.** ISU's reservation page is a single iframe
pointing at **onlineafspraken.nl**. It does embed cross-origin
(`x-frame-options: ALLOWALL`), so that is not the obstacle. The obstacle is the
`key` in their URL: it names *ISU's own diary*. Embedding it here would send
UCHI's customers into a competitor's calendar.

**What it would take to take real bookings.** An onlineafspraken.nl account on
the **Groei** tier — €32,50/month billed annually, €40,00 monthly, 2–10
resources, 14-day free trial, no free tier. That tier lists *"widgets per
resource"*, which is exactly the Labi/Donovan split. Once the key exists,
`assets/booking-provider.js` is the only file that changes; the full URL
format, the seven colour slots and the two traps in them are decoded in that
file's header.

Their REST API exists but is the wrong tool here: Pro tier only (€65/month) and
its request signature needs the account secret at call time, which on a static
site means publishing the salon's diary credentials to every visitor.

**Until then**, the form composes a complete appointment request — services,
prices, duration, stylist, date, time, contact details — and hands it to the
salon by e-mail. The button says *request* and the confirmation says the salon
confirms, because until a person or a real diary answers, that is what has
happened.

## Staff and the price list

Eight services. Donovan does all of them; Labi does the three that need no
colour — the cut, the wash and the blow-dry. Both are titled Hairstylist:
what separates them is the service list, not the title. The four colour
processes (highlights, balayage, roots, colour) are alternatives to one
another, so only one can be in a booking; the toner sits on top of any of them.

The list is genderless, by instruction. There is one cutting entry, from 35,
priced by the length of the hair and the work it takes rather than by who is
in the chair. `booking-test.mjs` greps every shipped file for gendered wording,
and `verify.mjs` checks the rendered page including `title` and `aria-label`
attributes, where such a word could hide without being visible.

## Data

`assets/booking-data.js` is the single source of truth for hours, staff and
prices. The contact section's hours table, the reservation page's service list
and the slot calculator all read from it, so they cannot drift apart.

Three values in it are **assumptions, not supplied facts**, and are flagged as
such in the file: the exact hour of the one-hour afternoon break (14:00–15:00),
the per-service durations, and the 60-minute same-day lead time. Where a
price is a floor, the duration is set for the longer end of what that floor
covers — under-booking a chair overruns into the next client, over-booking it
only leaves the stylist a gap.

## Assets

- **Logo** — UCHI set in Helvetica Bold, 648×183. The letters are rendered
  from the font file one glyph at a time so the approved letter spacing, rule
  gap, rule thickness and rule length (measured off the earlier artwork as
  multiples of the cap height) are kept exactly; only the typeface changed.
  Transparent, cropped to the ink with a 2% margin; WebP keeps the alpha
  (`yuva420p`). The reveal covers sit on its two
  ink bands, measured off the shipped file.
- **Favicon** — the wordmark centred on `#fcfcfc`, composited in Node so the
  paper is exact.
- **Hero** — two portraits that cross-fade on tap, both 1440×1920, EXIF
  stripped, WebP at 480/720/1080/1440 with a JPEG fallback. See the
  photograph-rights note above.
- **Fonts** — Bebas Neue and Abel, both OFL, self-hosted WOFF2. Licences ship
  alongside them in `assets/fonts/`.
- **Zero third-party requests.** No CDN, no analytics, no cookies, on either
  page. That stops being true the moment a planner widget is embedded.

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

`booking-test.mjs` covers the slot calculator, the service combinations and the
price list in Node, with no browser. It also greps every shipped file for
gendered wording and for anything retired — earlier brand names, the old phone
number and inbox, the preview marker, the robots exclusion tag — and fails if
any reappears.
The slot maths is the one part of this site that can be quietly wrong — it
always renders *a* list of times, and a list of times looks correct no matter
which ones are missing — so the expected counts were worked out by hand before
the code was run.

`verify.mjs` drives a real headless Chrome and clicks the site the way a
visitor would: swaps the hero photograph, walks the entire booking flow, checks
the Labi/Donovan exclusion in both directions in the live DOM, that no offered
time overruns the break or closing, that the published hours equal the bookable
hours, that the contact links are the final ones, that nothing on the page sits
on top of anything else, and that the page still states its prices and hours
with JavaScript disabled. Add `VERIFY_SHOTS=.shots` to capture screenshots.

`motion-check.mjs` samples transforms over time to prove the reveal and the
page transition actually animate rather than jumping — something a screenshot
cannot show.

```
VERIFY_ORIGIN=https://fietsenrekk.github.io/isu-style-preview node tools/verify.mjs
```
runs the same suite against the deployed URL.
