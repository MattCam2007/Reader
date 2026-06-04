# Performance & Architecture Refactor Plan

**Author:** Staff Engineer (inherited ownership)
**Date:** 2026-06-03
**Status:** Proposed — awaiting review before execution
**Scope:** `js/`, `css/`, `*.html`, `docs/`. One focused refactor pass before the next feature wave.

> **Reviewer note (2026-06-03):** The owner confirmed the felt symptom is specifically
> **page turns in Reader mode** (not mode switches or cold load). **Phase 3 (reflow-free
> page turns) is therefore the most direct fix and should be promoted ahead of Phases 1–2
> when execution starts.** Phase 3 depends only on Phase 0 (instrumentation), so it can run
> immediately after baselining. Phases 1, 2, 4 remain high-value but address adjacent
> latencies (mode switches, search, cold load) rather than the primary complaint. Suggested
> execution order: **0 → 3 → 1 → 2 → 4 → 5 → 8 → 7 → 6**, with Phase 9 continuous.

---

## 0. TL;DR

The app is slow because **the entire book is processed end-to-end on every load, and the
whole pipeline is re-run from scratch on every mode switch.** There is no caching layer
(no service worker, no in-memory extraction cache), and three near-identical app files
(2,514 lines) duplicate rendering, search, position, theme, and panel logic.

This plan attacks the problem in two tracks:

- **Track A — Performance:** cache the mode-agnostic extraction, stop re-parsing on mode
  switch, lazy/windowed rendering for large books, eliminate forced reflows on page turn,
  add a service worker, and defer the CDN libraries. Target: **sub-300 ms mode switches and
  page turns that never block the main thread.**
- **Track B — Architecture/DRY:** extract the duplicated rendering/search/position/theme
  code into shared modules, collapse the three app shells onto one `BaseReaderApp`, fold
  the `library.html` monolith into the module system, and refresh the docs to match.

The two tracks are sequenced so performance wins land first and de-risk the structural
work. Every phase is independently shippable and reversible.

---

## 1. What the app is (so we refactor toward its goals, not away)

A **client-side, build-stepless EPUB reader PWA** in vanilla ES modules. Three reading modes
share one entry point and one canonical reading position:

- **Reader** — paginated multi-column layout, full typography controls, search, footnotes,
  selection, bookmarks.
- **RSVP** — word-at-a-time speed reading with ORP alignment, chunking, training ramp.
- **TTS** — `SpeechSynthesis` playback with word/sentence/paragraph highlighting.

A bookshelf (`library.html`) links into the reader with `?src=&id=&title=`.

**Design tenets we must preserve** (they are genuinely good):
- No build step; modules load directly; everything debuggable in DevTools.
- No global state; each mode is a class-instance scoped to an `init()` call.
- Lifecycle via `AbortController` — one signal tears a mode down cleanly.
- **Word-level canonical position** (`{href, wordInSec, ord, f, t}`) survives font/column
  changes, rotation, repagination, and mode switches. This is the crown jewel and the
  refactor must not regress it.

The refactor's job is to make the app *fast and DRY* **without** sacrificing
no-build-step / no-global-state / portable-position.

---

## 2. Root-cause performance analysis

> These findings come from reading the code paths end-to-end, not from a profiler run.
> Phase 0 below adds instrumentation so we replace "high-confidence inference" with numbers
> before and after each change. The causal chains, however, are unambiguous from the source.

### 2.1 The whole-book pipeline (the dominant cost)

Loading a book runs **five passes over the entire book**, every one O(total content):

| Pass | Location | What it does over the *whole book* |
|------|----------|-----------------------------------|
| 1. Extract | `epub/extractor.js: extractSections` (`reader-app.js:529`) | `await section.load()` + DOM-walk every spine item via `BLOCK_SEL`/`SKIP_SEL`, sanitize inline HTML for every block |
| 2. Render | `reader-app.js: renderBook` (`:405`) | Build a DOM node for every block of every section into one `.content` tree |
| 3. Annotate | `reader-app.js: annotateInlineText`/`annotateBlock` (`:439`) | Walk **every text node** in **every block**, split on `["“”.,:;!?—–…()[]]` and wrap each punctuation mark/quote in its own `<span>`. A 150k-word novel balloons to **hundreds of thousands of extra span nodes.** |
| 4. Doc model | `model/doc-model.js: buildDocModel` (`pagination.js:68`) | Create a `{node,start,end,block,section}` object for **every render token** + parallel arrays `wordCharStart`, `tokenToWs`, `wsToToken`, plus a full `doc.text` string |
| 5. Paginate | `reader/pagination.js: paginate` (`:36`) | Force layout of the giant multi-column tree and read `content.scrollWidth` (`:65`) to count pages |

Passes 3 and 4 are the silent killers: annotation **inflates the node count several-fold**,
which makes *every subsequent layout, reflow, and `getBoundingClientRect` more expensive for
the life of the session* — including page turns (see 2.3).

### 2.2 Re-extraction on every mode switch (the most wasteful cost)

`mode-switcher.js` caches only the raw bytes:

```js
function onBookLoaded({ buffer, fileName }) {
  cachedBook = { buffer: buffer.slice(0), fileName };   // js/mode-switcher.js:35
}
```

On a mode switch it hands those bytes to the new mode's `loadFromBuffer` →
`loadEpub` (`reader-app.js:763`, `rsvp-app.js:711`, `tts-app.js:1025`), which **re-runs
`ePub(buffer)`, `await book.ready`, and `extractSections` from scratch.** The mode-agnostic
`sections` array — the expensive part — is recomputed and thrown away each time.

Net effect: a user who reads a chapter, tries RSVP, then tries TTS **parses and extracts the
same EPUB three times.** On a large book this is the multi-second stall between modes.

RSVP compounds it: `sectionsToText` (`rsvp-app.js:21`) re-derives word offsets with its own
`split(/\s+/)` counting, a *third* independent word-counting implementation (alongside
`doc-model`'s whitespace counter and TTS's `segmentContent`). They must agree exactly or
cross-mode position drifts — a fragility the code comments openly worry about.

### 2.3 Page turns are not as cheap as they look

`goTo` (`pagination.js:170`) sets a CSS transform — fast in isolation. But on every turn it
also calls `updateProgressFn` → `chrome.updateProgress()` **and**
`chrome.updateBookmarkMarkers(...)` (rebuilds marker DOM), then `savePosMain` →
`getCanonicalPosition` → `currentWsOrdinal` → `wordAtPageStart` (`geometry.js:25`), a binary
search that calls `getBoundingClientRect` O(log n) times. On the annotation-inflated DOM
(2.1), each of those measurements can trigger a forced synchronous layout. The result is
input-to-paint latency that scales with book size — exactly the "sluggish between pages"
symptom.

### 2.4 Search is O(hits × words)

`reader/search.js:51-55` (and the duplicated copies in `rsvp-app.js:351` and
`tts-app.js:818`) resolve each hit to a word by **linear-scanning `wordCharStart` from index
0** — up to `MAX_SEARCH_HITS` (200) × N words. On a 100k-word book that's ~20M comparisons
per query keystroke. `wordCharStart` is sorted; this must be a binary search.

### 2.5 No caching layer / render-blocking CDN

- **No service worker exists** (despite `README` and `ARCHITECTURE.md` describing a PWA).
  Nothing is cached; every visit re-downloads all modules and the CDN libs.
- `reader.html:10-11` loads `jszip` and `epub.js` as **render-blocking `<script>` in
  `<head>`** from `cdn.jsdelivr.net`. First paint waits on third-party network.
- The deploy workflow (`/.github/workflows/deploy.yml`) regex-rewrites the import path of
  *every* `.js` file to append `?v=HASH` for cache-busting. This brittle source-rewriting
  hack exists *only because* there's no service-worker versioning. A real SW makes it
  unnecessary.

### 2.6 Eager full-book work that only a window ever uses

- RSVP `tokenize` (`rsvp/tokenizer.js`) builds 7 parallel arrays for the entire book at
  load, though only ~1 word is shown at a time.
- TTS `segmentContent` (`tts-app.js:319`) splits sentences and `surroundContents`-wraps
  spans for **every** sentence in the book up front, mutating the whole DOM.
- `document.fonts.ready` is awaited before the *first* pagination (`reader-app.js:557`),
  adding cold-load latency on top of the pipeline.

---

## 3. Target architecture

The shape stays vanilla and build-stepless. We add three things: a **book pipeline cache**,
a **shared render/position core**, and a **service worker**. We collapse three app shells
into one base class.

```
                         ┌────────────────────────┐
                         │      mode-switcher      │  boot · switch · teardown
                         └───────────┬────────────┘
                                     │ holds
                         ┌───────────▼────────────┐
                         │      BookSession        │  NEW: owns the parsed book +
                         │  { sections, docText,   │  extracted, mode-agnostic data.
                         │    images, toc, bookId } │  Built ONCE, shared by all modes.
                         └───────────┬────────────┘
                 ┌───────────────────┼───────────────────┐
        ┌────────▼───────┐  ┌────────▼───────┐  ┌────────▼───────┐
        │   ReaderApp    │  │    RsvpApp     │  │    TtsApp      │  thin: only
        │  extends Base  │  │  extends Base  │  │  extends Base  │  mode-specific UI
        └────────┬───────┘  └────────┬───────┘  └────────┬───────┘
                 └───────────────────┼───────────────────┘
                         ┌───────────▼────────────┐
                         │   BaseReaderApp (NEW)   │  shared: panels, theme, font,
                         │   + shared/render.js    │  bookmarks, search, position
                         │   + shared/search.js    │  plumbing, OS-pref fallback,
                         │   + core/position.js    │  file-input + mode buttons
                         └─────────────────────────┘
                         ┌─────────────────────────┐
                         │   sw.js (NEW)           │  cache app shell + CDN libs;
                         │                         │  offline; versioned by hash
                         └─────────────────────────┘
```

**Key invariant:** `BookSession` produces the `sections` array *once*. Reader builds its
doc-model from it, RSVP derives tokens from it, TTS segments from it — all from the same
in-memory structure, with **one** word-counting implementation shared by all three.

---

## 4. The plan, in phases

Each phase: **goal · changes · effort · risk · how we verify.** Effort is rough dev-days.
Phases are ordered so the biggest wins come first and each is shippable on its own.

### Phase 0 — Instrumentation & baseline *(0.5d, no risk)*
**Goal:** Replace inference with numbers; prove every later win.
- Add a tiny `core/perf.js` (`perf.mark`/`measure` wrappers, no-op unless `?perf=1`) and
  instrument: extract, render, annotate, doc-model, paginate, mode-switch, page-turn.
- Capture a baseline table for a small / medium / large EPUB (e.g. a Sanderson novel from
  `books/`).
**Verify:** Baseline numbers committed to this doc's appendix.

### Phase 1 — Cache the extraction; kill re-parse on mode switch *(2d, low risk, HUGE win)*
**Goal:** Switching modes never re-parses or re-extracts the book.
- Introduce `BookSession` (`js/core/book-session.js`): owns `{ book, sections, allImgUrls,
  resolvedBlobUrls, toc, bookId, fileName }`. Built once by whichever mode first loads the
  buffer.
- `mode-switcher` caches the `BookSession`, not just bytes. `loadFromBuffer(session)` accepts
  an already-extracted session and **skips** `ePub()`/`extractSections` when one is present.
- Each mode consumes `session.sections` instead of calling `extractSections` itself.
- Collapse the three word-counting paths (`doc-model` whitespace counter, `sectionsToText`,
  `segmentContent`) onto **one** `countWords(sections)` utility so cross-mode position math
  has a single source of truth.
**Risk:** Position handoff must stay word-exact. Mitigated by the existing self-test +
new round-trip assertions (Phase 9).
**Verify:** Mode-switch time drops to "render + paginate only" (no extract). `?perf=1`
shows zero `extractSections` calls on switch. Cross-mode position self-test green.

### Phase 2 — Extract shared render/annotate/search core *(2d, low risk, big DRY win)*
**Goal:** Delete ~600 lines of verbatim duplication; one place to optimize.
- `renderBook` + `annotateInlineText` + `annotateBlock` are **identical** in `reader-app.js`
  (`:405-508`) and `tts-app.js` (`:425-527`). Extract to `js/shared/render.js`.
- Extract the duplicated full-text search (`reader/search.js`, `rsvp-app.js:317-380`,
  `tts-app.js:783-844`) into `js/shared/search.js` with a pluggable "resolve hit → seek"
  callback.
- Fix the O(hits×words) scan here once: binary search over `wordCharStart`
  (reuse `lastIndexAtMost` from `rsvp/tokenizer.js`).
**Risk:** Low — pure code movement + one algorithmic fix, covered by self-test.
**Verify:** Line count drops; search self-test green; search on a large book is instant.

### Phase 3 — Make page turns reflow-free *(1.5d, low risk, fixes the literal complaint)*
**Goal:** Page turn = one transform + cheap state update. No synchronous layout on the hot path.
- Cache word→page mapping after pagination (a `pageStarts[]` array of word ordinals per
  page) so `wordAtPageStart`/`pageOfWord` become array lookups, not `getBoundingClientRect`
  binary searches, on the turn path.
- Defer `savePos` and `updateBookmarkMarkers` to `requestIdleCallback`; only `updateProgress`
  runs synchronously on a turn.
- Recompute bookmark markers only when the bookmark set changes, not on every turn.
**Risk:** Cache must invalidate on repaginate/resize — wire to the existing `paginateGen`.
**Verify:** `?perf=1` page-turn measure has no layout thrash; turns stay <16ms on the
largest sample book.

### Phase 4 — Service worker + defer CDN libs *(1.5d, low risk)*
**Goal:** Instant repeat loads, offline support, no render-blocking third-party scripts.
- Add `sw.js`: precache the app shell (HTML/CSS/JS/icons/fonts) and the two CDN libs;
  cache-first for the shell, stale-while-revalidate for books fetched by `?src=`.
- Self-host (or SW-precache) `jszip` and `epub.js`; load them deferred/async instead of
  render-blocking in `<head>`.
- Version the cache by the same commit hash the deploy workflow already computes; **retire
  the per-file import-path rewriting** in `deploy.yml` in favor of SW versioning.
**Risk:** SW caching bugs strand users on stale builds — mitigate with hash-versioned cache
names + `skipWaiting`/`clients.claim` and an update toast.
**Verify:** Lighthouse PWA/installable + offline reload works; first paint no longer waits
on jsdelivr.

### Phase 5 — Collapse three app shells onto `BaseReaderApp` *(3d, medium risk, biggest DRY win)*
**Goal:** One shell owns everything mode-agnostic; mode files shrink to mode-specific logic.
- Create `js/base-reader-app.js` owning: panel open/close + `aria-expanded`, theme apply,
  font apply, OS-preference fallback, bookmark-panel wiring, file-input + mode-switch
  buttons, the `loadEpub`/`loadFromBuffer` skeleton, and the canonical-position
  save/restore plumbing (currently re-implemented in all three apps:
  `reader-app.js:133-216`, `rsvp-app.js:650-697`, `tts-app.js:714-757`).
- `reader-app`/`rsvp-app`/`tts-app` keep only: their template, their render/segment step,
  their `getCanonicalPosition`/`applyCanonicalPosition` bodies, and their input handler.
- Move `rsvp/constants.js` and `tts/constants.js` magic numbers under namespaced exports in
  `core/constants.js` (the docs already flag this).
**Risk:** Medium — touches all three entry points. Do it *after* Phases 1–2 so the shared
pieces already exist; land mode-by-mode behind the self-test.
**Verify:** ~700–900 fewer lines across the three apps; all modes behave identically; full
self-test + manual smoke of each mode + mode switches green.

### Phase 6 — Windowed rendering for large books *(3–4d, medium/high risk, scales the ceiling)*
**Goal:** Stop forcing the whole book through render/annotate/layout at once.
- **Lazy annotation:** annotate blocks on demand (as sections enter the viewport / current
  ±1 section), not the whole book in `renderBook`. This removes the worst node-inflation
  cost from the load path.
- **Section-windowed pagination:** generalize the existing `paginateQuick` detach trick
  (`pagination.js:84`) into the *primary* layout path — keep only current ±1 sections
  attached, estimate total pages from per-section measurements. The machinery already
  exists; promote it from a resize optimization to the default.
- TTS: segment/`surroundContents` only the current ±1 section; segment lazily on seek.
- RSVP: keep eager tokenize (it's plain-text and cheap relative to DOM), but build it from
  the cached `session.sections` (Phase 1) instead of re-deriving.
**Risk:** Highest in the plan — page-count estimation and position mapping must stay exact
across the window boundary. Gate behind a flag; fall back to full-book render for small
books (below a word threshold) where it isn't needed.
**Verify:** Largest sample book loads in a fraction of current time; position round-trips
across window boundaries in the self-test; visual scrub from 0→100% lands correctly.

### Phase 7 — Fold `library.html` into the system *(2d, low/medium risk)*
**Goal:** Remove the 814-line monolith's duplicated theme tokens and stale storage keys.
- Replace its inline `<style>` theme block with the shared `tokens.css` (it currently
  redefines the same custom properties — see `docs/CSS.md`).
- Extract its inline JS into `js/library/` modules; read progress from the **canonical**
  `book:pos:{bookId}` key (it currently reads a stale `reader:pos:` key, so RSVP/TTS-only
  progress never shows).
- Share the theme-apply + meta-color logic with `BaseReaderApp`.
**Risk:** Low/medium — it's isolated, but it's the least-tested surface.
**Verify:** Library themes match reader exactly; progress bars reflect any mode's position.

### Phase 8 — CSS hygiene *(1d, low risk)*
**Goal:** Kill the issues `docs/CSS.md` already lists.
- Namespace RSVP component classes (`.rsvp-*`) to remove collision risk with reader classes.
- Replace JS-set inline styles + the `!important` scroll-mode override with CSS custom
  properties / `@layer`.
- Hoist the hardcoded ORP `35%` to a `--orp-position` token.
**Verify:** No visual diffs; grep shows no `!important` in the reading surface; no
unprefixed shared class names.

### Phase 9 — Tests & docs refresh *(1.5d, low risk, ships with every phase)*
**Goal:** Keep the safety net and the docs honest.
- Extend `js/test/selftest.js`: cross-mode position round-trip (Reader↔RSVP↔TTS), windowed
  pagination boundary, shared-search hit resolution, `BookSession` cache reuse.
- Update `docs/ARCHITECTURE.md`, `MODULES.md`, `DATA-FLOWS.md`, `STATE.md`, `CSS.md` to
  describe `BookSession`, `BaseReaderApp`, the shared render/search modules, and the SW.
  Remove the "library excluded from docs" caveat once Phase 7 lands.
- Add a one-page `docs/PERFORMANCE.md` with the before/after numbers from Phase 0.

---

## 5. Sequencing & dependencies

```
Phase 0 (baseline)
   └─► Phase 1 (session cache) ──► Phase 5 (BaseReaderApp) ──► Phase 6 (windowing)
   └─► Phase 2 (shared render/search) ──┘
   └─► Phase 3 (reflow-free turns)        Phase 7 (library)  depends on 5
   └─► Phase 4 (service worker)           Phase 8 (css)      independent
Phase 9 (tests/docs) runs continuously alongside all phases.
```

Phases 1–4 are the **performance track** and deliver the felt speedup; ship them first.
Phases 5–8 are the **architecture track**; they depend on the shared pieces from 1–2.

**Estimated total:** ~18–20 dev-days. The first ~7 days (Phases 0–4) should resolve the
"2+ seconds" complaint; the rest hardens and de-duplicates.

---

## 6. Risks & guardrails

- **Canonical position is sacred.** Every phase that touches extraction, counting, render,
  or pagination must pass the cross-mode round-trip self-test before merge. This is the one
  thing that, if broken, silently corrupts every user's reading position.
- **No-build-step is non-negotiable.** Everything stays as directly-loadable ES modules; no
  bundler creeps in.
- **Windowing (Phase 6) is the only high-risk item.** It's flagged, gated behind a flag,
  and falls back to full render for small books. If it slips, Phases 1–5 still deliver most
  of the win.
- **Reversibility:** each phase is its own PR with the self-test as the gate; nothing is a
  big-bang rewrite.

---

## 7. Explicitly out of scope (for this pass)

- Migrating off epub.js, or a new EPUB parser.
- A bundler / TypeScript / framework adoption.
- New reading features (the whole point is to clean up *before* the next feature wave).
- Server-side anything — the app stays fully client-side.

---

## Appendix A — Baseline measurements

### A.1 Instrumentation (Phase 0 — landed)

`js/core/perf.js` provides `mark`/`measure`/`time`/`timeAsync` wrappers around the
User Timing API. **They are a no-op unless the page is loaded with `?perf=1`** — zero
cost on a normal load. When enabled, every span (a) emits a `performance.measure` so it
shows on the DevTools Performance track, (b) logs a dimmed `⏱ label Xms` console line,
and (c) is recorded for a labelled summary table via `window.__perf`.

Spans wired in this phase (label → operation):

| Span label | Operation | Source |
|------------|-----------|--------|
| `reader:extract` | Pass 1 — `extractSections` (Reader) | `reader-app.js` |
| `reader:render` | Pass 2 — build the `.content` DOM tree | `reader-app.js: renderBook` |
| `reader:annotate` | Pass 3 — `annotateInlineText` (punctuation spans) | `reader-app.js: renderBook` |
| `doc-model` | Pass 4 — `buildDocModel` | `reader/pagination.js: paginate` |
| `reader:paginate` | Pass 5 — initial `paginate(false)` (layout + `scrollWidth`) | `reader-app.js: loadEpub` |
| `page-turn` | `next()`/`prev()` **synchronous JS** only (transform + progress + savePos) | `reader/pagination.js` |
| `turn-latency` | **Input → next painted frame** for a turn (tap/swipe/key; meta `{via,dir}`) — the *felt* cost, incl. layout/paint | `reader/input.js` |
| `mode-switch` | Whole `switchMode` incl. teardown + `loadFromBuffer` (meta `{from,to}`) | `mode-switcher.js` |
| `rsvp:extract` / `rsvp:sectionsToText` / `rsvp:tokenize` | RSVP load pipeline | `rsvp-app.js` |
| `tts:extract` / `tts:render` / `tts:annotate` / `tts:segment` | TTS load pipeline | `tts-app.js` |

### A.2 How to capture the baseline

> ⚠️ **Not captured in the CI/agent environment.** The app loads `jszip` + `epub.js` from
> `cdn.jsdelivr.net`, which is network-blocked here (HTTP 403), and no browser is installed,
> so a real EPUB can't be parsed. Capture these numbers from a normal browser session
> against the sample books below, then paste them into A.3.

Suggested sample books (already in `books/`):
- **Small** — `books/Battletech/14 - Robert Thurston - Bloodname (1991).epub` (~256 KB)
- **Medium** — `books/Brandon Sanderson/Mistborn/02 - ... The Well of Ascension (2007).epub` (~716 KB)
- **Large (Sanderson)** — `books/Brandon Sanderson/Mistborn/01 - ... The Final Empire (2006).epub` (~1.1 MB)

Procedure (repeat per book):
1. Serve the repo (`python3 -m http.server` from the repo root) and open
   `reader.html?perf=1` in the browser. A small **perf panel** appears bottom-right;
   no DevTools console is needed.
2. Open the file (folder icon) and pick the sample `.epub`. The load pipeline spans
   (`reader:extract` → `reader:paginate`) fill in the panel as they run.
3. Turn a few pages (←/→ or tap) to populate `page-turn`.
4. Switch to RSVP, then TTS (the bottom mode buttons) to populate `mode-switch`,
   `rsvp:*`, `tts:*`.
5. Tap **Copy** on the panel — it puts a Markdown table (avg/min/max/count per op) on
   the clipboard. Paste it into A.3. Record the **avg** (and note the max for `page-turn`).
6. Tap **Reset** on the panel between books to isolate runs.

(For anyone who *does* have a console, `__perf.report()` / `__perf.markdownTable()` /
`__perf.reset()` do the same.)

For **cold vs. warm load**: cold = first DevTools "Disable cache" + hard reload; warm =
normal reload. (Warm/SW row stays empty until Phase 4 adds the service worker.)

### A.3 Results (paste captured numbers here)

| Operation | Small EPUB | Medium | Large (Sanderson) |
|-----------|-----------|--------|-------------------|
| `reader:extract` | — | — | — |
| `reader:render` | — | — | — |
| `reader:annotate` | — | — | — |
| `doc-model` | — | — | — |
| `reader:paginate` (initial) | — | — | — |
| **`mode-switch` (Reader→RSVP)** | — | — | — |
| **`page-turn`** (sync JS, avg / max) | — | — | — |
| **`turn-latency`** (input→paint, avg / max) | — | — | — |
| Cold load (no SW) | — | — | — |
| Warm load (with SW) | — | — | — |
