# Stewardship Plan — Engineering Review & Upgrade Roadmap

**Date:** 2026-06-12
**Scope:** Full-codebase review (quality, efficiency, efficacy, security) and the
prioritized modifications I want to land before taking ownership of this codebase.
**Ground rules:** every existing feature is preserved; no visible UI/UX changes;
refactoring, upgrading, and rearchitecting only. UX/product suggestions are
collected in §8 as recommendations, not work items.

---

## 0. Executive summary

This is a genuinely well-built client-side reading app. The performance refactor
(plans/performance-refactor.md, Phases 0–8 shipped) took page turns from ~1.3s to
~20ms via chapter windowing, mode switches share one parsed `BookSession`, event
lifecycle is leak-free via AbortController signals, and the HTML sanitizer for
untrusted EPUB content is structurally sound (allowlist tags/attrs, no innerHTML
of book data, no book CSS). The architecture docs are accurate and current.

The gap between "basically works" and "premium" is concentrated in three places:

1. **Position integrity.** The app has an excellent canonical position system
   (`js/core/position.js`) — section-href-anchored word ordinals with a text-snippet
   exact snap — but several call sites still bypass it with the older
   *fraction-of-book* scalar, and several geometric measurements have timing or
   transform hazards. Every "I had to hunt for where I was" report traces to one
   of these bypasses. **Workstream A** eliminates the fraction as a navigation
   currency everywhere a word ordinal exists.

2. **Security hardening.** Sanitization is solid, but four real gaps exist, one of
   them an actual XSS vector (`javascript:` URLs in book anchors). All are small,
   surgical fixes. **Workstream B.**

3. **Verification.** The selftest suite is browser-only and doesn't cover the
   invariants that matter most (cross-mode position round-trips, windowed
   boundaries, scroll restore). Premium accuracy needs regression protection.
   **Workstream C.**

Performance itself needs almost nothing — the hot paths are already lean and the
remaining items are instrumentation hygiene (§ Workstream D).

---

## 1. How the system works today (orientation)

This section is the mental model the rest of the plan builds on. Existing docs
(ARCHITECTURE.md, DATA-FLOWS.md, STATE.md) cover this in depth; this is the
position-and-measurement slice that the upgrade work touches.

### 1.1 One parse, three modes

`js/core/book-session.js` parses a file once (via the format adapter registry,
`js/formats/`) into sections of sanitized DOM fragments plus resolved image blob
URLs. Reader (`reader-app.js`), TTS (`tts-app.js`), and RSVP (`rsvp-app.js`) are
independent shells that render the same session. `js/mode-switcher.js` tears one
down (flushing position), aborts its listeners, and boots the next, passing the
canonical position object directly — no storage race.

### 1.2 The doc model: two word coordinate systems

`js/model/doc-model.js` walks the rendered blocks and builds:

- **render tokens** (`doc.words[]`) — the annotator splits punctuation into
  separate spans, so "world." is two tokens. These map 1:1 to measurable DOM
  ranges (`wordRange`, geometry.js:36).
- **whitespace words** — what a human (and TTS/RSVP) counts. Mappings
  `doc.wsToToken[]` / `doc.tokenToWs[]` convert between the two.

Whitespace ordinals are the *shared currency* across modes; render tokens are the
*measurement handle* inside the reader. Most historical position bugs are unit
confusion between these two systems and the legacy fraction.

### 1.3 The canonical position object

`buildPosition()` (position.js:103) produces:

```js
{ href,            // section spine href — stable anchor across modes
  wordInSec,       // ws-word offset within that section
  secWords, ord, words,
  f,               // fraction — coarsest fallback, legacy compat
  t: [...8 words]  // normalized snippet for the exact text snap
}
```

`resolvePosition()` (position.js:155) resolves in four steps: href match →
global-ordinal rescale → fraction → `refineByText()` snap (±600-word search
requiring ≥60% snippet match). When the full pipeline is used, restores are
word-exact. When a call site shortcuts to `f`, restores drift with word density.

### 1.4 Geometry: how a word becomes a page or a scroll offset

- Paginated: CSS columns; `state.stride` = column width + gap;
  `pageOfWord()` (geometry.js:45) = word rect's x-offset ÷ stride, de-scaled by
  `layoutScale()` because the viewport carries a `scale()` transform while chrome
  bars are visible (content.css:19).
- `wordAtPageStart()` (geometry.js:65) binary-searches `pageOfWord` to find the
  first token on a page — O(log n) rect reads, the reverse mapping.
- Scroll: native scrolling; `currentLocator()` (geometry.js:99) binary-searches
  word rect tops against the viewport top.
- Windowed mode (books > `WINDOW_MIN_WORDS`): only the current chapter is
  attached; detached chapters keep live node references, so the doc model and
  search keep working. Seeks attach the target chapter first (seekToToken,
  reader-app.js:238).

### 1.5 Save/restore paths (the part Workstream A unifies)

| Path | Mechanism | Word-exact? |
|---|---|---|
| Reader paginated save | `wordAtPageStart` → first whole ws-word at top of page (reader-app.js:317) | ✅ |
| Reader scroll save | `currentLocator` → word *nearest* viewport top | ⚠️ nearest-by-abs can pick a cut-off line (A3) |
| Reader paginated restore | `applyCanonicalPosition` → `seekToToken` → `pageOfWord` | ✅ |
| Reader scroll restore (stored pos) | `seekToToken` → `scrollToWord` (pagination.js:174) | ✅ |
| **Bookmark legacy restore, scroll** | `scrollTop = fraction × scrollHeight` (reader-app.js:127-129) | ❌ (A2) |
| **Bookmark legacy restore, paginated/windowed** | `page = fraction × total` (reader-app.js:120-131) | ❌ (A2) |
| TTS save/restore | sentence start ordinal via canonical position | ✅ but O(n) sentence lookup (A6) |
| RSVP save/restore | token↔ordinal maps via canonical position | ✅ |
| Windowed chapter-attach seek | `resyncAfterImages` re-seek after image decode | ⚠️ timing hazard (A4) |

---

## 2. The two reported bugs — root causes

These motivated this review and are P0 items inside Workstream A.

### Bug 1 — quick-bookmark icon stuck on after adding (scroll mode) — **fixed on this branch**

The button's `bookmarked` class was only recomputed inside
`updateBookmarkMarkers()`, which fires on bookmark add/remove and on page turns
(`goTo → updateProgressFn`). Scroll mode has no page turns, and its scroll
handler (reader-app.js:1009) only called `chrome.updateProgress()` — so the
button froze in whatever state the last add/remove left it. (Before the
accurate-detection fix it froze *off*; after, it froze *on*. Same root cause,
opposite symptom.) Fix: `refreshQuickBmState()` extracted from
`updateBookmarkMarkers` and called rAF-coalesced from the scroll handler — at
most one measured check per frame, no marker rebuild.

### Bug 2 — navigating to a bookmark on a page-straddling paragraph lands on the second page

There is no single line to point at; it is the compound of three verified drift
mechanisms, all in Workstream A:

1. **Anchor capture in scroll mode picks "nearest" not "first visible"**
   (geometry.js:112-115). `Math.abs(top - vpTop)` lets a word on the line already
   cut off *above* the fold win. A bookmark pressed while a paragraph straddles
   the fold can anchor to a word the user considers "the previous screen" — or,
   reading the comparison the other way, to the first word *below* a half-visible
   line the user considers current. Either way the anchor disagrees with the eye
   by a line, and after a relayout that line can sit on the far side of a page
   boundary. → fix A3.
2. **Cross-mode rescale + text-snap near a boundary** (position.js:166-169, 42-66).
   Bookmark anchors are by construction at page tops — i.e., *at* page boundaries.
   A bookmark touched by another mode's tokenization (TTS/RSVP hop) gets
   `wordInSec` rescaled and snippet-snapped; a ±few-word resolution error at a
   boundary is exactly a "wrong page" result. → fixes A1, A7.
3. **Legacy fraction path** (reader-app.js:119-132). Bookmarks saved before the
   canonical position existed navigate by fraction in *every* layout — guaranteed
   density drift. → fix A2.

The plan's acceptance criterion for this bug: *navigating to any bookmark lands
the page (or scroll offset) where the anchor word is visible, and re-pressing the
bookmark button on that page reports "bookmarked" — across font, layout, and mode
changes.*

---

## 3. Workstream A — Position integrity ("never make the user hunt")

**Goal-as-invariant:** the user's position is always an exact whitespace-word
ordinal (plus snippet), captured as *the first whole word at the top of the
page/viewport*, and every navigation path resolves through
`resolvePosition → seekToToken`. The fraction `f` survives only as a stored
fallback for legacy data and as the progress-display numerator — never as a
navigation input when `position`/ordinal data exists.

### A1. Centralize the block-type enumeration — *small, do first*

Three places must agree on what counts as "content blocks" or cross-mode word
ordinals drift cumulatively (a past bug, documented at tts-app.js:328-331):

- Reader doc model walks all `.blk` (doc-model.js)
- TTS `segmentContent()` uses a hand-maintained selector (tts-app.js:332)
- RSVP `sectionsToText()` filters `sec.blocks` (rsvp-app.js:39)

Export one `EXTRACTABLE_BLOCK_TYPES` from `js/core/constants.js`; derive the
selector and the filter from it. Add a selftest asserting all three modes count
identical totals for the sample book. This converts a silent cross-mode drift
class into a test failure.

### A2. Retire the fraction as a navigation input

- `navigateToBookmark()` legacy branch (reader-app.js:119-132): resolve legacy
  bookmarks through `resolvePosition({ f: item.fraction }, …)` → ordinal →
  `seekToToken`. resolvePosition already accepts fraction-only positions
  (position.js:179-181); the scroll/windowed/paginated special cases collapse to
  one line each. Optionally migrate-on-read: once navigated, write back a full
  `position` so the legacy path decays to zero.
- Progress scrubber in windowed mode already seeks by word fraction → token
  (reader-app.js:994-1005); paginated scrub seeks by page, which is correct for a
  page bar. No change needed — listed here to record that it was audited.
- Audit remaining `item.fraction` / `pos.f` readers; after this branch's chrome.js
  work the only legitimate uses are display (% labels) and storage fallback.

### A3. Scroll anchor = first whole word at/below the viewport top

`currentLocator` (geometry.js:99-129): the binary search already converges on
`lo` = first word with `top >= vpTop`; the nearest-by-abs bookkeeping then
deliberately allows a cut-off line above the fold to win, and the ±20-word linear
refine exists only to serve that. Return the converged boundary instead (with the
same-line leftmost guarantee that word-index order already provides), delete the
refine loop. This matches the stated product model — "the position is the words
at the top of the page" — and removes ~40 rect reads per save. Also apply
`layoutScale()` to the rect comparisons (currently missing here, present in
`pageOfWord`) so saves taken while the chrome transform is active aren't skewed.

### A4. Close the image-decode timing hazard (windowed seeks)

`seekToToken` → chapter attach → `pageOfWord` runs before images decode; images
occupy no space until then, so the landing page is provisional.
`resyncAfterImages` (reader-app.js:351-375) re-seeks after decode but (a) aborts
if the user turned pages meanwhile, leaving the *stored* position built from the
provisional layout, and (b) re-seeks with a position captured pre-decode. Change:
re-capture the position *after* the settle relayout (the ws-ordinal is
layout-independent, so the reseek target itself is fine — the bug is what gets
saved afterward), and on abort, invalidate rather than persist the provisional
capture. Add a perf span around settle so the cost is visible under `?perf=1`.

### A5. TTS sentence lookup: binary search + boundary semantics

`sentenceIndexForOrdinal` (tts-app.js:637-643) is a linear scan and floors to the
earlier sentence when an ordinal falls mid-sentence. Make it a binary search
(same shape as geometry.js:65) and keep floor semantics deliberately (a position
mid-sentence should re-read that sentence, not skip it) — documented, with a test.

### A6. Tighten `refineByText` against repeated passages

position.js:42-66 accepts any ≥60% snippet match, tie-broken toward the
prediction. Two-tier it: prefer ≥80% matches outright; accept 60–79% only when
no high-tier match exists. Cheap, and directly reduces the "snapped to the wrong
occurrence near a page boundary" case feeding Bug 2.

### A7. Bookmark anchor/check/navigate symmetry test

The three bookmark operations (capture context, page-presence check, navigate)
must agree by construction. Add a selftest: for each layout mode — paginated,
windowed, scroll — bookmark every 10th page/screen of the sample book, then
assert `getPageBookmarks` reports presence at the landing position of
`navigateToBookmark` for each. This single test would have caught both reported
bugs and the two fixed earlier on this branch.

**Sequencing within A:** A1 → A2 → A3 (these three remove whole bug classes),
then A4–A7. Each is independently shippable and reversible.

---

## 4. Workstream B — Security hardening

Context: fully client-side app parsing untrusted files. The sanitizer core is
**good**: allowlisted tags/attrs (constants.js:62-68), inline styles stripped,
book CSS never applied, `img src` quarantined into `dataset.origSrc` and only
re-pointed at archive-resolved blob URLs, search/panel rendering uses
`textContent`/escaped templates. The following are the verified gaps, in priority
order.

### B1. `javascript:` URLs in book anchors — **XSS, fix immediately**

`sanitizeInline` copies `href` verbatim (extractor.js:13-18; `a: ["href"]` in
constants.js:64). A book containing `<a href="javascript:…">` executes on click.
Fix in `sanitizeInline`: allow only fragment links (`#…`, used by footnotes/TOC),
relative archive paths, and `http(s):`; drop everything else (`javascript:`,
`data:`, `vbscript:`, protocol-relative). ~6 lines plus a selftest with a
malicious fixture.

### B2. Unvalidated `?src=` fetch — SSRF/local-file read

All three apps pass `?src` straight to `fetch()` (reader-app.js:762-766 + 1116-1118,
tts-app.js:876-880, rsvp-app.js:719-723). Centralize one
`validateBookSrcUrl()` in core: require `http(s):`, reject credentials-bearing
URLs; (optional, config) origin allowlist. Three call sites, one helper.

### B3. Decompression limits for archives

CBZ (`new JSZip().loadAsync` — cbz-adapter.js:46) and CBR (libarchive
`extractFiles()` — cbr-adapter.js:81-114) inflate without per-entry or total size
caps; EPUB shares the zip surface via epub.js. Add caps (per-entry and total
uncompressed, e.g. 50 MB / 500 MB), skip entries whose names contain `..`, and
wrap CBR extraction in a timeout. Zip-bomb → graceful "file too large" error.

### B4. PDF page cap

pdf-adapter.js:126-142 iterates every page. The adapter already disables fonts
and eval (`disableFontFace`, `isEvalSupported:false` — good); add a `MAX_PAGES`
cap with a user-visible "truncated at N pages" notice via the existing
`onProgress` channel.

### B5. Book-ID collisions poison saved positions

`deriveBookId` (position.js:74-88) falls back title → filename; two books named
`book.epub` (or a crafted `?id=`) share `book:pos:*`/`book:pages:*` keys. Mix in
a short content hash (first 4 KB, SHA-256, 8 hex chars) for the derived cases;
keep explicit `?id=` as-is for backward compat, and read old keys once for
migration so nobody loses a position.

### B6. Book element IDs enter the app DOM unprefixed

`sanitizeInline` copies `child.id` (extractor.js:12) — needed for TOC/footnote
targets, but a book can claim app IDs (`progress`, `bmMarkers`) and confuse later
`getElementById`/`closest` lookups (DOM clobbering). Prefix content IDs
(`bk-${id}`) at sanitize time and resolve hrefs through the same prefix in the
TOC/footnote path. Mechanical, contained to extractor + href resolution.

### B7. Supply chain: pin CDN libs

sw.js precaches jszip/epub.js from jsdelivr without SRI, cache-first forever.
Add SRI hashes to the script tags, or better, vendor the three libs (they're
already version-pinned URLs; vendoring also removes the first-load CDN
dependency). epubjs 0.3.93 is old — evaluate 0.4.x in a spike, don't block on it.

### B8. Surface extraction warnings

`extractSections` silently skips failed spine items (extractor.js:152-157). Keep
the resilience, but count and report ("Loaded 95 of 100 chapters") through the
existing overlay/progress channel. Robustness debugging without log-diving.

*Deliberately not doing:* CSP can't be set by a static GitHub-Pages-style host via
meta-tag alone for everything we'd want, but a `<meta http-equiv="Content-Security-Policy">`
allowing self + blob: + the (or no) CDN is still worthwhile defense-in-depth —
listed in §8 recommendations because it constrains future feature work.

---

## 5. Workstream C — Verification & quality

The browser selftest (`js/test/selftest.js`, `?selftest=1`) covers extraction,
position math, and format plumbing, but none of the invariants this plan
strengthens. There is no Node-runnable harness (everything touches DOM layout).

- **C1. Headless CI loop.** A Playwright (or simple CDP script) job that opens
  `reader.html?selftest=1` and asserts zero failures, runnable locally and in CI.
  Without this, every accuracy fix in Workstream A is verified by hand forever.
- **C2. New selftests** (each tied to a workstream item): cross-mode word-count
  equality (A1); bookmark symmetry across three layouts (A7); position round-trip
  reader→TTS→RSVP→reader lands within ±1 ws-word (text snap margin); scroll
  restore after a font-size change lands the same word; sanitizer rejects the
  malicious-href fixture (B1); zip-bomb fixture fails gracefully (B3).
- **C3. Error-handling consistency.** Storage writes swallow quota errors
  silently everywhere (`catch (_) {}` — position.js:200, page-cache.js). Keep the
  graceful degradation but route through one `safeSetItem()` that logs once and,
  for `book:pos:*`, prunes oldest entries — a full localStorage currently means
  *positions silently stop saving*, the least premium failure imaginable.
- **C4. Dead code & docs debt.** `_bookmarksOnCurrentPage` already removed this
  branch; sweep for other unreferenced exports (low yield expected — the codebase
  is clean). Update PERFORMANCE.md Appendix A.3 with post-windowing numbers (the
  table still shows the pre-windowing 1308 ms turn latency; the real number is
  ~21 ms — currently underselling the system).

---

## 6. Workstream D — Performance (small, mostly hygiene)

The big wins are done and verified in design: windowing bounds paint to one
chapter; turns are ~0.2 ms sync JS; search hit resolution is binary-search;
listeners are signal-scoped; blob URLs are session-owned and revoked on switch.
Remaining, in priority order:

- **D1.** Gate `updateBookmarkMarkers`'s rebuild on a BookmarkManager generation
  counter instead of the id-string join (chrome.js:56) — currently every page
  turn string-joins the bookmark list. Micro, but it's on the turn path.
- **D2.** Page-counter idle pass recomputes `columnLayout()` per chapter
  (page-counter.js:160-187); stride depends only on viewport+prefs — hoist it.
- **D3.** Add perf spans for `updateBookmarkMarkers`, `refreshQuickBmState`, and
  scroll-mode save (`currentLocator`) so the accuracy work in A is provably cheap.
- **Not doing:** scroll-locator warm-start caching, BaseReaderApp consolidation
  (remaining shell duplication is ~10 trivial lines per app; extraction would add
  indirection for nothing). Recorded so they aren't re-litigated later.

---

## 7. Sequencing, risk, and acceptance

| Phase | Items | Risk | Acceptance gate |
|---|---|---|---|
| **P0 — this week** | Bug 1 fix (✅ landed), B1, B2 | Trivial; allowlists can't loosen behavior | Malicious-href fixture inert; `?src=javascript:` rejected; button toggles correctly while scrolling |
| **P1 — position integrity** | A1, A2, A3, A7 + C1/C2 tests | A3 changes saved-anchor semantics by ≤1 line — verify with round-trip test before/after | Bookmark symmetry test green in all three layouts; Bug 2 scenario reproduces fixed |
| **P2 — hardening** | B3–B6, B8, C3 | B5 needs the key-migration read; everything else additive | Zip-bomb fixture graceful; two same-named books keep separate positions (after migration) |
| **P3 — polish** | A4–A6, B7, C4, D1–D3 | Low; A4 is the only timing-sensitive change | Image-heavy book: seek → wait → saved position equals landed position |

Every item is independently revertable; none changes visible UI. Branch
discipline: one commit per lettered item, selftest additions land with (not
after) the behavior they protect.

---

## 8. Recommendations (not in scope; for the owner to consider)

**Front:**
- Extend the existing resume-highlight (`setResumeHighlight`, already used for
  RSVP/TTS returns) to bookmark jumps and mode switches: a fading mark on the
  anchor words is the strongest possible "you are here" and costs nothing new.
  Directly serves "don't make the user hunt" beyond what exact positioning can do
  when a paragraph straddles a page.
- Bookmark markers are 22×14 px hover targets on a slim track; consider a larger
  touch target (invisible padding) on coarse pointers.
- When a legacy fraction-only bookmark is navigated (until A2's migrate-on-read
  retires them), a subtle "approximate location" toast would set expectations.

**Back/process:**
- Serve with a CSP (`default-src 'self'; img-src 'self' blob:; script-src 'self'`
  + CDN if kept) — converts any future sanitizer miss from XSS into a console error.
- Vendor the CDN libs (pairs with B7) — also makes first load fully offline-capable.
- Adopt the C1 headless selftest as a pre-merge gate; it's the single highest
  leverage process change available.
- Re-run Lighthouse after P2 and commit the scores next to PERFORMANCE.md's tables.

---

## Appendix — work already landed on this branch (claude/bookmarks-scroll-layout-issue-wwzxdr)

1. **Accurate scroll-mode bookmark detection** — `getPageBookmarks` now measures
   the bookmark word's real laid-out position instead of `fraction × scrollHeight`
   (chrome.js), fixing the never-lighting button. Dead duplicate
   `_bookmarksOnCurrentPage` removed.
2. **Marker dots match the thumb metric per mode** — scroll: offset/scrollable
   height (transform-descaled); paginated: page/(total−1); windowed: word fraction.
   Layout-signature gate keeps page turns measurement-free; relayout refreshes dots.
3. **Quick-bookmark button refreshes on scroll** — `refreshQuickBmState` split out
   and rAF-coalesced in the scroll handler (Bug 1 fix).

Manual verification still recommended (no headless harness yet — see C1):
bookmark in scroll mode → icon lights → scroll a screen away → icon clears →
scroll back → icon lights with the bookmark's color; dot sits under the thumb.
