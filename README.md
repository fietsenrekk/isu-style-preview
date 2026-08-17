# Labi — ISU-style preview

A visual-direction pitch mockup, not the production Labi site.

Reproduces the exact page composition of isu-antwerp.com's homepage — logo
placement, the two typefaces, the vertical left-hand nav, the centred hero
frame at ISU's own measured proportions — with Labi's own wordmark and a
real Labi photograph standing in for ISU's content.

Everything was measured directly off the live ISU site (font-family,
font-size, colour, bounding boxes) rather than eyeballed; see the comment
block at the top of `index.html` for specifics.

## What's real, what's a placeholder

- **Logo**: Labi's own traced wordmark, rendered in black.
- **Photo**: a real Labi shop photo, cropped to ISU's measured embed ratio.
- **Nav links**: inert (`href="#"`, `tabindex="-1"` when hidden) — this ships
  to demonstrate the visual direction, not as a working site. The mobile
  menu toggle is the one real interaction, since it costs nothing to wire up
  honestly.
- **Fonts**: Bebas Neue + Abel, both OFL-licensed, self-hosted as WOFF2. No
  third-party requests.

## Local preview

```
powershell -File ../serve-isu-preview.ps1
```
→ http://localhost:4219/

No build step — it's one static HTML file.
