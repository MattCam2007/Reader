# index.html (RSVP Reader) -- Production Readiness Review & Plan

Staff-level code review of `index.html` ahead of merging with `reader.html` into a unified reading tool. This plan assumes the reader.html production plan (`production-readiness.md`) has been fully executed.

---

## File Stats

- **2,217 lines** in a single file: ~647 CSS, ~193 HTML, ~1,371 JS
- Zero external files (no `.js`, `.css`, or module imports)
- CDN dependencies: `epub.js@0.3.93`, `jszip@3.10.1`

---

## 1. Review Findings

### 1.1 Architecture / Structure

**A. Same monolith problem as reader.html** -- Everything in one IIFE. CSS, HTML, JS co-located. Same structural issue already addressed by the reader.html plan's Phase 1.

**B. Divergent theme systems** -- The RSVP theme defines ~15 custom properties that reader.html doesn't have (`--guide`, `--guide-tick`, `--tick-mark`, `--tick-major`, `--tick-label`, `--break-orp`, `--accent-glow`, `--accent-dim`, `--accent-border`, `--accent-pressed`, `--control-bg`, `--control-bg-hover`, `--control-bg-active`, `--border-mid`, `--border-faint`, `--word-size`, `--word-font`, `--pause-dim`). reader.html defines properties RSVP doesn't have (`--content-fg`, `--chrome-bg`, `--panel-bg`, `--shadow`). Variable names for similar concepts also differ (RSVP: `--fg-muted`, `--fg-dim`; reader: `--muted`). Unifying `tokens.css` requires merging both sets into a single coherent token vocabulary.

**C. Missing OLED theme** -- reader.html has dark/sepia/light/oled. RSVP only has dark/light/sepia. The merged tool needs all four.

**D. Duplicate EPUB text extraction** -- index.html has its own extraction pipeline: `walkForText()`, `extractTextFromDoc()`, `extractChapterTitle()`, `extractFullText()`. This overlaps with reader.html's `extractSections()`, `blocksFromDoc()`, `sanitizeInline()`. The two implementations are NOT identical:
  - reader.html builds a rich block model (headings, lists, images, footnotes)
  - index.html strips to plain text only (skips images, figures, figcaptions entirely)
  - For RSVP, the simpler text-only extraction is correct -- it doesn't need the visual DOM model
  - The shared `epub/extractor.js` module needs to support both use cases (rich extraction for paginated reader, text-only extraction for RSVP)

**E. No state persistence** -- This is the single biggest gap vs reader.html. Nothing is saved to `localStorage`:
  - Reading position is lost on reload
  - WPM setting resets to 400
  - Theme/font choices reset
  - All timing settings reset
  - Training ramp config is lost
  - The loaded EPUB itself is not cached (user must re-open the file)

  reader.html has a full `reader:prefs` system with schema versioning and locator persistence. RSVP needs equivalent support via the now-extracted `PrefsManager`.

**F. No bookId / URL param integration** -- reader.html uses `?id=` to load books from the library. RSVP has no concept of this -- it only supports local file picking. When merged, RSVP mode needs to accept `?id=` and optionally `?mode=rsvp` to open books from the library shelf.

### 1.2 Code Quality

**G. ~30+ loose mutable variables** -- Same pattern as reader.html:

```
currentWPM, lengthStrength, commaPause, periodPause, paraPause,
chunkSize, startPaused, countdownEnabled, countdownTimer,
autoPauseEnabled, contextEnabled, lastSentenceIdx,
sessionWords, sessionPlayMs, sessionPlayStart, statsInterval,
trainingEnabled, trainingIncrement, trainingInterval,
trainingCeiling, trainingCounter, chapters, isEpubLoaded,
swipeStart, swipeFired, fsHideTimer, currentIdx, pendingTimer,
state, rampRemaining, manuallySeeked, granularity, sliderDragging,
currentTheme, dyslexicLoaded, toastTimer
```

These should move into a structured `RsvpState` class, consistent with the reader.html plan's `ReaderState`.

**H. Magic numbers** -- Many unnamed constants:

| Value | Location | Meaning |
|-------|----------|---------|
| `4` | line 880 | `LEN_THRESHOLD` (named, good) |
| `250` | line 881 | `LEN_SCALE` (named, good) |
| `35%` | CSS lines 157,169,199 | ORP alignment position |
| `40` | line 1534 | Swipe minimum distance (px) |
| `600` | line 1198 | Countdown tick interval (ms) |
| `110` | line 1616 | Step repeat interval (ms) |
| `350` | line 1615 | Step hold delay before repeat (ms) |
| `1000` | line 1446 | Toast display duration (ms) |
| `3` | line 1162 | Rewind words on resume |
| `5` | line 1168 | Ramp remaining count |
| `80` | line 2012 | Max chapter title length |
| `25` | lines 1501-1502, 1541 | WPM adjust step |
| `18` | line 1758 | Tick width in pixels |
| `2000` | line 1691 | Fullscreen auto-hide delay (ms) |

**I. Uncached DOM lookups** -- Some elements are cached at use-site (`seekSliderEl`, `seekReadoutEl`, etc.) but many are looked up inline every time:

| Element | Inline lookup count |
|---------|-------------------|
| `"contextLine"` | lines 1390, 1729 |
| `"wpmToast"` | line 1442 |
| `"wpmValue"` | line 1453 |
| `"chSelect"` | lines 1384, 2092, 2116 |
| `"chapterNav"` | line 2091 |
| `"statusMsg"` | via `statusMsgEl` (good) |
| `"trainingOpts"` | line 1740 |
| `"fullscreenBtn"` | lines 1708, 1714 |
| Various stat elements | lines 1465-1469 |

**J. Dynamic @font-face injection** -- `applyFont()` (line 1658-1663) creates a `<style>` element to inject the OpenDyslexic font face when first selected. This is fragile. The `@font-face` should be in the stylesheet (reader.html already has this in its CSS).

**K. Context line uses innerHTML** -- `updateContext()` (line 1415) sets `contextEl.innerHTML` with manually escaped content. While the escaping covers `&` and `<`, this pattern is error-prone. Should use DOM construction (which the same function already does for the fast-path on lines 1417-1430).

**L. Embedded sample text** -- 26 lines of Pride & Prejudice hardcoded in JS (lines 845-871). Same issue as reader.html (finding K in that plan). Should be a shared fixture or fetched.

**M. `e.stopPropagation()` everywhere** -- Nearly every click handler calls `e.stopPropagation()` to prevent the global click handler (line 1492) from toggling play. This is a code smell -- the global click handler should check if the click was on an interactive element rather than requiring every button to actively opt out.

### 1.3 CSS Issues

**N. No namespace/BEM convention** -- Same collision-prone class names as reader.html: `.controls`, `.settings`, `.reader`. When RSVP and paginated reader share a page, these will conflict. Needs prefixing (`.rsvp-controls`, `.rsvp-word-area`, etc.).

**O. `!important` usage** -- Lines 282-283:
```css
body.loading .reader,
body.error   .reader {
  opacity: 0 !important;
  pointer-events: none !important;
}
```
These override the `.paused .reader { opacity }` rule. Should use higher-specificity selectors or CSS layers instead.

**P. Hardcoded ORP position (35%)** -- The ORP (Optimal Recognition Point) alignment at 35% from left appears in 4 CSS rules (lines 157, 169, 199, 204) and would need to change in all 4 places if tuned. Should be a CSS custom property `--orp-position: 35%`.

### 1.4 HTML Issues

**Q. Accessibility gaps:**

| Issue | Location |
|-------|----------|
| `<details>` settings has no focus management | line 728 |
| No `aria-expanded` on settings summary | line 729 |
| No keyboard shortcut hints visible | various |
| No ARIA description for picker strips | lines 720-725 |
| Seek slider has no `aria-valuetext` (just raw number) | line 695 |
| Stats bar has no semantic role | line 651 |
| No skip-link for keyboard users | -- |
| Countdown state not announced to screen readers | -- |

### 1.5 What Works Well (preserve these)

- **`createPicker()` factory** (lines 1760-1848) -- Well-abstracted picker with scroll-snap, tick marks, and resize handling. Reusable component -- reader.html could use this for font size / line height sliders.
- **State machine** (`STATE_PLAYING/PAUSED/LOADING/ERROR/COUNTDOWN`) -- Clean, explicit states with `setState()` managing body classes. Good pattern.
- **Tokenizer with multi-dimensional indices** (`tokenize()`, lines 922-958) -- Builds parallel lookup arrays (`wordTokenIndices`, `tokenToWordOrdinal`, `sentenceStarts`, `paragraphStarts`) enabling O(1) navigation between token types. Well-designed data structure.
- **Binary search** (`lastIndexAtMost()`, lines 1279-1287) -- Correct implementation, used throughout.
- **Chunk rendering** (`renderChunk()`, lines 1015-1034) -- Multi-word RSVP with proper ORP pivot calculation.
- **ORP calculation** (`orpIndex()`, lines 960-967) -- Standard RSVP algorithm.
- **Duration multiplier system** (`durationMultiplier()`, lines 982-989) -- Configurable pause weights for punctuation/length. Good design.
- **Hold-to-repeat on step buttons** (`bindHold()`, lines 1600-1621) -- Clean pattern with delay then interval.
- **Fullscreen auto-hide** (lines 1676-1715) -- Proper event cleanup on exit.
- **Training ramp** -- Nice progressive speed increase feature.
- **Context line** -- Sentence preview with highlighted current word.

---

## 2. Production Plan

> **Prerequisite:** The reader.html production plan (Phases 1-9) has been executed. The shared module system (`js/core/`, `js/epub/`, `js/model/`) exists and `tokens.css` is the single source of theme tokens.

### Phase R0: Retrofit the Reader.html Output

**Goal:** Before any RSVP extraction begins, fix the gaps in the already-executed reader.html plan that would block or compromise RSVP integration.

These are targeted modifications to the modules that Phase 1-9 of the reader.html plan already produced.

#### R0a: Token audit & `tokens.css` reconciliation

The reader.html plan extracted `tokens.css` with only reader tokens. Before RSVP touches this file, we need to reconcile the two token vocabularies upfront rather than bolting RSVP tokens on after the fact.

1. Inventory all CSS custom properties across `index.html`, `reader.html`, and `library.html`
2. Identify overlapping concepts with different names:
   - Reader `--muted` vs RSVP `--fg-muted` -> unify to one name
   - Reader `--border` vs RSVP `--border` (same name, different values per theme) -> verify compatibility
   - Reader has no equivalent for `--control-bg`, `--control-bg-hover`, `--control-bg-active` -> these are general-purpose interactive tokens, add to shared set
   - `--border-mid`, `--border-faint` -> add to shared set (reader could use these too)
3. Decide which tokens are truly view-specific vs shared:
   - **Shared:** `--accent-*` variants, `--control-bg-*`, `--border-*` grades, font stacks
   - **Reader-only:** `--content-fg`, `--chrome-bg`, `--panel-bg`, `--shadow`
   - **RSVP-only:** `--guide*`, `--tick-*`, `--break-orp`, `--pause-dim`, `--word-size`, `--word-font`
4. Update `tokens.css` with the unified vocabulary. Update all reader module CSS that references renamed tokens.
5. Each theme variant (dark/light/sepia/oled) gets the full token set including RSVP tokens, even before RSVP code is extracted.

This is a **one-commit surgical update** to `tokens.css` + the reader CSS files that reference any renamed tokens.

#### R0b: Parameterize `PrefsManager`

The reader.html plan's `PrefsManager` (in `js/core/prefs.js`) was designed around `reader:prefs`. Refactor it to accept configuration:

```js
// Before (hardcoded):
class PrefsManager {
  constructor() {
    this.key = 'reader:prefs';
    this.defaults = READER_DEFAULTS;
  }
}

// After (parameterized):
class PrefsManager {
  constructor({ storageKey, defaults, version = 1 }) {
    this.key = storageKey;
    this.defaults = defaults;
    this.version = version;
  }
}

// Usage:
const readerPrefs = new PrefsManager({
  storageKey: 'reader:prefs',
  defaults: READER_DEFAULTS,
  version: 2,
});

const rsvpPrefs = new PrefsManager({
  storageKey: 'rsvp:prefs',
  defaults: RSVP_DEFAULTS,
  version: 1,
});
```

Verify reader.html still works after this refactor. This is a non-breaking API change if done correctly (the reader instantiation just moves from implicit to explicit config).

#### R0c: Reconcile font stacks in `constants.js`

The reader.html plan extracted `FONT_STACKS` into `constants.js`. RSVP has its own definition (index.html line 1648-1653) with the same keys but potentially different ordering/fallbacks. Reconcile into a single canonical definition:

```js
// js/core/constants.js
export const FONT_STACKS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  dyslexic: '"OpenDyslexic", sans-serif',
};
```

Note: reader.html calls the sans option `system` or `sans` -- pick one name. RSVP uses `sans`. Standardize.

#### R0d: Add `extractPlainText` to `epub/extractor.js`

The reader.html plan extracted `extractor.js` with `extractSections()`, `blocksFromDoc()`, `sanitizeInline()`. Add the text-only extraction path now, before RSVP code needs it:

```js
// Added to js/epub/extractor.js

export async function extractPlainText(book, onProgress) {
  const items = book.spine?.spineItems || [];
  if (!items.length) throw new Error('No readable spine items.');

  const parts = [];
  const chapterMeta = [];
  let totalWords = 0;

  for (let i = 0; i < items.length; i++) {
    const section = items[i];
    onProgress?.(i + 1, items.length);
    try {
      const doc = await section.load(book.load.bind(book));
      const text = extractTextFromDoc(doc);
      if (text) {
        const title = extractChapterTitle(doc, chapterMeta.length + 1);
        chapterMeta.push({ title, wordOffset: totalWords });
        totalWords += text.split(/\s+/).filter(Boolean).length;
        parts.push(text);
      }
    } catch (e) {
      console.warn('extractor:plaintext', section?.href, e);
    } finally {
      try { section?.unload?.(); } catch (_) {}
    }
  }
  return { text: parts.join('\n\n'), chapters: chapterMeta };
}
```

The internal helpers (`walkForText`, `extractTextFromDoc`, `extractChapterTitle`) become private functions within `extractor.js`. The spine iteration + error handling is shared structure with `extractSections` -- factor out a common `iterateSpine(book, processFn, onProgress)` if the duplication bothers you, but don't over-abstract.

#### R0e: Retrofit `AbortController` for event listener cleanup

The reader.html modules register event listeners during init. For mode switching (R11), these all need to be torn down cleanly. Retrofit each module to accept and use an `AbortSignal`:

```js
// Pattern for every module that registers listeners:
export function initPagination(state, signal) {
  document.addEventListener('keydown', handleKey, { signal });
  window.addEventListener('resize', handleResize, { signal });
  // ...
}
```

The orchestrator (`reader-app.js`) creates the controller:

```js
let controller = new AbortController();

export function teardown() {
  controller.abort();
  // Any other cleanup (blob URLs, intervals, etc.)
}

export function init() {
  controller = new AbortController();
  const { signal } = controller;
  initPagination(state, signal);
  initInput(state, signal);
  // ...
}
```

This is a mechanical change across all reader modules: every `addEventListener` call gets `{ signal }` added to its options. No behavioral change -- just plumbing for future teardown.

**R0 is 5 focused commits, each independently testable. Do these before any RSVP extraction.**

### Phase R1: Integrate RSVP into the Shared Module System

**Goal:** Extract RSVP-specific code into the module structure established by the reader.html plan.

#### New files to create

```
js/
├── rsvp/
│   ├── tokenizer.js      (tokenize, orpIndex, endsSentence, sentence/paragraph indexing)
│   ├── timing.js          (durationMultiplier, lengthMultiplier, ramp logic)
│   ├── playback.js        (state machine: play/pause/resume/countdown, chunk scheduling)
│   ├── display.js         (render, renderChunk, updateContext, updateSeekUI)
│   ├── input.js           (keyboard, swipe gestures, hold-to-repeat, slider)
│   ├── training.js        (training ramp state + logic)
│   ├── stats.js           (session stats tracking + display)
│   └── chapters.js        (chapter nav for RSVP mode)
├── rsvp-app.js            (orchestrator: init, wire modules, load book)
├── shared/
│   └── picker.js          (createPicker factory -- shared component)
css/
├── rsvp.css               (all RSVP-specific styles)
├── components/
│   └── picker.css         (picker strip styles -- shared component)
```

#### Modules that are SHARED with reader (already extracted)

| Module | RSVP usage |
|--------|-----------|
| `js/core/prefs.js` | Load/save RSVP prefs (WPM, theme, font, timing, training config) |
| `js/core/storage.js` | Persist reading position per book |
| `js/core/constants.js` | Shared magic numbers, font stacks |
| `js/core/events.js` | Event bus for cross-module communication |
| `js/epub/extractor.js` | Text extraction (needs text-only mode, see R2) |
| `js/epub/toc.js` | Chapter title extraction |

#### Key decisions

- `rsvp/tokenizer.js` is RSVP-only -- the tokenizer is fundamentally different from reader.html's doc model. reader.html builds a visual DOM with blocks/words/ranges; RSVP builds a flat token array with navigational indices. These are two different data representations of the same source text, and should NOT be forced into a single abstraction.
- `shared/picker.js` is promoted to a shared component because reader.html's font-size/line-height sliders could benefit from the same scroll-snap picker pattern.

### Phase R2: Wire RSVP to Shared Extractor

**Goal:** RSVP modules consume the `extractPlainText()` entry point added in R0d.

R0d already added `extractPlainText` to `epub/extractor.js`. This phase is about wiring it:

1. `rsvp-app.js` imports `extractPlainText` from `js/epub/extractor.js`
2. Delete the duplicated `walkForText`, `extractTextFromDoc`, `extractChapterTitle`, and `extractFullText` functions from RSVP code (they now live in the shared module)
3. `extractChapterTitle` also moves to `epub/toc.js` alongside `flattenToc` (if not already done in R0d)
4. Verify EPUB loading works identically: load the same EPUB in both reader and RSVP modes, confirm chapter count and text content match

### Phase R3: Add State Persistence

**Goal:** RSVP settings and reading position survive page reload.

This is the single biggest functional gap. Implementation:

```js
// RSVP prefs schema (stored via shared PrefsManager)
const RSVP_DEFAULTS = {
  v: 1,
  theme: 'dark',
  font: 'mono',
  fontSize: 48,
  wpm: 400,
  chunkSize: 1,
  granularity: 'word',
  lengthStrength: 50,
  commaPause: 50,
  periodPause: 120,
  paraPause: 150,
  startPaused: true,
  countdownEnabled: true,
  contextEnabled: true,
  autoPauseEnabled: true,
  trainingEnabled: false,
  trainingIncrement: 10,
  trainingInterval: 500,
  trainingCeiling: 600,
};
```

Storage key: `rsvp:prefs` using the parameterized `PrefsManager` from R0b.

Position storage: `rsvp:pos:{bookId}` storing `{ wordOrdinal, timestamp }`. Simpler than reader.html's locator since RSVP position is just a word index.

### Phase R4: RSVP State Management

**Goal:** Replace 35+ loose mutable variables with a structured state object, consistent with reader.html's `ReaderState` pattern.

```js
// js/rsvp/state.js
export class RsvpState {
  // Playback
  currentIdx = 0;
  pendingTimer = null;
  state = 'paused';
  rampRemaining = 0;
  manuallySeeked = false;

  // Token data (set on load)
  tokens = [];
  wordTokenIndices = [];
  sentenceStarts = [];
  paragraphStarts = [];
  // ... etc

  // Book metadata
  chapters = [];
  isEpubLoaded = false;
  bookId = null;
}
```

Private/scoped state stays in its owning module:
- `swipeStart`, `swipeFired` -> `rsvp/input.js`
- `sessionWords`, `sessionPlayMs`, `sessionPlayStart` -> `rsvp/stats.js`
- `trainingCounter` -> `rsvp/training.js`
- `sliderDragging` -> `rsvp/input.js`
- `fsHideTimer` -> `rsvp/input.js`
- `countdownTimer` -> `rsvp/playback.js`
- `toastTimer` -> `rsvp/display.js`
- `lastSentenceIdx` -> `rsvp/display.js`

### Phase R5: CSS Extraction & Namespace

**Goal:** Move all CSS to external files with BEM-style namespacing to avoid collisions with reader styles.

#### Namespace mapping

| Current | Namespaced |
|---------|-----------|
| `.reader` | `.rsvp-display` |
| `.reader-wrap` | `.rsvp-wrap` |
| `.word-area` | `.rsvp-word-area` |
| `.word` | `.rsvp-word` |
| `.controls` | `.rsvp-controls` |
| `.settings` | `.rsvp-settings` |
| `.stats-bar` | `.rsvp-stats` |
| `.status-overlay` | `.rsvp-status` |
| `.seek` | `.rsvp-seek` |
| `.transport` | `.rsvp-transport` |
| `.grain` | `.rsvp-grain` |
| `.grain-btn` | `.rsvp-grain__btn` |
| `.nav-btn` | `.rsvp-nav-btn` |
| `.play-btn` | `.rsvp-play-btn` |
| `.guide` | `.rsvp-guide` |
| `.guide-tick` | `.rsvp-guide-tick` |
| `.context-line` | `.rsvp-context` |
| `.wpm-toast` | `.rsvp-toast` |

#### Extract `--orp-position` as a CSS custom property

```css
:root {
  --orp-position: 35%;
}
.rsvp-guide { left: var(--orp-position); }
.rsvp-guide-tick { left: var(--orp-position); }
.rsvp-word .orp { left: var(--orp-position); }
.rsvp-word .before { right: calc(100% - var(--orp-position) + 0.5ch); }
.rsvp-word .after { left: calc(var(--orp-position) + 0.5ch); }
```

#### Remove `!important` overrides

Replace:
```css
body.loading .reader { opacity: 0 !important; pointer-events: none !important; }
```
With state-specific class that has naturally higher specificity or use CSS cascade layers.

### Phase R6: Verify Theme Token Integration

**Goal:** Confirm that the token unification from R0a works correctly when RSVP CSS is actually rendered.

R0a already did the heavy lifting (token audit, naming reconciliation, adding RSVP tokens to `tokens.css`). This phase is the verification pass:

1. Extract RSVP CSS into `rsvp.css` (done in R5), which references the unified tokens
2. Visually verify all four themes (dark/light/sepia/oled) render correctly for RSVP
3. Verify reader.html is not regressed by the token additions
4. Check that RSVP-only tokens (e.g. `--guide`, `--tick-mark`) have proper overrides in each theme variant -- R0a should have added these, but this is where you catch any missed variants

### Phase R7: Eliminate `stopPropagation` Pattern

**Goal:** Replace the global click-to-toggle-play pattern with a more intentional event system.

Current: global `document.addEventListener("click")` toggles play, every button does `e.stopPropagation()` to prevent it.

Better: the click handler only fires on the `readerWrap` area, and uses `e.target.closest()` to verify the click was directly on the reading surface (not on any interactive child).

```js
readerWrap.addEventListener('click', (e) => {
  if (e.target.closest('button, select, input, a, details, summary')) return;
  if (e.target.closest('.rsvp-status')) return;
  togglePlay();
});
```

This removes the need for `e.stopPropagation()` on every button handler.

### Phase R8: Fix Context Line innerHTML

**Goal:** Remove the innerHTML usage in `updateContext()`.

Replace the HTML string construction (line 1406-1414):
```js
// Current: manual HTML escaping + innerHTML
html += '<b data-i="' + i + '">' + escaped + "</b> ";
contextEl.innerHTML = html.trim();
```

With DOM construction:
```js
const frag = document.createDocumentFragment();
for (let i = start; i < end; i++) {
  if (tokens[i] === PARAGRAPH_BREAK) continue;
  const el = document.createElement(i === tokenIdx ? 'b' : 'span');
  el.dataset.i = i;
  el.textContent = tokens[i];
  frag.appendChild(el);
  frag.appendChild(document.createTextNode(' '));
}
contextEl.replaceChildren(frag);
```

This is already the pattern used for the fast-path (lines 1417-1430), so it's a consistency fix.

### Phase R9: Extract Constants

**Goal:** Move all magic numbers to `js/core/constants.js` (shared file from reader.html plan).

```js
// RSVP-specific constants (added to shared constants.js)
export const RSVP = {
  ORP_POSITION: 35,           // percent from left
  SWIPE_MIN_PX: 40,
  COUNTDOWN_TICK_MS: 600,
  STEP_HOLD_DELAY_MS: 350,
  STEP_REPEAT_MS: 110,
  TOAST_DURATION_MS: 1000,
  REWIND_WORDS_ON_RESUME: 3,
  RAMP_STEPS: 5,
  WPM_ADJUST_STEP: 25,
  WPM_MIN: 100,
  WPM_MAX: 800,
  TICK_PX: 18,
  FS_AUTO_HIDE_MS: 2000,
  MAX_CHAPTER_TITLE_LEN: 80,
  FONT_SIZE_MIN: 24,
  FONT_SIZE_MAX: 96,
  FONT_SIZE_STEP: 4,
  LEN_THRESHOLD: 4,
  LEN_SCALE: 250,
};
```

### Phase R10: Accessibility

| Issue | Fix |
|-------|-----|
| Seek slider missing `aria-valuetext` | Set to "word 42 of 5,000, 12% complete" |
| Countdown not announced | Add `aria-live="assertive"` region for countdown |
| No keyboard shortcut hints | Add `title` attributes or a keyboard help modal |
| Picker strips not labeled for AT | Add `role="slider"` + `aria-valuemin/max/now` to each picker |
| Stats bar not semantic | Add `role="status"` + `aria-live="polite"` |
| No skip-link | Share implementation with reader |
| `<details>` settings needs focus management | Trap focus when open on mobile |

### Phase R11: Mode Switching (Merger)

**Goal:** Single entry point that supports both paginated and RSVP reading modes.

This is the ultimate goal -- the two readers become one tool with a mode toggle.

#### Architecture

```
reader.html (single entry point)
  ├── Loads shared modules (prefs, storage, epub, tokens)
  ├── ?mode=rsvp  -> boots rsvp-app.js, renders RSVP view
  ├── ?mode=read  -> boots reader-app.js, renders paginated view (default)
  └── Mode toggle button in chrome switches between them
```

#### Implementation approach

1. Both views render into the same `<div id="app">` container
2. Mode switch:
   - Saves current position as a locator
   - Tears down current view via `controller.abort()` (R0e plumbing) + clear DOM
   - Boots the other view with a fresh `AbortController`
   - Resolves position from the saved locator
3. Position translation between modes:
   - reader.html locator: `{s, b, w}` (section, block, word)
   - RSVP position: word ordinal
   - Both are derivable from the doc model + tokenizer data
   - Shared `locator.js` provides `locatorToWordOrdinal()` and `wordOrdinalToLocator()`

#### Shared chrome

- Top bar: book title, mode toggle button, settings gear
- Settings panel: shared settings (theme, font) + mode-specific settings
- The bottom bar is entirely mode-specific (RSVP has transport controls; reader has page progress)

---

## 3. Execution Order

| Priority | Phase | Risk | Effort | Notes |
|----------|-------|------|--------|-------|
| 0 | R0 (retrofit reader output) | Medium | M | **Do first.** 5 focused commits to fix gaps in the reader.html plan's output before RSVP work begins. |
| 1 | R1 (module extraction) | High | L | Core RSVP extraction. Follows reader.html's established patterns. |
| 2 | R2 (wire shared extractor) | Low | S | RSVP consumes `extractPlainText` from R0d. Delete duplicated code. |
| 3 | R3 (persistence) | Medium | M | Biggest functional gap. Uses parameterized PrefsManager from R0b. |
| 4 | R6 (verify themes) | Low | S | Verification pass -- R0a did the heavy lifting. |
| 5 | R5 (CSS namespace) | Medium | M | Required before merger. Mechanical but tedious. |
| 6 | R4 (state management) | Low | M | Do alongside R1 as modules are extracted. |
| 7 | R7 (stopPropagation) | Low | S | Quick cleanup during extraction. |
| 8 | R8 (innerHTML fix) | Low | S | Quick safety fix. |
| 9 | R9 (constants) | Low | S | Mechanical, do during extraction. |
| 10 | R10 (accessibility) | Low | S-M | Independent of other phases. |
| 11 | R11 (mode switching) | High | L | Final phase. Depends on all others. Uses AbortController from R0e. |

---

## 4. What NOT to Change

These patterns are correct and should be preserved through the refactor:

- **`createPicker()` factory** -- well-abstracted, promote to shared component
- **Tokenizer data structure** (`wordTokenIndices`, `sentenceStarts`, `paragraphStarts` parallel arrays) -- efficient for RSVP navigation
- **ORP algorithm** (`orpIndex()`) -- standard RSVP implementation
- **State machine pattern** (`setState()` with body class management)
- **Duration multiplier system** -- configurable punctuation pauses, good UX
- **Chunk rendering with pivot calculation** -- correct multi-word RSVP
- **Binary search** (`lastIndexAtMost()`) -- correct, reusable
- **Hold-to-repeat** (`bindHold()`) -- clean pattern
- **Fullscreen auto-hide** -- proper event lifecycle
- **Training ramp** -- good feature, clean implementation
- **Context line sentence preview** -- good UX aid for speed reading
- **Countdown with visual feedback** -- good resume UX

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Theme token merge creates visual regressions | Snapshot both views' appearance before and after. Compare computed styles on key elements. |
| EPUB extractor refactor breaks one mode | Extract both code paths side-by-side, test with the same EPUB in both modes. |
| Mode switching loses position | Build locator translation with unit tests. Test with position at chapter boundaries, paragraph breaks, first/last word. |
| Persistence migration when RSVP prefs didn't exist before | Use the same `prefs.v` versioning pattern. If no RSVP prefs found, use defaults. No migration needed for fresh installs. |
| `createPicker` doesn't generalize cleanly | Keep it working for RSVP first; only promote to shared if reader.html actually wants it. Don't generalize prematurely. |
| CSS namespace rename is error-prone | Script it: `sed`-based rename in one commit, then verify no orphaned class names. |
| RSVP and reader event listeners conflict when coexisting | Each view must fully clean up its listeners on teardown. Use `AbortController` signals for easy bulk removal. |

---

## 6. Issues / Concerns with the Original reader.html Plan

Having reviewed both files, these issues in the reader.html production plan should be noted. **All six are now addressed by Phase R0.**

| # | Concern | Corrective phase |
|---|---------|-----------------|
| 6a | `rsvp-app.js` was mentioned but not detailed | **R1** -- defines full RSVP module structure |
| 6b | `extractor.js` assumes rich extraction only | **R0d** -- adds `extractPlainText` entry point |
| 6c | `tokens.css` scope was underspecified | **R0a** -- token audit + unified vocabulary before RSVP extraction |
| 6d | `PrefsManager` hardcoded to single store | **R0b** -- parameterize with `{ storageKey, defaults, version }` |
| 6e | Font stacks diverge between files | **R0c** -- reconcile into single canonical `FONT_STACKS` in `constants.js` |
| 6f | No `AbortController` for event cleanup | **R0e** -- retrofit `{ signal }` on all reader module listeners |

### 6a. `rsvp-app.js` was mentioned but not detailed

The reader.html plan (Phase 1) lists `js/rsvp-app.js` in the file structure as "(orchestrator for RSVP view -- future)" but doesn't define what shared modules it will consume or how it differs from `reader-app.js`. **Phase R1** fills this gap with a complete module breakdown.

### 6b. `extractor.js` assumes rich extraction only

The reader.html plan extracts `extractor.js` from reader.html's `extractSections`/`blocksFromDoc`/`sanitizeInline`. But RSVP needs a text-only extraction path. **Phase R0d** adds `extractPlainText()` to the shared module before RSVP code is extracted. Phase R2 then wires RSVP to consume it.

### 6c. `tokens.css` scope was underspecified

The reader.html plan says "extract shared theme variables and reset" into `tokens.css`, but doesn't account for the ~15 RSVP-specific tokens that also need to live there. If `tokens.css` is extracted from reader.html first and then RSVP tokens are bolted on later, you get naming inconsistencies (which already exist between the two files today). **Phase R0a** does a full token audit across all HTML files and builds the unified vocabulary before any RSVP extraction begins.

### 6d. `PrefsManager` needs to support multiple pref stores

The reader.html plan designs `PrefsManager` around `reader:prefs`. But RSVP needs `rsvp:prefs` with a different schema. **Phase R0b** refactors `PrefsManager` to accept `{ storageKey, defaults, version }` as constructor config, making it reusable for any pref store.

### 6e. Shared font stacks should be in constants.js

Both files define `FONT_STACKS` / font family mappings independently with slightly different entries. **Phase R0c** reconciles them into a single canonical object in `constants.js`.

### 6f. `AbortController` pattern not mentioned for event cleanup

The reader.html plan doesn't mention how event listeners will be cleaned up when views are torn down for mode switching. This is critical for Phase R11. **Phase R0e** retrofits `AbortController` + `{ signal }` into all reader module `addEventListener` calls, enabling `controller.abort()` for full view teardown.
