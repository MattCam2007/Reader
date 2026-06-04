# Plan: Whole-book page numbers in windowed mode (cached, idle-measured)

> **Status:** spec / not yet implemented.
> **Audience:** an implementer who has *not* read the whole codebase. Every
> change is spelled out with file, function, and data shape. Follow the phases
> in order; each phase leaves the app working.

## 1. What we're building (and why)

In paginated layout the reader uses **windowed rendering**: only the current
chapter (`.chap`) is attached to the DOM; the rest live detached in
comment-marker placeholders (`state.chapWindows`). This makes page turns ~60×
faster, but it has a side effect: `state.total` / `state.page` are measured from
`content.scrollWidth` — and `content` holds **only one chapter**. So in windowed
mode we can only show *page-within-chapter* ("Chapter 12 · p3 of 18"), never a
whole-book "Page 247 of 980". The other chapters have no layout, so their page
counts are simply unknown. (See `docs/PERFORMANCE.md` → "Windowed rendering".)

**Goal:** keep the existing chapter + page-in-chapter label exactly as it is, and
**add** a whole-book "Page N of M" indicator. Page counts are a pure function of
layout (width, height, font, size, etc.), so they only need to be computed once
per *layout signature* and can be **cached**. Computing them means laying each
chapter out once — we do that lazily, in the background (idle time), and never on
the page-turn hot path.

### UX (the deliverable)

- **Bottom progress label** (`#progressLabel`): unchanged — still
  `"Chapter 12 · p3 of 18"`.
- **Top sub-title** (`#bookSub`): currently shows `"25% read"` in windowed mode.
  Change it to `"Page 247 of 980 · 25%"`.
- While counts are still being measured, prefix unknown numbers with `~`
  (`"~Page 247 of ~980 · 25%"`). The `~` disappears once all chapters are
  measured. When counts come from cache, there is no `~` and no measuring pass —
  it's exact from the first paint.

This is **non-critical information**: if measurement is interrupted or a chapter
fails to measure, we fall back to an estimate and never block the reader.

---

## 2. Key facts about the existing code (read this before coding)

- **Windowed mode is the only place this applies.** `state.windowed` is `true`
  only for paginated layout, >1 section, and ≥ `WINDOW_MIN_WORDS`
  (`shouldWindow()` in `js/reader-app.js`). Scroll mode and small books render
  whole and already have a correct global total — **the feature is inert there.**
- **The current chapter's exact page count is free.** Every time a chapter is
  laid out, `pagination.paginateWindow()` sets
  `state.total = round(content.scrollWidth / state.stride)` — that is the *exact*
  page count of the currently-attached chapter. So as the reader visits chapters,
  we get exact counts for free; the idle pass only needs to fill in *unvisited*
  chapters.
- **Layout styles live on specific elements, not `:root`.** `applyPrefs()` in
  `js/reader-app.js` sets:
  - `els.content.style.fontFamily`, `.fontSize`, `.textAlign`
  - `els.content.style.setProperty("--reading-line-height", …)`
  - `els.content.classList.toggle("para-spaced", …)`
  - `els.viewport.classList` → `margin-narrow|normal|wide`
  - `document.body.classList.toggle("images-off", …)`
  A measuring container therefore must **clone `els.content`'s inline styles +
  classes** and sit inside a clip/viewport of the **same width, height, and
  margin class**, or the counts will be wrong. `document.body.classList`
  (`images-off`) is global, so a body-attached host inherits it for free.
- **Column setup + stride** is computed in `PaginationEngine.setupColumns()`
  (`js/reader/pagination.js`): 2 columns if `prefs.columns === "2"` or
  (`"auto"` and width > 700), else 1; `state.stride = vpW + COLUMN_GAP`.
  We will extract this into a shared pure helper so the measuring path can't
  drift from the live path.
- **Sections** (`state.doc.sections[i]`) carry `{ href, el, wsStart, wsEnd }`.
  `el` is the `.chap` element (detached or live). `wsStart/wsEnd` are
  whitespace-word ordinals — used for the estimate.
- **`state.chapWindows[i]`** = `{ el, marker }`. When `i !== state.curChap`, `el`
  is detached (parentless) and `marker` is a comment node in the live DOM. The
  current chapter's `el` is inside `els.content` and its `marker` is `null`.
- **Persistence pattern** to mirror: `js/core/position.js` (`POS_KEY_PREFIX`,
  `loadStoredPosition`/`saveStoredPosition`, try/catch around `localStorage`).
- **`bookId`** (`state.bookId`) is stable per book across sessions
  (`deriveBookId`). It is the cache namespace.

---

## 3. The layout signature (cache key)

Page counts are valid only for one exact layout. The signature is a string built
from every input that changes how text flows. **Rule of thumb:** include every
pref whose `SETTINGS` entry in `js/core/constants.js` has `repaginate: true`,
plus the slider prefs that aren't in `SETTINGS`, plus the viewport box.

Signature inputs:

| Source | Field |
|---|---|
| viewport | `round(content width)` |
| viewport | `round(content height)` |
| prefs | `font` |
| prefs | `size` |
| prefs | `weight` |
| prefs | `lineHeight` |
| prefs | `margin` |
| prefs | `paraSpacing` |
| prefs | `align` |
| prefs | `hyphens` |
| prefs | `images` |
| prefs | resolved `columns` (1 or 2, after the `auto`/width>700 rule) |

> **Height matters.** Pages-per-chapter depend on lines-per-column = column
> height ÷ line height. A height-only change (window vertical resize, mobile URL
> bar) changes counts without changing width, so height **must** be in the
> signature. Resize is already debounced (`RESIZE_DEBOUNCE_MS`) and routes
> through `relayout()`, so this won't thrash.

Implement as `PageCounter.computeSignature()` returning a `|`-joined string.
`layout: "scroll"` short-circuits the whole feature, so it's not in the
signature.

---

## 4. New files

### 4a. `js/core/page-cache.js` (persistence — pure, testable)

```js
export const PAGE_KEY_PREFIX = 'book:pages:';

// Shape: { v: 1, sig: string, counts: number[] }  // counts[i] = pages in section i
export function loadPageCache(bookId) {
  if (!bookId) return null;
  try {
    const raw = localStorage.getItem(PAGE_KEY_PREFIX + bookId);
    const o = raw ? JSON.parse(raw) : null;
    return (o && o.v === 1 && typeof o.sig === 'string' && Array.isArray(o.counts)) ? o : null;
  } catch (_) { return null; }
}

export function savePageCache(bookId, sig, counts) {
  if (!bookId) return;
  try { localStorage.setItem(PAGE_KEY_PREFIX + bookId, JSON.stringify({ v: 1, sig, counts })); }
  catch (_) {}
}
```

### 4b. `js/reader/page-counter.js` (the engine)

A class mirroring the style of `PaginationEngine` / `ChromeManager`. Owns:
measuring host lifecycle, the idle measuring pass, the in-memory counts, and the
overall-page math.

```js
import { columnLayout } from './pagination.js';        // shared helper (Phase 0)
import { loadPageCache, savePageCache } from '../core/page-cache.js';

export class PageCounter {
  constructor(state, els, prefs) {
    this.state = state; this.els = els; this.prefs = prefs;
    this._host = null;        // { viewport, clip, content }
    this._idle = null;        // requestIdleCallback handle
    this._onUpdate = null;    // callback to refresh the UI after each measurement
  }

  // ---- signature + cache ----
  computeSignature() { /* §3 */ }

  // Called from finalizeLayout once windowed. Adopt cache if the sig matches,
  // else (re)start the idle pass. Always records the current chapter's exact
  // count first (it's already laid out).
  begin(onUpdate) {
    this._onUpdate = onUpdate;
    const sig = this.computeSignature();
    this.state.pageCountSig = sig;
    const n = this.state.doc.sections.length;
    this.state.pageCounts = new Array(n).fill(undefined);
    this.state.pageCountsComplete = false;

    // current chapter is exact and free
    this.recordCurrent();

    const cached = loadPageCache(this.state.bookId);
    if (cached && cached.sig === sig && cached.counts.length === n) {
      this.state.pageCounts = cached.counts.slice();
      this.state.pageCountsComplete = true;
      if (this._onUpdate) this._onUpdate();
      return;                       // exact from first paint, no measuring
    }
    this._schedulePass();
  }

  // state.total is the exact page count of the live chapter. Capture it.
  // Call this from updateWindowedProgress (every turn/layout) — cheap, no DOM read.
  recordCurrent() {
    const i = this.state.curChap;
    if (this.state.pageCounts && this.state.total > 0) {
      if (this.state.pageCounts[i] !== this.state.total) {
        this.state.pageCounts[i] = this.state.total;
        this._maybeComplete();
      }
    }
  }

  // ---- overall page math (no layout; called on the hot path) ----
  // Returns { page, total, approx }. Unknown chapters use a self-calibrating
  // words-per-page estimate derived from already-measured chapters.
  overall(curChap, pageInChap) { /* §6 */ }

  // ---- idle measuring pass ----
  _schedulePass() { /* requestIdleCallback loop, §5 */ }
  _measureChapter(i) { /* §5 — returns pages (int) */ }
  _maybeComplete() { /* if no undefined left → complete=true, savePageCache(...) */ }

  // ---- invalidation / teardown ----
  invalidate() { /* cancel idle, clear counts, begin() again with fresh sig */ }
  destroy() { /* cancel idle, remove measuring host */ }
}
```

---

## 5. Measuring a chapter without disturbing the reader

Non-current chapters are detached (parentless `el`). We measure them in an
**offscreen host** that reproduces the live content box exactly, so we never
touch the visible chapter.

**Build the host once per pass** (rebuild on `invalidate`, because prefs may have
changed):

```js
buildHost() {
  const { els } = this;
  const vp = els.viewport.cloneNode(false);     // copies margin-* class
  const clip = els.contentClip.cloneNode(false);
  const content = els.content.cloneNode(false); // copies inline styles + para-spaced class
  // size + offscreen
  const box = els.content.getBoundingClientRect();
  vp.style.cssText += ';position:absolute;left:-99999px;top:0;visibility:hidden;contain:strict;';
  vp.style.width  = els.viewport.getBoundingClientRect().width + 'px';
  vp.style.height = els.viewport.getBoundingClientRect().height + 'px';
  content.id = '';                              // avoid duplicate #content
  content.style.setProperty('--page-offset', '0px');
  clip.appendChild(content); vp.appendChild(clip); document.body.appendChild(vp);
  this._host = { viewport: vp, clip, content };
}
```

> `els.contentClip` must be exposed in the `els` map (it's `#contentClip` in the
> template; add it to wherever `els` is built in `reader-app.js` if not already).

**Measure one chapter:**

```js
async _measureChapter(i) {
  if (i === this.state.curChap) return this.state.total;   // live = exact, skip
  const w = this.state.chapWindows[i];
  if (!w || !w.el) return undefined;
  const host = this._host.content;
  host.appendChild(w.el);                                  // move the real el in
  try {
    const vpW = host.getBoundingClientRect().width;
    const { cols, stride } = columnLayout(vpW, this.prefs.data);  // shared helper
    host.style.columnCount = cols === 2 ? '2' : '';
    host.style.columnWidth = cols === 2 ? '' : vpW + 'px';
    host.style.columnGap = COLUMN_GAP + 'px';
    void host.offsetWidth;                                 // force reflow
    await this._awaitImages(w.el);                         // images occupy 0px until decode
    void host.offsetWidth;
    return Math.max(1, Math.round(host.scrollWidth / stride));
  } finally {
    if (w.el.parentNode === host) host.removeChild(w.el);  // back to parentless (marker intact)
  }
}
```

> **Why moving the real `el` is safe:** non-current chapter `el`s are parentless;
> their re-insertion point is the `marker` comment, which we never touch. After
> measuring we `removeChild`, returning `el` to parentless. `attachChap()` later
> re-inserts via the marker exactly as before. We do **not** clone, so doc-model
> word→node refs are untouched (and counting doesn't need them anyway).

**Image decode guard** (`_awaitImages`): images decoded lazily report 0 size and
cause undercounting (the live path fights the same hazard via
`resyncAfterImages`). Await `img.decode()` for any incomplete `<img>` in the
chapter, with a short `Promise.race` timeout (e.g. 500 ms) so a stalled image
can't hang the pass. If `prefs.images` is off (`images-off` class), skip.

**Scheduling** (`_schedulePass`): drive with `requestIdleCallback` (fall back to
`setTimeout(…, 1)` where unavailable). Each callback measures chapters until
`deadline.timeRemaining()` is low, then reschedules. **Order:** measure chapters
`< curChap` first (ascending) so the *current overall page number* becomes exact
fast; then `> curChap` for the total. After each chapter, write
`state.pageCounts[i]` and call `this._onUpdate()` to refresh the label. When no
`undefined` entries remain, set `pageCountsComplete = true`, remove the host, and
`savePageCache(bookId, sig, counts)`.

> Keep the pass **cancelable**: store the idle handle; `invalidate()` and
> `destroy()` cancel it. If `state.windowed` becomes false (mode switch), cancel.

---

## 6. The overall-page math (`overall()`)

No layout, safe on the hot path:

```js
overall(curChap, pageInChap) {
  const counts = this.state.pageCounts || [];
  const secs = this.state.doc.sections;
  // self-calibrating words/page from measured chapters; fallback to a constant
  let measuredPages = 0, measuredWords = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] != null) {
      measuredPages += counts[i];
      measuredWords += (secs[i].wsEnd - secs[i].wsStart);
    }
  }
  const wpp = measuredWords > 0 ? measuredWords / measuredPages : 300; // words/page
  const est = (i) => Math.max(1, Math.round((secs[i].wsEnd - secs[i].wsStart) / wpp));
  const pages = (i) => (counts[i] != null ? counts[i] : est(i));

  let before = 0;
  for (let i = 0; i < curChap; i++) before += pages(i);
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += pages(i);

  const page = before + pageInChap + 1;          // pageInChap is 0-based
  const approx = !this.state.pageCountsComplete;
  return { page, total, approx };
}
```

> Because the current chapter's count is always exact (`recordCurrent`) and we
> measure `< curChap` first, the *page* number stabilises well before the
> *total*. The `~` flag (`approx`) covers the brief window where either is still
> estimated.

---

## 7. Phase-by-phase implementation

### Phase 0 — Extract the shared column helper (no behavior change)
In `js/reader/pagination.js`, factor the column/stride decision out of
`setupColumns()` into an exported pure function and have `setupColumns()` call
it, so the measuring path uses the identical rule:

```js
export function columnLayout(vpW, prefs) {
  const cols = (prefs.columns === "2" || (prefs.columns === "auto" && vpW > 700)) ? 2 : 1;
  return { cols, stride: vpW + COLUMN_GAP };
}
```
Verify the self-test / app still paginate identically.

### Phase 1 — State fields
In `js/core/state.js` constructor, add (with a short comment block matching the
existing windowed-rendering note):
```js
this.pageCounts = [];          // exact pages per section (undefined = unmeasured)
this.pageCountsComplete = false;
this.pageCountSig = "";        // layout signature pageCounts belong to
```

### Phase 2 — New modules
Create `js/core/page-cache.js` (§4a) and `js/reader/page-counter.js` (§4b/§5/§6).
Import `COLUMN_GAP` from `../core/constants.js`.

### Phase 3 — Expose `contentClip` in `els`
Ensure the `els` object built in `reader-app.js` includes
`contentClip: byId("contentClip")` (the element exists in `template.js`).

### Phase 4 — Wire into the lifecycle (`js/reader-app.js`)
1. Instantiate after `pagination`:
   `const pageCounter = new PageCounter(state, els, prefs);`
2. In `finalizeLayout()`, after windowing is set up and the first
   `paginateWindow` has run:
   ```js
   if (state.windowed) pageCounter.begin(updateProgressFn);
   ```
   (Call only in the `shouldWindow()` branch.)
3. In `relayout()`: if windowed, compare `pageCounter.computeSignature()` to
   `state.pageCountSig`; if different, `pageCounter.invalidate()` (which cancels
   any pass and calls `begin` again). If switching *out* of windowed (to scroll),
   `pageCounter.destroy()`.
4. In `updateWindowedProgress()`:
   - call `pageCounter.recordCurrent()` at the top (captures the live chapter's
     exact count for free);
   - compute `const ov = pageCounter.overall(state.curChap, state.page);`
   - set `els.bookSubEl.textContent =
       (ov.approx ? "~" : "") + "Page " + ov.page + " of " +
       (ov.approx ? "~" : "") + ov.total + " · " + pct + "%";`
   - **leave `els.progressLabel` exactly as it is** (chapter · p-in-chapter).
5. On teardown / mode switch (wherever the reader is torn down), call
   `pageCounter.destroy()` so the offscreen host and idle loop don't leak.

### Phase 5 — Docs + tests
- `docs/STATE.md`: document the three new fields under the windowed-rendering
  note. `docs/MODULES.md`: add `page-counter.js` and `page-cache.js`.
  `docs/PERFORMANCE.md`: add a short "Whole-book page numbers" subsection noting
  it's idle-time + cached and off the hot path.
- `js/test/selftest.js`: add windowed-only checks —
  (a) after forcing a full pass, `sum(state.pageCounts)` equals an independent
  re-measure of each chapter; (b) `overall()` returns `page ≥ 1`,
  `page ≤ total`, and exact (`approx === false`) once complete; (c) cache
  round-trip: same `sig` ⇒ counts adopted without a pass.

---

## 8. Edge cases & invariants

- **Scroll mode / small books:** `state.windowed === false` ⇒ feature never runs;
  the existing global "Page X of total" already works there. `bookSub` keeps its
  current behavior in those modes.
- **Cache mismatch:** if `cached.counts.length !== sections.length` (book
  re-extracted differently) or `cached.sig !== sig`, ignore the cache and
  re-measure. Never trust stale counts.
- **Interrupted pass:** if the reader navigates or changes a setting mid-pass, the
  pass is canceled; numbers stay on the estimate until a new pass completes. The
  partial cache is **not** written (only write on full completion).
- **Resize/rotate:** changes width and/or height ⇒ new signature ⇒
  `invalidate()` ⇒ fresh pass (debounced through `relayout`). A separate cache
  entry is effectively keyed by that signature.
- **Font swap (e.g. OpenDyslexic via `font-display:swap`):** `finalizeLayout`
  already awaits `document.fonts.ready` before the first paginate, so the first
  signature is computed against final metrics. The pass runs after that.
- **No layout on the hot path:** `overall()` is pure arithmetic over arrays;
  `recordCurrent()` reads `state.total` (already computed). No
  `getBoundingClientRect` per turn.
- **Memory:** the pass attaches at most **one** extra chapter at a time (into the
  offscreen host) and removes it immediately, preserving the windowing memory
  win. The host itself is one empty subtree, removed on completion/teardown.

---

## 9. Optional follow-up (NOT for v1): parallel worker estimates

True page counts require browser layout, which only exists on the main thread —
**Web Workers have no DOM**, so they cannot measure pages. They *can* run
`OffscreenCanvas.measureText`, so a worker could simulate line-breaking/column-
fill to produce a *better* estimate than word-fraction, fanned out across
`navigator.hardwareConcurrency` workers (one chapter each). This only improves
the transient estimate; the exact numbers still come from the idle main-thread
pass and are cached after the first run. Given the idle pass is fast and
one-time-per-format, **skip this for v1** — the self-calibrating words/page
estimate in §6 is enough to bridge the gap. Revisit only if huge books show a
visibly long "~" period.

---

## 10. Files touched (checklist)

- [ ] `js/reader/pagination.js` — export `columnLayout`, refactor `setupColumns`
- [ ] `js/core/state.js` — add `pageCounts`, `pageCountsComplete`, `pageCountSig`
- [ ] `js/core/page-cache.js` — **new**, persistence
- [ ] `js/reader/page-counter.js` — **new**, engine (signature, host, pass, math)
- [ ] `js/reader-app.js` — expose `contentClip` in `els`; instantiate
      `PageCounter`; wire `finalizeLayout` / `relayout` / `updateWindowedProgress`
      / teardown
- [ ] `docs/STATE.md`, `docs/MODULES.md`, `docs/PERFORMANCE.md` — document it
- [ ] `js/test/selftest.js` — windowed page-count + cache tests
