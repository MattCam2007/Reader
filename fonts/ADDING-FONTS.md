# Adding & removing fonts

The font list is driven by a single registry — **`js/core/fonts.js`**. Each entry
controls one item in the Typeface dropdown (Read / Speed / Listen tabs and the
reader quick‑drawer). The menu always shows **Serif → Sans → Mono → separator →
all named fonts A–Z**; the alphabetical sort is automatic, so you can add an
entry anywhere in the array.

There are two kinds of font:

| Kind | Bundled woff2? | When to use |
|------|----------------|-------------|
| **Hosted** | Yes — file in `/fonts/`, `@font-face` in `css/tokens.css` | Open‑licensed fonts we ship to every client |
| **System** (`system: true`) | No | Proprietary fonts (Arial, Georgia…) — uses the reader's installed copy, falls back to a generic |

---

## How to add a HOSTED font (3 steps)

1. **Drop the woff2 file(s) into `/fonts/`.** Regular + Bold at minimum; add
   Italic if you have it. Name them `FamilyName-Regular.woff2`, `-Bold.woff2`,
   `-Italic.woff2`.

2. **Declare the faces in `css/tokens.css`** (alongside the existing
   `@font-face` blocks):

   ```css
   @font-face { font-family: 'Charter'; src: url('../fonts/Charter-Regular.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
   @font-face { font-family: 'Charter'; src: url('../fonts/Charter-Italic.woff2')  format('woff2'); font-weight: 400; font-style: italic; font-display: swap; }
   @font-face { font-family: 'Charter'; src: url('../fonts/Charter-Bold.woff2')    format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }
   ```

3. **Add one line to `FONT_REGISTRY` in `js/core/fonts.js`:**

   ```js
   { key: 'charter', label: 'Charter', stack: '"Charter", Georgia, serif', group: 'named' },
   ```

   - `key` — stable id saved in prefs (lowercase, hyphenated). Don't reuse one.
   - `label` — what the menu shows (and how it sorts).
   - `stack` — must start with the **exact** `font-family` name from step 2,
     then fallbacks.

That's it — the dropdown, previews, and all three reading modes pick it up.

## How to add a SYSTEM font (1 step)

No file, no `@font-face` — just a registry entry with `system: true`:

```js
{ key: 'baskerville', label: 'Baskerville', stack: 'Baskerville, "Baskerville Old Face", Georgia, serif', group: 'named', system: true },
```

## How to remove a font

Delete its line from `FONT_REGISTRY`. (Optionally also delete the `@font-face`
block and the woff2 files.) Anyone whose saved preference pointed at it falls
back to **Serif** automatically.

---

## Fonts you can add yourself (free, but not auto‑downloadable here)

These are openly licensed and great for reading, but the mirrors that host them
(CTAN, jsdelivr, Fontsource CDN) are blocked by the build sandbox's network, so
they couldn't be fetched automatically. Download them and follow the 3 steps
above.

### Charter  ·  *recommended*
Bitstream Charter, released free by Matthew Butterick — a superb screen serif.

- **License:** free (Bitstream license, redistribution allowed)
- **Get it:** <https://practicaltypography.com/charter.html> (download includes
  `.woff2` files), or XCharter on CTAN: <https://ctan.org/pkg/xcharter>
- **Files to save:** `Charter-Regular.woff2`, `Charter-Bold.woff2`, `Charter-Italic.woff2`
- **Registry line:** `{ key: 'charter', label: 'Charter', stack: '"Charter", Georgia, serif', group: 'named' },`

### Droid Serif
The original Android reading serif (Apache 2.0). Note **Noto Serif** (already
bundled) is its official successor, so this is optional.

- **License:** Apache 2.0
- **Get it:** <https://www.fontsquirrel.com/fonts/droid-serif> (webfont kit has woff2)
- **Files to save:** `DroidSerif-Regular.woff2`, `DroidSerif-Bold.woff2`, `DroidSerif-Italic.woff2`
- **Registry line:** `{ key: 'droid-serif', label: 'Droid Serif', stack: '"Droid Serif", Georgia, serif', group: 'named' },`

---

## For reference: requested fonts that can't be self‑hosted

Proprietary — owned by Amazon / Apple / Kobo / Monotype / Linotype, no web
self‑hosting license. Not in the app (some are reachable via the **System
fonts** above if the reader's device has them):

> Bookerly · Amazon Ember · Caecilia · Caecilia Condensed · Kobo Nickel ·
> Kobo Tsukushi A/B Round Gothic · Amasis · Malabar · Athelas ·
> Iowan Old Style *(already in the default Serif fallback)*

If you ever want served look‑alikes instead of the system entries, these free
metric‑compatible clones drop in via the 3 steps above:
**Arimo** (Arial/Helvetica) · **Tinos** (Times New Roman) ·
**TeX Gyre Pagella** (Palatino) — all on Google Fonts.
