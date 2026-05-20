# EPUB Reader — Upgrade Plan (`upgrades.md`)

Detailed, build‑ready plans for the next round of features on `reader.html`
(the paginated reader). Each feature is scoped as an **isolated unit of work**:
one branch, one PR, one setting (where it changes UX), independently
mergeable and revertible.

> Scope of this document: features **#5, #6, #7, #8, #11, #12** (content
> fidelity + selection/search — handled together because they share one
> foundation) and **#15, #16, #17, #18, #19, #20, #23** (typography, layout,
> navigation, animation). Numbers refer to the 25‑item recommendation list.

---

## 1. Baseline (what exists today)

`reader.html` is a single self‑contained file (epub.js + JSZip from CDN).

| Concern | Current implementation | Key symbols |
| --- | --- | --- |
| Extraction | Leaf‑block heuristic, **plain text only** (`el.textContent`) | `blocksFromDoc()`, `renderBook()` |
| Model | `[{type,text,id}]` per section; sections wrapped in `.chap`, indexed by href base | `sectionEls` Map |
| Pagination | CSS multicolumn; `total = scrollWidth / stride`; translateX | `paginate()`, `goTo()` |
| Position | Element‑x → page | `pageOfElement()` |
| Persistence | **Fraction** `f = page/(total-1)`, keyed by **title** | `savePos()` / `restorePos()` |
| TOC | epub nav or headings fallback; href→element | `buildTOC()`, `resolveHref()` |
| Settings | `{theme,font,size}` in `reader:prefs` | `applyPrefs()` |
| Input | drag/swipe + tap zones + keyboard | `handleTap()`, touch handlers |

### Ecosystem context (important)
- `library.html` is a bookshelf that links to `reader.html?src=<path>&id=<id>&title=<title>`
  and to `index.html` (the **RSVP speed reader**) with the **same params**.
- **Neither `reader.html` nor `index.html` parses those params yet**, and there
  is no `books/` directory — the library list is demo data.
- Persistence is **inconsistent**: the reader writes `reader:pos:<title>` but the
  library reads `reader:pos:<id>`. This must be reconciled.

### The cross‑cutting requirement
The user wants to **switch between the paginated reader and the speed reader
at the exact word**. That demands a **shared, layout‑independent, word‑level
locator** that both `reader.html` and `index.html` produce and consume. This is
the "obvious reason" #5/#6/#7/#8/#11/#12 are grouped: they all sit on a richer
content model with stable word addressing.

---

## 2. Guiding principles & conventions

1. **One unit = one branch = one PR.** Branch from fresh `master`
   (`git fetch origin master && git pull`), name `claude/<unit-id>`.
2. **Single file, no build step.** Anything that needs a binary asset
   (fonts) is self‑hosted/bundled, never CDN‑only, so offline still works.
3. **Every UX‑changing behavior is behind a setting**, persisted in
   `reader:prefs`, with a sensible default. #23 explicitly ships with a
   disable switch.
4. **Backward‑compatible storage.** Add a `prefs.v` schema version; migrate
   old values; never break an existing reader. New position key is additive.
5. **Accessibility:** respect `prefers-reduced-motion` and
   `prefers-color-scheme`; keep ARIA on drawers; trap focus in sheets.
6. **Performance‑aware:** prefer the Range API for word measurement over
   wrapping every word in a `<span>` (a novel is 100k+ words).
7. **No headless browser in CI/this environment** → each unit ships a
   **manual test checklist**; optionally a tiny in‑page `?selftest=1` harness.

### Storage schema (target)
| Key | Owner | Meaning |
| --- | --- | --- |
| `reader:prefs` | reader | `{v, theme, font, weight, size, lineHeight, margin, paraSpacing, align, hyphens, brightness, warmth, layout, columns, pageAnim}` |
| `reader:loc:<bookId>` | reader **and** speed reader | **Portable word locator** (see Unit F) — the shared resume point |
| `reader:pos:<bookId>` | legacy | fraction; kept for migration + library back‑compat |
| `reader:bm:<bookId>` | reader | bookmarks/highlights (later units) |

`bookId` resolution order (Unit F): URL `?id` → EPUB metadata title → filename.

### Work‑unit template
Each unit below uses: **Goal · Depends on · Isolation · Design · Data/Persistence ·
Steps · Settings UI · Acceptance · Manual tests · Risks · Effort (S/M/L)**.

---

## 3. Dependency graph & suggested order

```
            ┌────────────────────────────┐
            │  Unit F  Foundation:        │
            │  content model + word       │
            │  locator + bookId/source    │
            └──────────────┬─────────────┘
                           │ (required by the content/search group)
   ┌──────────┬──────────┬─┴────────┬──────────┬──────────┐
   ▼          ▼          ▼          ▼          ▼          ▼
 U6 inline  U5 images  U8 tables  U7 notes   U11 select  U12 search
 (rich DOM) (needs U6) (needs U6) (needs U6) (needs F)   (needs F)

Independent track (no Foundation dependency) — can land anytime:
 U15 spacing · U16 align/hyphen · U17 fonts · U18 brightness/OLED
 U20 chapter-title · U23 page-turn-anim
 U19 layout-modes (largest; light dependency on Unit F for scroll-mode locator)
```

**Recommended sequence:** F → U6 → (U5, U8, U7 in any order) → U11 → U12.
Run the independent track in parallel; do **U19 last** (it touches pagination).

---

# 4. Units of work

## Unit F — Foundation: structured content model + word locator
**Feature ref:** prerequisite for #5/#6/#7/#8/#11/#12 and the future
reader↔speed‑reader switch.

**Goal.** Introduce a canonical, layout‑independent **document model** with a
**word‑level locator** that both views share, plus a **book‑source/bookId**
abstraction. Ships value on its own by making resume word‑exact and fixing the
library/reader key mismatch.

**Depends on:** nothing.

**Isolation.** Branch `claude/uF-content-model`. Files: `reader.html` only.
No new setting. Pure infrastructure + a persistence upgrade (additive key).

**Design.**
- After `renderBook()`, build a model by walking the live `.content` DOM:
  ```js
  // doc.words[i] = { node: Text, start, end, block, section }  // node-relative offsets
  // doc.blocks[b] = { el, type, section, wordStart, wordEnd }
  // doc.sections[s] = { href, el, wordStart, wordEnd }
  // doc.text = full concatenated string; doc.wordCharStart[i] = offset into doc.text
  function buildDocModel() { /* walk block elements' Text nodes, split on \s+ */ }
  ```
  Walking **Text nodes** (not pre‑wrapped spans) keeps the DOM light and works
  whether the block is plain text (today) or rich inline HTML (after U6).
- **Locator** — store the *portable* form so it survives re‑extraction/font
  changes and transfers between views:
  ```js
  // portable: { s: sectionIndex, b: blockInSection, w: wordInBlock }
  // runtime:  integer index into doc.words
  toLocator(globalWordIndex) -> portable
  resolveLocator(portable)   -> globalWordIndex   // clamped, tolerant
  ```
- **Geometry via Range** (no per‑word spans):
  ```js
  wordRange(i)        // Range over doc.words[i]
  pageOfWord(i)       // wordRange(i).getBoundingClientRect().left → page
  wordAtPageStart(p)  // BINARY SEARCH over word index using pageOfWord (~17 measures for 120k words)
  currentLocator()    // toLocator(wordAtPageStart(page))
  goToLocator(loc)    // goTo(pageOfWord(resolveLocator(loc)))
  ```
- **Speed‑reader bridge (future‑facing API, no UI yet):**
  ```js
  exportTokens()      // [{text, kind:'word'|'break'}] aligned to doc.words
                      // index.html will import this + a locator to seek
  ```
- **bookId + source abstraction:**
  ```js
  const q = new URLSearchParams(location.search);
  bookId = q.get('id') || metaTitle || file.name;     // canonical
  // source: file input (now) | fetch(q.get('src')) (library) | IndexedDB (future)
  ```

**Data/Persistence.**
- `savePos()` writes `reader:loc:<bookId>` = `currentLocator()` **and** keeps
  `reader:pos:<bookId>` (fraction) for the library and fallback.
- `restorePos()` prefers `reader:loc`, falls back to `reader:pos` fraction.
- Add `prefs.v = 1`; migrate any title‑keyed positions opportunistically.

**Steps.**
1. Implement `buildDocModel()`; call it at the end of `paginate()` first run
   and after re‑extraction (font/size re‑paginate does **not** rebuild model,
   only re‑measures geometry).
2. Implement Range geometry + binary search; unit‑exercise with `?selftest=1`.
3. Swap `savePos/restorePos` to locator; keep fraction write.
4. Add `bookId` resolution from URL; wire `?src` fetch path (guarded; library
   handoff becomes functional).
5. Add `exportTokens()` (dormant) and document the contract for `index.html`.

**Acceptance.**
- Resume lands on the **same word** after changing text size or rotating.
- `reader.html?id=X` persists/reads under `X` (matches library).
- Opening via `?src=<url>` loads that EPUB (when served with the file present).
- `exportTokens().length === doc.words.length`.

**Manual tests.** Load sample → page 10 → bump font → reopen → same sentence at
top. Rotate device → same. Append `?id=test` → progress isolated.

**Risks.** Binary‑search geometry assumes monotonic x by word order (true for
LTR multicolumn). Mitigate RTL later. Range over collapsed whitespace: skip
zero‑width words. **Effort: L.**

---

## Unit U6 — Inline formatting fidelity  *(Feature #6)*
**Goal.** Stop flattening to `textContent`; preserve italic/bold/links/sup/sub/
small‑caps so the page reads like the real book.

**Depends on:** Unit F (tokenizer already walks Text nodes, so it keeps working
unchanged once the DOM gains inline elements).

**Isolation.** Branch `claude/u6-inline-formatting`. File: `reader.html`.
Setting: none (pure fidelity), but guarded by a constant `RICH_INLINE=true` for
easy rollback.

**Design.**
- Replace plain‑text block creation with a **sanitizing inline clone**: keep a
  whitelist of inline tags `[b,strong,i,em,u,sup,sub,small,a,span,br,code]`
  plus block tags already handled; **drop everything else**, copy only safe
  attributes (`id`, and for `a`: `href`). Build via `document.createElement`
  to avoid importing foreign‑doc quirks; never use `innerHTML` from the EPUB.
- Update `blocksFromDoc()` to return, per block, a sanitized **DOM fragment**
  instead of a string; `renderBook()` appends the fragment.
- Keep the leaf‑block detection; inline nodes are not blocks so leaf logic is
  unaffected.

**Data/Persistence.** None (model rebuild handled by F).

**Steps.** 1) Write `sanitizeInline(srcNode) → DocumentFragment`. 2) Swap block
construction. 3) Add minimal CSS for `em/i`, `strong/b`, `sup/sub`, `code`,
links (non‑actionable styling here; link behavior is U7). 4) Re‑run
`buildDocModel()`.

**Acceptance.** Italics/bold render; no script/style leaks; tokenizer word count
stable vs plain‑text baseline (±whitespace).

**Manual tests.** Load a book with heavy emphasis; verify no raw tags, no layout
breakage, selection still works.

**Risks.** Malformed EPUB markup → rely on browser parser + whitelist.
Sanitization must be strict (XSS). **Effort: M.**

---

## Unit U5 — Images & figures  *(Feature #5)*
**Goal.** Render illustrations/maps/figures (currently stripped via `SKIP_SEL`).

**Depends on:** Unit U6 (shares the rich extractor).

**Isolation.** Branch `claude/u5-images`. File: `reader.html`. Setting:
`prefs.images` (on/off) in Display sheet (some readers want text‑only).

**Design.**
- Stop skipping `img`/`figure`/`figcaption`. Resolve `img@src` (relative to the
  section href) to a **blob URL** through epub.js (`book.archive`/resources);
  set `<img>` `src` to the blob.
- Treat figures as blocks: `max-width:100%`, `max-height:<column height>`,
  `object-fit:contain`, `break-inside:avoid`. Caption = its own block.
- **Lifecycle:** track created blob URLs; `URL.revokeObjectURL` on book change /
  `book.destroy`.
- Tokenizer: images contribute **no words**; locator stays word‑based (image
  sits between the words around it).

**Acceptance.** Images appear, fit the column, never overflow a page; toggling
`prefs.images` off restores text‑only and re‑paginates; no blob‑URL leaks.

**Risks.** Oversized images breaking column height → hard `max-height`. Many
images → memory; revoke aggressively. **Effort: M.**

---

## Unit U8 — Tables  *(Feature #8)*
**Goal.** Render `<table>` as tables instead of flattening to paragraphs.

**Depends on:** Unit U6.

**Isolation.** Branch `claude/u8-tables`. File: `reader.html`. Setting: none.

**Design.**
- Whitelist `table/thead/tbody/tr/th/td/caption`; wrap each table in a
  fixed‑width scroll container (`overflow-x:auto`) so wide tables scroll
  horizontally inside one page; cap height and allow internal scroll or a
  column break for tall tables.
- Tokenizer: read cell text **row‑major** with a separator so the word stream
  (and speed reader) get a sane reading order.

**Acceptance.** Simple and wide tables render and are readable/scrollable; no
horizontal blow‑out of the page; word stream includes cell text in order.

**Risks.** Huge tables vs pagination → scroll container + max‑height.
Reading order for complex/merged cells is best‑effort. **Effort: M.**

---

## Unit U7 — Footnotes / endnotes popovers  *(Feature #7)*
**Goal.** Tapping a note reference shows the note in a dismissible popover
instead of jumping away.

**Depends on:** Unit U6 (links/ids preserved).

**Isolation.** Branch `claude/u7-footnotes`. File: `reader.html`. Setting:
`prefs.notePopovers` (on/off; off = jump behavior).

**Design.**
- Detect note refs: `<a href="#id">` (and `epub:type="noteref"`); resolve target
  via `resolveHref()` / `getElementById` against the model.
- On tap of a ref (intercept before page‑turn gesture), render a popover near
  the tap with the **target block's content**; "Go to note" as fallback;
  backdrop/tap/Esc to close.
- Gesture arbitration: a tap whose target is a noteref must not page‑turn.

**Acceptance.** Note popover shows correct text; closes cleanly; normal links to
other chapters still navigate (via history — see U?); page turns unaffected
elsewhere.

**Risks.** Note location varies (inline vs back‑matter). Endnotes far away →
resolve by id anywhere in `doc`. **Effort: M.**

---

## Unit U11 — Text selection + actions  *(Feature #11)*
**Goal.** Allow selecting text and acting on it: Copy, Define, Translate,
Search‑in‑book, (Highlight hook for the future).

**Depends on:** Unit F (map selection Range → start/end **locators**).

**Isolation.** Branch `claude/u11-selection`. File: `reader.html`. Setting:
`prefs.selection` (on/off; off keeps the current gesture‑pure reading).

**Design.**
- Scope `user-select` to `.content` (today `body` has `user-select:none`,
  `reader.html:55`).
- On `selectionchange`/long‑press end with a non‑empty selection, show a
  floating action bar: **Copy**, **Define** (open dictionary), **Translate**,
  **Search in book** (hands the string to U12), **Highlight** (persists a
  locator range to `reader:bm:<bookId>`; rendering of highlights can be a
  follow‑up).
- **Gesture arbitration (critical):** when a selection exists or a long‑press is
  in progress, suppress tap‑to‑turn/swipe (`reader.html` `handleTap`/touch
  handlers gate on `window.getSelection().isCollapsed`).
- Map selection endpoints to locators via F for portable, view‑independent
  anchoring (enables future cross‑view highlight + the speed reader honoring
  highlights).

**Acceptance.** Long‑press selects; action bar appears; Copy works; gestures
don't fight selection; turning `prefs.selection` off restores pure gestures.

**Risks.** Mobile selection vs swipe is the classic conflict — needs careful
state machine and testing on real touch. Define/Translate availability differs
by platform (use links/`window.open`). **Effort: M.**

---

## Unit U12 — In‑book full‑text search  *(Feature #12)*
**Goal.** Search the whole book, list results with snippets, jump to any hit,
highlight hits on the page.

**Depends on:** Unit F (uses `doc.text` + `wordCharStart` to map char offset →
word → locator).

**Isolation.** Branch `claude/u12-search`. File: `reader.html`. Setting: none
(a search panel + a toolbar entry).

**Design.**
- Index = `doc.text` (already concatenated by F). Query (case/diacritic‑insensitive,
  optional whole‑word) → list of `{charOffset}` → nearest word → **locator** +
  snippet (±N chars).
- Results panel (reuse drawer/sheet pattern); tap result → `goToLocator()`.
- Highlight hits on the **current page** using the **CSS Custom Highlight API**
  (no DOM mutation) with a span‑injection fallback for older engines.
- Add a Search entry to the bottom toolbar or a magnifier in the header.

**Acceptance.** Query returns correct hits with snippets; jumping lands with the
hit on‑screen; highlights clear on new search; large books stay responsive
(search is O(n) over text, fine).

**Risks.** Highlight API support → fallback path. Snippet boundaries across
block joins → use `doc.text` offsets, not per‑block. **Effort: M.**

---

## Unit U15 — Spacing controls (line / margin / paragraph)  *(Feature #15)*
**Goal.** Reader‑adjustable line height, side margins, and paragraph spacing
style (indent vs spaced).

**Depends on:** none.

**Isolation.** Branch `claude/u15-spacing`. File: `reader.html`. Settings:
`prefs.lineHeight`, `prefs.margin`, `prefs.paraSpacing`.

**Design.** Drive everything with CSS variables on `.content`/`.viewport`:
`--reading-line-height`, `--reading-margin` (maps to `.viewport` side padding,
which feeds `colW`), `--reading-para` (toggles `text-indent` vs `margin-bottom`).
Each change calls `paginate(true)` to preserve the fraction/locator.

**Settings UI.** Three rows in the Display sheet: line spacing (−/value/+),
margin (Narrow/Normal/Wide seg), paragraph (Indented/Spaced seg).

**Acceptance.** Each control visibly changes layout, persists, and re‑paginates
keeping position; defaults match today's look.

**Risks.** Margin changes `colW`, so re‑paginate must run (it does via F).
**Effort: S.**

---

## Unit U16 — Alignment & hyphenation toggle  *(Feature #16)*
**Goal.** Justify ↔ left‑align and hyphenation on/off (justify+hyphens can
"river" on narrow screens).

**Depends on:** none.

**Isolation.** Branch `claude/u16-align`. File: `reader.html`. Settings:
`prefs.align` (`justify`|`left`), `prefs.hyphens` (bool).

**Design.** Toggle `.content { text-align; hyphens }` (today hard‑set at
`reader.html:84-86`). Re‑paginate on change.

**Settings UI.** Two segs in Display sheet.

**Acceptance.** Toggling changes alignment/hyphenation, persists, re‑paginates.
**Effort: S.**

---

## Unit U17 — Fonts & weight (incl. OpenDyslexic)  *(Feature #17)*
**Goal.** More typefaces — add at least one humanist serif, a clean sans, and a
**dyslexia‑friendly** face — plus a font‑weight option.

**Depends on:** none.

**Isolation.** Branch `claude/u17-fonts`. Files: `reader.html` (+ optional
`fonts/` if not base64‑embedding). Settings: `prefs.font`, `prefs.weight`.

**Design.**
- Keep system serif/sans; **bundle OpenDyslexic** as a self‑hosted `@font-face`
  (woff2). To preserve the single‑file ethos, prefer base64‑embedding the woff2
  in the `<style>` (note: ~adds file size) — or ship a `fonts/` dir if size is a
  concern. **Do not** load fonts from a CDN (offline must work).
- Expand `prefs.font` to an enum; add a weight seg (Regular/Medium). Re‑paginate
  on change (font metrics shift pagination).

**Settings UI.** Typeface list (replace the 2‑button seg with a small list) +
weight seg.

**Acceptance.** Selecting OpenDyslexic renders it **offline**; weight applies;
persists; re‑paginates.

**Risks.** Embedded font size vs page weight; FOUT before font loads → measure
pagination after `document.fonts.ready`. **Effort: S–M.**

---

## Unit U18 — Brightness / warmth + OLED theme  *(Feature #18)*
**Goal.** A reading‑comfort overlay (dim + warm/amber) and a true‑black OLED
theme, beyond the three palettes.

**Depends on:** none.

**Isolation.** Branch `claude/u18-comfort`. File: `reader.html`. Settings:
`prefs.brightness` (0.3–1), `prefs.warmth` (0–1), `prefs.theme` gains `oled`.

**Design.**
- A fixed full‑screen overlay (`pointer-events:none`, above content **below**
  chrome): black layer at `opacity = 1 - brightness` for dimming, plus an amber
  layer at `opacity = warmth` for warmth. **Visual only → no re‑pagination.**
- Add `body.theme-oled { --bg:#000; --content-fg:#cfcfcf; ... }`.

**Settings UI.** Two sliders (brightness, warmth) + OLED added to theme seg.

**Acceptance.** Sliders dim/warm live without layout change; OLED is pure black;
all persist. **Effort: S.**

---

## Unit U20 — Live chapter title in header  *(Feature #20)*
**Goal.** Header shows the **current chapter**, updating as you read (today it
shows only the book title; `book-sub` shows %).

**Depends on:** none (uses existing TOC/headings + `pageOfElement`); pairs well
with F but doesn't require it.

**Isolation.** Branch `claude/u20-chapter-title`. File: `reader.html`. Setting:
none.

**Design.** After `paginate()`, build a sorted array `chapters = [{label, page}]`
from `buildTOC` targets resolved via `pageOfElement`. On `goTo`, binary‑search
the current chapter and render it (e.g., `book-sub` = `"<Chapter> · <pct>%"`, or
add a second header line). Recompute on re‑paginate.

**Acceptance.** Chapter label tracks scrolling and TOC jumps; correct after font
changes/rotation. **Effort: S.**

---

## Unit U23 — Page‑turn animation options (+ disable)  *(Feature #23)*
**Goal.** Choose page‑turn animation: **Slide / Fade / None**, with a setting to
disable; honor `prefers-reduced-motion`.

**Depends on:** none.

**Isolation.** Branch `claude/u23-page-anim`. File: `reader.html`. Setting:
`prefs.pageAnim` (`slide`|`fade`|`none`). **Default:** if
`prefers-reduced-motion: reduce` → `none`, else `slide`.

**Design.** Centralize the transition in `goTo()`: `slide` = current
transform transition; `fade` = quick opacity cross on the content; `none` =
instant. Read the media query once and as a live listener.

**Settings UI.** One seg (Slide/Fade/None) in the Display sheet.

**Acceptance.** Each mode behaves as named; None is instant; reduced‑motion
users default to None; persists. **Effort: S.**

---

## Unit U19 — Layout modes: two‑column & vertical scroll  *(Feature #19)*
**Goal.** A two‑column mode on wide/landscape screens, and an optional
**continuous vertical‑scroll** reading mode as an alternative to pagination.

**Depends on:** Unit F (scroll‑mode needs locator‑from‑scroll); do this **last**.

**Isolation.** Branch `claude/u19-layout` (consider splitting **U19a two‑column**
and **U19b scroll‑mode**). File: `reader.html`. Settings: `prefs.columns`
(`auto`|`1`|`2`), `prefs.layout` (`paginated`|`scroll`).

**Design.**
- **U19a two‑column:** when wide enough and `columns≠1`, render two columns per
  page (`column-count:2` within the page width); page **stride** becomes the
  two‑column width. `pageOfWord` math already uses `stride`, so it adapts.
- **U19b scroll‑mode:** disable the transform/multicolumn path; `.content`
  becomes normal vertical flow with `overflow-y:auto`. Navigation = native
  scroll; **progress** = `scrollTop/scrollHeight`; **locator** =
  word nearest viewport top (reuse F's geometry, vertical axis); swipe/tap
  page‑turn disabled (taps still toggle chrome). Re‑use F for save/restore.

**Acceptance.** Two‑column engages in landscape and turns correctly; scroll‑mode
reads continuously, saves/restores the same word as paginated mode; switching
modes preserves position via the shared locator; both gated by settings.

**Risks.** Scroll‑mode is a **second navigation/locator path** → highest risk;
keep it strictly behind the setting and reuse F. **Effort: L (split recommended).**

---

## 5. Definition of done (every unit)

- Branch from fresh `master`; single PR; isolated and revertible.
- New behavior behind a persisted setting (where it changes UX); sensible
  default; migration safe.
- `reader.html` inline `<script>` parses (syntax check) and all referenced
  element IDs exist.
- Manual test checklist in the PR description (no headless browser available).
- No new CDN runtime dependency; offline still works.
- Position/resume remains word‑exact (no regression to Unit F).

## 6. Open questions to confirm before building
1. **Single‑file vs assets:** OK to add a `fonts/` dir (U17) and possibly a
   `books/` dir, or must everything stay embedded in one HTML?
2. **bookId source of truth:** standardize on the library `?id` (recommended) —
   confirm so Unit F migrates `reader:pos:<title>` → `reader:loc:<id>`.
3. **Speed‑reader switch:** is `index.html` in scope to consume `exportTokens()`
   + `reader:loc` next, or is Unit F just laying the rails for now?
