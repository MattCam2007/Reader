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

## Recipe for an AI agent (deterministic — follow exactly)

> Goal: add a hosted, served font named **`<Family>`** (example: `Merriweather`).
> Everything below is copy‑paste. Replace `<Family>` / `<key>` and run.

**Step 0 — naming.** Pick:
- `KEY` = lowercase, hyphenated id, e.g. `merriweather` (no spaces, must be unique).
- `FAMILY` = the CSS family name exactly as the foundry spells it, e.g. `Merriweather`.
- `PREFIX` = the family name with spaces removed, e.g. `Merriweather` → files `Merriweather-Regular.woff2`.

**Step 1 — download woff2 from Google Fonts** (works with web access; grabs the
Latin subset). Save this as `download-font.py`, set the three variables, run
`python3 download-font.py`:

```python
import urllib.request, re, os
FAMILY = "Merriweather"          # CSS family name
QUERY  = "Merriweather"          # Google Fonts name, spaces -> '+'
PREFIX = "Merriweather"          # output filename prefix
AXES   = "0,400;0,700;1,400"     # regular, bold, italic
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"
OUT = os.path.dirname(os.path.abspath(__file__))  # the fonts/ folder
def g(u): return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent":UA}), timeout=20).read()
css = g(f"https://fonts.googleapis.com/css2?family={QUERY}:ital,wght@{AXES}&display=swap").decode()
names = {400:"Regular", 600:"SemiBold", 700:"Bold"}
for m in re.finditer(r"/\*\s*([^*]+?)\s*\*/\s*@font-face\s*\{([^}]+)\}", css, re.DOTALL):
    if m.group(1).strip() != "latin": continue       # Latin subset only
    b = m.group(2)
    w = int(re.search(r"font-weight:\s*(\d+)", b).group(1))
    s = re.search(r"font-style:\s*(\w+)", b).group(1)
    url = re.search(r"url\((https://[^)]+)\)", b).group(1)
    wn = names.get(w, str(w))
    fn = f"{PREFIX}-{wn}.woff2" if s=="normal" else (f"{PREFIX}-{wn}Italic.woff2" if wn!="Regular" else f"{PREFIX}-Italic.woff2")
    open(os.path.join(OUT, fn), "wb").write(g(url))
    print("saved", fn)
```

If the font is **not on Google Fonts** but you have an `.otf`/`.ttf`, convert it:
```bash
pip install fonttools brotli
python3 -c "from fontTools.ttLib import TTFont; f=TTFont('In.otf'); f.flavor='woff2'; f.save('fonts/<Prefix>-Regular.woff2')"
```

**Step 2 — add `@font-face` blocks** to `css/tokens.css` (one per file you saved):
```css
@font-face { font-family: '<Family>'; src: url('../fonts/<Prefix>-Regular.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: '<Family>'; src: url('../fonts/<Prefix>-Italic.woff2')  format('woff2'); font-weight: 400; font-style: italic; font-display: swap; }
@font-face { font-family: '<Family>'; src: url('../fonts/<Prefix>-Bold.woff2')    format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }
```

**Step 3 — add ONE line** to the `FONT_REGISTRY` array in `js/core/fonts.js`
(anywhere inside the named block — it auto‑sorts alphabetically):
```js
{ key: '<key>', label: '<Family>', stack: '"<Family>", Georgia, serif', group: 'named' },
```
Use a `serif`, `sans-serif`, `monospace`, or `cursive` fallback that matches the
font's style.

**Step 4 — verify** (no app run needed). This must print `true` and list your font:
```bash
node --input-type=module -e "import {FONTS_ORDERED,FONT_MAP} from './js/core/fonts.js'; console.log(!!FONT_MAP['<key>']); console.log(FONTS_ORDERED.map(f=>f.label).join(', '))"
```
Also confirm every file the CSS references exists:
```bash
node -e "const fs=require('fs');const css=fs.readFileSync('css/tokens.css','utf8');for(const m of css.matchAll(/url\('\.\.\/(fonts\/[^']+)'/g)){if(!fs.existsSync(m[1]))console.log('MISSING',m[1])}console.log('checked')"
```

**Step 5 — commit** the new `fonts/*.woff2`, `css/tokens.css`, and
`js/core/fonts.js`. Done — the dropdown, live previews, and Read/Speed/Listen
modes pick it up with no other changes.

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
