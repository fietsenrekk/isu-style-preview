# KIRU — ISU-style preview

A visual-direction pitch mockup. Not a live business site.

Reproduces the page composition **and interaction model** of
[isu-antwerp.com](https://www.isu-antwerp.com/) — logo placement, the two
typefaces, the vertical left-hand nav, the centred hero, and the signature
two-column list with a rule down its centre — carrying the KIRU lockup and a
portrait from [@joruhairstudio](https://www.instagram.com/joruhairstudio/).

INTRO, PRICES and CONTACT swap in place on the homepage; MAKE A RESERVATION is
a separate page. That is exactly how the reference site behaves.

Everything was measured off the live reference (its source HTML, its
`css/style.css`, and computed styles read in the browser) rather than eyeballed.
The measurements, and the places this deliberately diverges, are documented at
the top of `assets/site.css`.

## ⚠ The contact details are Labi's, not KIRU's

The address, phone number, email, Instagram handle, opening hours and booking
link belong to **Labi** (Klapdorp 37, Antwerp) and are used here as stand-in
filler, by request. **They are live.** Anyone who taps the phone number or the
booking button reaches Labi, a different business. Replace them before this is
shown anywhere it could be mistaken for KIRU's real contact information.

## Assets

- **Logo** — the supplied KIRU lockup, lifted onto transparency. The source file
  had a white disc on a black vignette; the ink was extracted by masking to a
  radius safely inside the circle's outline and taking alpha from luminance, so
  no ring or gradient survives and it sits on the page's `#fcfcfc` with no seam.
- **Hero** — the joruhairstudio portrait, 1440×1920, EXIF stripped, served as
  WebP at 480/720/1080/1440 with a JPEG fallback.
- **Fonts** — Bebas Neue and Abel, both OFL, self-hosted WOFF2. Licences ship
  alongside them in `assets/fonts/`.
- **Zero third-party requests.** No CDN, no analytics, no cookies.

## Local preview

```
powershell -File ../serve-isu-preview.ps1
```
→ http://localhost:4219/

No build step — static HTML.

## Verifying

```
node tools/verify.mjs
VERIFY_ORIGIN=https://fietsenrekk.github.io/isu-style-preview node tools/verify.mjs
```

Loads every section at desktop and mobile, screenshots each into `.shots/`, and
checks console errors, failed requests, horizontal overflow, silently clipped
text, the mobile menu behaviour, and that the typography still matches the
values measured off the reference.
