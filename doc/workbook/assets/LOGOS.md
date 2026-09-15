# Dropping the real JBS Praxis logos in

The workbook ships with a **fallback wordmark** (a teal/white "JBS" drawn in CSS) so it
renders correctly with no assets. To use the real logo images, do this once.

## The one step

Open `doc/workbook/src/brand.mjs`. Near the top you will find:

```js
export const LOGO_CSS_SLOT = `
/* ---- PASTE THE TWO REAL LOGO RULES HERE ---- */
...fallback wordmark rules...
`;
```

Replace **everything between the backticks** with the two rules from the Fidson
FieldForce Milestone Bible — the ones that look like:

```css
.logo-full{background-image:url('data:image/png;base64,iVBORw0KG...');}
.logo-grey{background-image:url('data:image/png;base64,iVBORw0KG...');}
```

Copy them verbatim out of the source document (search it for `.logo-full{`). Both are
single long lines. Keep them on one line each; do not reformat or line-wrap the base64.

Then rebuild:

```bash
node doc/workbook/build.mjs
```

## What each one is for

| Rule | Used on | Where |
|---|---|---|
| `.logo-full` | Light pages | Page header, top-left, `22px × 17px` |
| `.logo-grey` | Dark pages | Cover, and the fixed toolbar |

Both are applied through the shared `.lg` class, which supplies
`background-size:contain; background-repeat:no-repeat; background-position:center`.
Sizing is done per-usage, so the same image works at 20px in the toolbar and 36px on
the cover.

## Why they are not committed here

The two base64 payloads are roughly 13 KB each. They are pure presentation, they belong
to the brand kit rather than this repo, and holding them out keeps `brand.mjs` reviewable
in a normal diff. The workbook is fully usable without them.

## Prefer real files?

If you would rather ship `.png` files than base64, drop them in this directory and set
the slot to:

```css
.logo-full{background-image:url('assets/jbs-praxis-dark.png');}
.logo-grey{background-image:url('assets/jbs-praxis-light.png');}
```

Note the trade-off: the built HTML then stops being a **single portable file**, and the
PDF export needs the images served over HTTP (`html2canvas` respects CORS, and
`file://` will silently render them blank). Base64 is the reason the Bible is one file
you can email. Use files only if you are serving the workbook from a web server.
