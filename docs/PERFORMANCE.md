# Performance

How the app stays fast, the baseline that drove the work, and the changes that
landed from the performance & architecture refactor (`plans/performance-refactor.md`).

## Instrumentation

`js/core/perf.js` wraps the User Timing API (`mark` / `measure` / `time` /
`timeAsync`). It is a **no-op unless the page is loaded with `?perf=1`** — zero
cost on a normal load. When enabled it shows an on-screen panel (bottom-/top-left)
with avg/min/max/count per span and a **Copy** button (Markdown table) and
**Reset**; `window.__perf.report()` / `.markdownTable()` / `.reset()` do the same
from the console.

Key spans: `reader:extract` · `reader:render` · `reader:annotate` · `doc-model` ·
`reader:paginate` · `page-turn` (synchronous JS of a turn) · `turn-latency`
(input → next painted frame — the *felt* cost) · `mode-switch` ·
`session:extract` / `session:images` · `rsvp:*` / `tts:*`.

## Baseline (Phase 0)

Captured on the owner's device, book **Pawn of Prophecy** (~505 KB EPUB). Avg ms.

| Operation | Before |
|-----------|-------:|
| `reader:extract` | 64.7 |
| `reader:render` | 4.0 |
| `reader:annotate` | 20.1 |
| `doc-model` | 14.7 |
| `reader:paginate` (initial) | 41.4 |
| **`mode-switch`** (Reader→RSVP/TTS) | **388.5** (142–544) |
| **`page-turn`** (sync JS, avg / max) | **0.2 / 0.8** |
| **`turn-latency`** (input→paint, avg / max) | **1307.9 / 2621.8** |

**Headline finding:** the felt "2+ second page turn" was **100 % layout/paint**,
not JavaScript — the whole book was laid out as one giant multi-column element
and re-rasterised on every turn. The second big cost was `mode-switch`, almost
entirely re-parsing/re-extracting the same EPUB once per mode.

## What changed

### Windowed rendering (Phase 6, shipped as default)

Only the current chapter (`.chap`) is attached to the DOM; the rest are detached
into comment-marker placeholders, so the browser lays out/paints a fraction of
the book per turn. The global doc-model is built once at load while all chapters
are attached, so search, bookmarks and canonical position still work off the
global model; navigation goes through a section-aware seek that attaches the
target chapter on demand.

- **`turn-latency` 1308 ms → 21 ms (~62×)**, measured with the `?window=1`
  diagnostic before it became the default.
- Scroll layout can't be windowed (it needs the whole book in one flow) and
  falls back to full render automatically.
- Small books (< `WINDOW_MIN_WORDS`, or a single chapter) render whole and skip
  the per-chapter-boundary relayout overhead.

### Session cache — no re-parse on mode switch (Phase 1)

`core/book-session.js` parses + extracts + resolves images **once** per book;
`mode-switcher.js` caches the `BookSession` and hands the same object to each
mode on switch. A switch now costs *render + paginate only* — with `?perf=1`,
`session:extract` fires **zero** times on a switch (it shows up only on the
initial load). Reading Reader → RSVP → TTS parses the EPUB once, not three times.

### Shared core + faster search (Phase 2)

Duplicated render/annotate and full-text search were extracted to
`shared/render.js` and `shared/search.js`. Search hit resolution was
O(hits × words) (a linear scan of the char-start array per hit, ~20M comparisons
per keystroke on a 100k-word book); it is now a **binary search** (`indexForOffset`)
— effectively instant.

### Service worker + deferred libraries (Phase 4)

`sw.js` precaches the shell + CDN libraries and serves cache-first, so repeat
loads are instant and the app works offline. The `jszip` / `epub.js` libraries
load **deferred** instead of render-blocking, so first paint no longer waits on
jsdelivr. Cache busting is handled by the versioned SW cache, which **retired**
the deploy step that rewrote every JS import path with `?v=hash`. See
`docs/ARCHITECTURE.md` → *Service Worker*.

### Whole-book page numbers (idle-measured, cached)

In windowed mode the reader previously showed only "Chapter N · p3 of 18" (page
within the current chapter) because other chapters have no layout — their page
counts are unknown. The new `PageCounter` adds a whole-book "Page 247 of 980 · 25%"
label in the subtitle without impacting the page-turn hot path:

- **On the hot path (every page turn):** `recordCurrent()` reads `state.total` (already
  computed by `paginateWindow`) and `overall()` does pure array arithmetic — no DOM access,
  no `getBoundingClientRect`.
- **Idle pass:** chapters are measured one at a time using `requestIdleCallback`, each in an
  offscreen host that mirrors the live content box. At most one extra chapter is attached to
  the DOM at a time (removed immediately after measuring), preserving the windowing memory win.
  The host is removed entirely once all chapters are measured.
- **Caching:** counts are saved to `localStorage` keyed by a layout signature (width, height,
  font, size, columns, …). On subsequent opens with the same layout the cached counts are used
  immediately — no measuring pass runs, and the label shows exact numbers from the first paint.
- **Estimate while measuring:** unmeasured chapters use a self-calibrating words/page ratio
  from already-measured chapters; the "~" prefix on the label disappears once all counts are
  confirmed. Resize or pref change triggers `invalidate()` → new signature → fresh pass
  (debounced through `relayout`).

## Capturing after-numbers

The headless CI/agent environment can't run a browser (no browser installed; the
CDN libs are network-blocked there), so re-capture against the sample books in a
real browser: serve the repo (`python3 -m http.server`), open
`reader.html?perf=1`, open a book, turn pages, switch modes, then **Copy** the
panel table. The windowing win (`turn-latency`) and the mode-switch win (no
`session:extract` on switch) are the two figures to confirm.
