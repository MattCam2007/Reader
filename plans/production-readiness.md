# reader.html — Production Readiness Review & Plan

Staff-level code review of `reader.html` ahead of merging with `index.html` (RSVP reader) into a unified tool.

---

## File Stats

- **2,657 lines** in a single file: ~821 CSS, ~180 HTML, ~1,650 JS
- Zero external files (no `.js`, `.css`, or module imports)
- CDN dependencies: `epub.js@0.3.93`, `jszip@3.10.1`

---

## 1. Review Findings

### 1.1 Architecture / Structure

**A. Monolith problem** — Everything lives in one IIFE. There are no modules, no separation of concerns. CSS, HTML, and JS are co-located. This makes the file unmaintainable at scale and blocks any future code sharing with `index.html` or `library.html`.

**B. Duplicated theme system** — The CSS custom property theme definitions (dark/sepia/light/oled) are copy-pasted across all three HTML files with slight variations (`library.html` has `--card-bg`, `index.html` has `--guide`, etc.). A theme change requires editing 3+ files.

**C. No shared code** — `index.html` and `reader.html` will both need the EPUB extraction pipeline (`extractSections`, `blocksFromDoc`, `sanitizeInline`, `findCoverImage`, `resolveImageUrls`), the document model, the locator system, and the prefs/storage layer. Today these are all trapped inside the IIFE.

**D. God-function `applyPrefs()`** (~52 lines, `reader.html:1068-1119`) — Does theme class toggling, font application, margin computation, slider sync, comfort overlay updates, meta tag updates, and active-state toggling for ~10 segmented controls. Every new setting grows this function linearly.

### 1.2 Code Quality

**E. DOM lookups by ID scattered everywhere** — Some elements are cached at the top (`reader.html:1016-1032`), but others are looked up inline every time: `document.getElementById("comfortDim")` (line 1111), `document.getElementById("lineHeightDisplay")` (line 1093), `document.getElementById("brightnessSlider")` (line 1115), `document.getElementById("searchResults")` (lines 1588, 1598). Inconsistent pattern.

**F. Repetitive settings wiring** — Lines 2407-2491 are ~85 lines of nearly identical event listener boilerplate. Each segmented control follows the same pattern: `addEventListener("click", find closest data-attr, set pref, applyPrefs, savePrefs, maybe paginateQuick)`. This screams for a data-driven approach.

**G. Implicit globals / module-level state soup** — ~30+ mutable state variables at the IIFE top level: `page`, `total`, `stride`, `bookId`, `sectionEls`, `headingToc`, `chapterIndex`, `doc`, `prefs`, `blobUrls`, `docModelBuilt`, `paginateGen`, `pendingDetached`, `selBar`, `activePopover`, `searchHighlightRanges`, `sectionBlockStart`, `dragging`, `decided`, `startX`, `startY`, `baseTx`, `startT`, `lastTouchEnd`, `saveTimer`, `resizeTimer`, `scrollSaveTimer`. All implicitly coupled with no visibility into what mutates what.

**H. Magic numbers** — `COLUMN_GAP = 40` is named, but many others are not:

| Value | Location | Meaning |
|-------|----------|---------|
| `80` | line 2344 | swipe threshold max px |
| `0.18` | line 2344 | swipe threshold viewport fraction |
| `0.3` / `0.7` | lines 2373-2374 | tap zone boundaries |
| `600` | line 2355 | synthetic click guard (ms) |
| `200` | line 1610 | max search hits |
| `500` | lines 1126, 2513 | save debounce (ms) |
| `150` | line 2504 | resize debounce (ms) |
| `400` | line 2348 | tap timeout (ms) |
| `200` | line 1769 | selection debounce (ms) |

**I. `resolveImageUrls` is O(n×m) worst case** — For each image entry, it iterates the full manifest path list to find basename matches (lines 2139-2143). Could be a Map lookup.

**J. `currentLocator()` in scroll mode** — The sampling approach (lines 1542-1555) does a coarse scan of every Nth word then refines. This is O(words/200 + 100) Range measurements per save, which fires on every scroll (debounced). Could be a binary search like the paginated path.

**K. Embedded sample text** — 26 lines of Pride & Prejudice hardcoded in JS (lines 2517-2543). Should be a separate fixture or fetched.

**L. `dismissSelBar._t`** — Storing a timer ID as a property on the function object (line 1768-1769). Works, but is ad-hoc state on an arbitrary object.

### 1.3 CSS Issues

**M. No namespace/BEM convention** — Class names like `.content`, `.tool`, `.chip`, `.overlay` are generic and will collide when reader and RSVP views share a page.

**N. `!important` usage** — `body.layout-scroll .content { transform: none !important; }` (line 448). Needed to override inline styles set by JS, which is itself a smell — JS shouldn't be fighting CSS for specificity.

**O. Inline styles set by JS** — `content.style.fontFamily`, `.fontSize`, `.transition`, `.transform`, `.columnWidth`, `.columnCount`, `.columnGap`, `.textAlign`, `.visibility`, `.opacity`, `viewport.style.paddingLeft/Right`, `content.style.setProperty('--reading-line-height', ...)`. Makes CSS debugging and overriding difficult.

### 1.4 HTML Issues

**P. Inline `style` attributes in HTML** — Lines 890-891 (`style="flex:1"`, `style="width:100%;accent-color:var(--accent)"`). Should be in the stylesheet.

**Q. Accessibility gaps:**

- No `role="dialog"` on settings sheet
- No `aria-expanded` on toggle buttons
- No focus trap in drawers/panels
- No `aria-live` region for progress updates
- No `role="search"` on search panel
- No skip-link for keyboard users

### 1.5 Error Handling

**R. Silent swallow pattern** — `catch (_) {}` appears **27 times**. While some are intentional (localStorage quota), many mask real bugs. No structured error reporting.

### 1.6 What Works Well (preserve these)

- **Range API for word measurement** (no per-word spans) — smart performance choice for 100k+ word novels
- **`paginateQuick()` with DOM detachment** — clever optimization, detaches distant chapters so the browser only reflows nearby text (~300ms vs seconds)
- **Portable locator system** (`toLocator`/`resolveLocator` with `{s, b, w}`) — well designed, layout-independent, survives font/size changes
- **CSS custom properties for theming** — correct approach, easy to extend
- **`sanitizeInline()` whitelist** — secure extraction, no innerHTML from EPUB, explicit tag+attribute allowlists
- **Debounced position saving** — appropriate pattern
- **Coach hint with auto-dismiss** — good onboarding UX
- **`paginateGen` generation counter** — correct cancellation pattern for async reattachment

---

## 2. Production Plan

### Phase 1: File Separation & Shared Foundation

**Goal:** Break the monolith into importable ES modules. No bundler required — use `<script type="module">` and native `import`/`export`.

#### Target file structure

```
reader/
├── index.html              (entry: RSVP speed reader)
├── reader.html             (entry: paginated reader)
├── library.html            (entry: bookshelf)
├── css/
│   ├── tokens.css          (shared CSS custom properties, themes, reset)
│   ├── reader.css          (paginated reader layout, content styling)
│   ├── rsvp.css            (RSVP-specific styles)
│   ├── library.css         (bookshelf styles)
│   └── components/
│       ├── chrome.css      (topbar, bottombar, toolbar buttons)
│       ├── drawers.css     (toc, settings sheet, search panel, backdrop)
│       ├── overlay.css     (loading/error overlay, coach hint)
│       ├── content.css     (reading surface: blocks, figures, tables, footnotes)
│       ├── controls.css    (seg-btn, range slider, chip)
│       └── selection.css   (sel-bar, search highlights)
├── js/
│   ├── core/
│   │   ├── prefs.js        (PrefsManager: load/save/apply/migrate, observable)
│   │   ├── storage.js      (position save/restore, locator persistence)
│   │   ├── constants.js    (all magic numbers, font stacks, selectors)
│   │   └── events.js       (EventBus or simple pub/sub for decoupling)
│   ├── epub/
│   │   ├── extractor.js    (extractSections, blocksFromDoc, sanitizeInline)
│   │   ├── images.js       (resolveImageUrls, findCoverImage, blob lifecycle)
│   │   └── toc.js          (flattenToc, buildTOC, resolveHref)
│   ├── model/
│   │   ├── doc-model.js    (buildDocModel, word/block/section arrays)
│   │   ├── locator.js      (toLocator, resolveLocator, exportTokens)
│   │   └── geometry.js     (wordRange, pageOfWord, pageOfElement, wordAtPageStart)
│   ├── reader/
│   │   ├── pagination.js   (paginate, paginateQuick, setupColumns, goTo)
│   │   ├── input.js        (touch/swipe/tap/keyboard handlers)
│   │   ├── chrome.js       (topbar/bottombar toggle, progress update)
│   │   ├── search.js       (openSearch, runSearch, highlight via CSS Highlight API)
│   │   ├── selection.js    (selBar, copy/define actions)
│   │   ├── footnotes.js    (note popover show/dismiss)
│   │   ├── chapters.js     (buildChapterIndex, currentChapterLabel)
│   │   └── scroll-mode.js  (scroll-specific navigation, progress, locator)
│   ├── reader-app.js       (orchestrator: init, wire modules, load book)
│   └── rsvp-app.js         (orchestrator for RSVP view — future)
└── fonts/
    ├── OpenDyslexic-Regular.woff2
    └── OpenDyslexic-Bold.woff2
```

#### Key decisions

- **ES modules** (`import`/`export`) — no bundler required, works in all modern browsers
- Each module exports a class or a set of pure functions
- **Shared modules** (`core/`, `epub/`, `model/`) are imported by both `reader-app.js` and `rsvp-app.js`
- CSS split by component, linked with `<link rel="stylesheet">`

#### Extraction order (minimizes broken intermediate states)

1. `js/core/constants.js` — extract all magic numbers and font stacks
2. `css/tokens.css` — extract shared theme variables and reset
3. `css/components/*.css` — extract component styles one at a time
4. `js/core/prefs.js` — extract PrefsManager (load/save/migrate)
5. `js/core/storage.js` — extract position persistence
6. `js/epub/extractor.js` — extract EPUB parsing pipeline
7. `js/epub/images.js` — extract image resolution
8. `js/epub/toc.js` — extract TOC building
9. `js/model/doc-model.js` — extract document model builder
10. `js/model/locator.js` — extract locator system
11. `js/model/geometry.js` — extract Range geometry functions
12. `js/reader/pagination.js` — extract pagination engine
13. `js/reader/input.js` — extract touch/keyboard handlers
14. `js/reader/*.js` — extract remaining reader features
15. `js/reader-app.js` — wire everything together as the orchestrator

---

### Phase 2: State Management Refactor

**Goal:** Replace 30+ loose mutable variables with a structured state object.

```js
// js/core/state.js
export class ReaderState {
  constructor() {
    this.page = 0;
    this.total = 1;
    this.stride = 1;
    this.bookId = null;
    this.docModelBuilt = false;
    this.paginateGen = 0;
    this.pendingDetached = [];
    // ... all current loose vars
  }

  get isScrollMode() { return this.prefs.layout === 'scroll'; }
  get fraction() { return this.total > 1 ? this.page / (this.total - 1) : 0; }
}
```

- Modules receive state via injection (constructor or init param), not globals
- `PrefsManager` becomes observable — UI modules subscribe to pref changes instead of the monolithic `applyPrefs()` doing everything
- Touch-tracking state (`dragging`, `decided`, `startX`, etc.) stays private inside `input.js`

---

### Phase 3: DRY the Settings Wiring

**Goal:** Replace 85 lines of repetitive event listeners with a data-driven system.

```js
// Declarative setting bindings
const SETTINGS = [
  { seg: 'themeSeg',     attr: 'theme',  pref: 'theme',        repaginate: false },
  { seg: 'fontSeg',      attr: 'font',   pref: 'font',         repaginate: true  },
  { seg: 'imagesSeg',    attr: 'images', pref: 'images',       repaginate: true,
    transform: v => v === 'true' },
  { seg: 'marginSeg',    attr: 'margin', pref: 'margin',       repaginate: true  },
  { seg: 'paraSeg',      attr: 'para',   pref: 'paraSpacing',  repaginate: true  },
  { seg: 'alignSeg',     attr: 'align',  pref: 'align',        repaginate: true  },
  { seg: 'layoutSeg',    attr: 'layout', pref: 'layout',       repaginate: true  },
  { seg: 'columnsSeg',   attr: 'cols',   pref: 'columns',      repaginate: true  },
  { seg: 'pageAnimSeg',  attr: 'anim',   pref: 'pageAnim',     repaginate: false },
  { seg: 'selectionSeg', attr: 'sel',    pref: 'selection',    repaginate: false,
    transform: v => v === 'true' },
  { seg: 'notePopSeg',   attr: 'notepop',pref: 'notePopovers', repaginate: false,
    transform: v => v === 'true' },
];

function wireSettings(prefs, applyFn, repaginateFn) {
  for (const s of SETTINGS) {
    document.getElementById(s.seg).addEventListener('click', (e) => {
      const btn = e.target.closest(`[data-${s.attr}]`);
      if (!btn) return;
      const val = btn.dataset[s.attr];
      prefs[s.pref] = s.transform ? s.transform(val) : val;
      applyFn();
      if (s.repaginate) repaginateFn();
    });
  }
}
```

Eliminates ~70 lines of boilerplate. Adding a new setting becomes a one-liner.

---

### Phase 4: Break Up `applyPrefs()`

**Goal:** Each UI concern applies its own prefs slice via subscription.

```js
// Instead of one giant function, each module registers a pref-change handler:
prefs.on('theme', (val) => {
  document.body.classList.remove('theme-sepia', 'theme-light', 'theme-oled');
  if (val !== 'dark') document.body.classList.add('theme-' + val);
  updateMetaThemeColor(val);
});

prefs.on('font', (val) => {
  content.style.fontFamily = FONT_MAP[val];
});

prefs.on('brightness', (val) => {
  dimEl.style.opacity = String(1 - val);
});

// Each seg-btn group auto-syncs its active state:
prefs.on('*', () => syncAllSegButtons());
```

Each module owns its own pref application. `applyPrefs()` becomes a one-liner: `prefs.notifyAll()`.

---

### Phase 5: CSS Cleanup

**5a. Move inline styles to CSS classes**

Replace JS inline style manipulation with CSS class toggles where possible:

```css
/* Instead of JS setting viewport.style.paddingLeft */
.reader-viewport.margin-narrow  { --reading-margin: 1rem; }
.reader-viewport.margin-normal  { --reading-margin: clamp(1.25rem, 6vw, 3rem); }
.reader-viewport.margin-wide    { --reading-margin: clamp(2rem, 10vw, 5rem); }
```

**5b. Replace inline transform with CSS custom properties**

```css
.reader-content {
  transform: translate3d(var(--page-offset, 0), 0, 0);
}
```

JS only sets `content.style.setProperty('--page-offset', -(page * stride) + 'px')`. This eliminates the `!important` on scroll mode — scroll mode simply sets `--page-offset: 0` or uses a class that overrides the property.

**5c. Add BEM-style namespacing**

Prefix all classes to avoid collisions when reader and RSVP share a page:

| Current | Namespaced |
|---------|-----------|
| `.content` | `.reader-content` |
| `.tool` | `.reader-tool` |
| `.chip` | `.ui-chip` |
| `.overlay` | `.reader-overlay` |
| `.backdrop` | `.ui-backdrop` |
| `.settings` | `.reader-settings` |

**5d. Remove inline `style=""` from HTML**

Move `style="flex:1"` and `style="width:100%;accent-color:var(--accent)"` (lines 890-891) into proper CSS rules.

---

### Phase 6: Error Handling & Robustness

**6a. Categorize the 27 `catch(_){}` blocks:**

| Category | Action |
|----------|--------|
| localStorage access (quota/private browsing) | Keep silent, these are expected |
| EPUB section load failures | Log with `console.warn` + context |
| Image resolution failures | Already logged — good |
| DOM operations (CSS.escape, Highlight API) | Feature-detect instead of try/catch |
| Book metadata parsing | Log, provide fallback |

**6b. Add structured error context:**

```js
// Instead of: catch (_) {}
// Use: catch (e) { log.warn('prefs:load', e); }
```

**6c. Defensive DOM access:**

Cache all DOM elements at init time and fail fast if critical elements are missing.

---

### Phase 7: Accessibility

| Issue | Fix |
|-------|-----|
| Settings sheet has no role | Add `role="dialog"` + `aria-modal="true"` |
| TOC drawer has no role | Add `role="dialog"` + `aria-modal="true"` |
| No focus trap in panels | Trap Tab cycle within open drawer/sheet |
| Toggle buttons missing state | Add `aria-expanded` to tocBtn, settingsBtn, searchBtn |
| Progress updates not announced | Add `aria-live="polite"` to `#progressLabel` |
| Search panel not semantic | Add `role="search"` to search panel container |
| No skip-link | Add hidden skip-link for keyboard users |
| Coach hint not dismissible via keyboard | Add `role="status"` and Escape handler |

---

### Phase 8: Performance

**8a. Image resolution — O(n×m) → O(n)**

Build a `Map<basename, fullPath>` from the manifest once:

```js
const basenameMap = new Map();
manifestPaths.forEach(p => {
  const base = p.split('/').pop().toLowerCase();
  if (!basenameMap.has(base)) basenameMap.set(base, p);
});
```

Then each image lookup is O(1) instead of scanning the full list.

**8b. Scroll-mode locator — sampling → binary search**

Replace the coarse+refine scan in `currentLocator()` scroll mode with a proper binary search over word indices, using vertical position instead of horizontal. Same pattern as `wordAtPageStart()`.

**8c. Chapter title tracking**

Consider `IntersectionObserver` on chapter heading elements instead of manual `pageOfElement` calls during `buildChapterIndex`. This would also enable live chapter title updates in scroll mode without scroll-event polling.

---

### Phase 9: Testing Infrastructure

- Extract the selftest harness into `js/test/selftest.js`
- Add per-module assertions (extractor, locator, pagination geometry)
- Move sample text to `fixtures/sample.json` or `fixtures/sample.js`
- Add a minimal test runner that reports pass/fail in the UI when `?selftest=1`
- Consider adding snapshot tests for the extraction pipeline (known EPUB → expected block structure)

---

## 3. Execution Order

| Priority | Phase | Risk | Effort | Notes |
|----------|-------|------|--------|-------|
| 1 | Phase 1 (file separation) | High | L | Most impactful. Enables all other phases. Must be done first. |
| 2 | Phase 2 (state management) | Medium | M | Do alongside Phase 1 as modules are extracted. |
| 3 | Phase 3 (DRY settings) | Low | S | Quick win during extraction. |
| 4 | Phase 5 (CSS cleanup) | Low | M | Do when extracting CSS files. |
| 5 | Phase 4 (break up applyPrefs) | Low | M | Natural consequence of observable prefs. |
| 6 | Phase 6 (error handling) | Low | S | Pass over each module after extraction. |
| 7 | Phase 7 (accessibility) | Low | S-M | Can be done independently. |
| 8 | Phase 8 (performance) | Low | S | Targeted optimizations. |
| 9 | Phase 9 (testing) | Low | S | Solidify after refactor. |

---

## 4. What NOT to Change

These patterns are correct and should be preserved through the refactor:

- **Range API for word measurement** — no per-word spans, keeps the DOM light
- **`paginateQuick()` DOM detachment** — clever optimization, defers full reflow
- **`paginateGen` generation counter** — correct async cancellation pattern
- **Portable locator format** (`{s, b, w}`) — well designed, layout-independent
- **CSS custom properties for theming** — correct, extensible
- **`sanitizeInline()` whitelist** — secure extraction, no innerHTML from EPUB
- **Debounced position saving** — appropriate pattern
- **Overall UX flow** (tap zones, swipe, chrome toggle) — proven and working
- **`findCoverImage` 4-strategy fallback** — handles real-world EPUB variation well
- **`buildDocModel` Text node walking** — works unchanged whether DOM has inline elements or not

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| ES modules add HTTP requests (no bundler) | Use `modulepreload` hints; files are small. Consider a simple concatenation script for production if latency matters. |
| Refactor introduces regressions | Extract one module at a time, run selftest after each. Keep the monolith as a reference. |
| Shared theme tokens diverge between views | Single `tokens.css` is the source of truth. Each view can extend with view-specific tokens. |
| BEM renaming breaks existing selectors | Find-and-replace is mechanical. Do it in one commit per component. |
| Focus trapping is complex on mobile | Use a lightweight trap (loop first↔last focusable) rather than a library. |
