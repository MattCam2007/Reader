# Best Practices, Invariants & Learnings (`docs/BEST-PRACTICES.md`)

The rules this codebase has earned the hard way. Each is a *reminder* with the
*learning* behind it — break one and you reintroduce a bug that was already fixed.
Read before changing input, position, highlighting, rendering, or storage.

> Companion: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`STATE.md`](STATE.md),
> [`PERFORMANCE.md`](PERFORMANCE.md), [`INPUT.md`](INPUT.md),
> [`CONTRIBUTING.md`](CONTRIBUTING.md). The deep "why" for the position rules is in
> [`STEWARDSHIP-PLAN.md`](STEWARDSHIP-PLAN.md).

---

## 1. Position & geometry

### 1.1 Store a locator, never a live Range or DOM node
**Rule.** Anything that remembers a place in the book stores a portable
`{s,b,w}` locator (`js/model/locator.js`) and re-resolves it on demand.
**Learning.** `js/reader/pagination.js` *detaches off-screen chapter DOM* during
re-pagination (windowed mode). A `Range`/node captured before a relayout points at
detached DOM afterwards → highlights drift, bookmarks land a page off, selections
vanish. The highlight store, search, and bookmarks all obey this; so must any new
anchor. Re-render from locators after every `paginate()`/`repaginate()`/scroll
relayout (`HighlightController.renderAll`).

### 1.2 The fraction-of-book scalar is not a navigation currency
**Rule.** Navigate and restore by **word ordinal / canonical position**
(`js/core/position.js`), not by `f` (fraction). Use `f` only as a last-resort
fallback when an href is unknown.
**Learning.** Every "I lost my place" report traced to a call site that round-
tripped through the fraction. Word ordinals with an href anchor + text-snippet snap
are word-exact across font size, rotation, and mode switches; fractions are not.

### 1.3 Divide measured offsets by `layoutScale`
**Rule.** When the chrome bars are visible the viewport is CSS-`transform:
scale(<1)`. `getBoundingClientRect()` then returns *scaled* pixels, but
`state.stride` is unscaled. Any offset→page/word math must divide rect deltas by
`layoutScale(content)` (`js/model/geometry.js`).
**Learning.** Without it, TOC/footnote/bookmark jumps taken while a panel is open
land progressively short, the error growing with depth into the chapter.

### 1.4 All modes must count the same words
**Rule.** Reader/RSVP/TTS count words via the shared
`EXTRACTABLE_BLOCK_TYPES`/`countWords` path. A new block type must join the
enumeration.
**Learning.** Divergent word counts caused a cumulative cross-mode "off by a page"
drift. The selftest now asserts reader==tts==rsvp counts on a synthetic book;
keep that green.

---

## 2. Input (pointer / touch / pen)

### 2.1 Add to the pen branch; never edit the touch state machine
**Rule.** New stylus features go in the `pointer*` (pen) branch of
`js/reader/input.js`. Leave the `touch*` pinch/pan/drag machine alone.
**Learning.** The touch machine is mature and subtle (pinch midpoint anchoring,
rubber-banding, double-tap zoom reset). The pen path is parallel and gated by
`_penActive`, set on `pointerdown` *before* the compatibility `touchstart`, so
touch handlers bail for a pen contact. See [`INPUT.md`](INPUT.md) §1.

### 2.2 Feature-detect every hardware signal; degrade to a no-op
**Rule.** `pressure`, `buttons` bits, tilt, and `window.SPenBridge` are all
optional. Guard with `?.` / bit tests; a passive pen, a finger, or a no-bridge
build must never throw and never break finger input.
**Learning.** Eraser/barrel reporting varies by device and engine; the BLE remote
is invisible to a PWA. Treat hardware reads as enhancements over a working
baseline, not preconditions.

### 2.3 Stamp the synthetic-click guard on every interaction exit
**Rule.** A `pointerup`/`touchend` may be followed by a stray `click`. Stamp
`_lastTouchEnd`/`_lastPointerUp` so the `click` handler suppresses it within
`SYNTHETIC_CLICK_GUARD_MS`.
**Learning.** Forgetting this turns a deliberate pen lift into a phantom page-turn.

### 2.4 Clean up `body.pen-contact` on every exit path
**Rule.** Add `pen-contact` on pen-down, remove it on up **and** cancel.
**Learning.** That class forces `user-select:none` to suppress Android's native
selection toolbar during a pen contact. If a cancel path leaks it, finger text
selection silently stops working.

### 2.5 Hover events are a firehose — debounce to settle
**Rule.** Hover (`pointermove`, `buttons===0 && pressure===0`) fires continuously.
Debounce (~120 ms) and act only when the pen settles on a stable word.
**Learning.** Acting on every hover event churns the CPU/battery and flickers the
preview. Gate it behind `prefs.penHover` and skip entirely for finger/touch.

---

## 3. Highlighting & selection

### 3.1 The pen uses a custom selection, not the OS selection
**Rule.** The pen paints via `::highlight(pen-selection)` and commits with
`createFromWords`. Do not call the native window selection for the pen path.
**Learning.** Invoking Android's native selection summons drag handles and the
system Copy/Share toolbar, which fight our own action bar. The custom highlight
gives full control. The finger/native path still uses `createFromSelection`.

### 3.2 The Highlight API is optional; the store is not
**Rule.** Rendering checks `CSS.highlights`/`Highlight` and silently does nothing
when absent; the *store* still works. Never gate persistence on the render API.
**Learning.** Older WebViews lack the API. Degrading rendering (no paint) is
acceptable; losing a saved highlight is not.

### 3.3 Skip ranges whose endpoints aren't connected
**Rule.** In `renderAll`/`_rangeFor`, skip a highlight whose word nodes are
`!isConnected` (detached, off-window). They re-render on the next window turn.
**Learning.** Building a `Range` across detached DOM throws or paints nothing;
guarding keeps render robust in windowed mode.

---

## 4. Storage & persistence

### 4.1 Use the `reader:<feature>:<bookId>` convention + `safeSetItem`
**Rule.** Per-book stores key on the resolved `bookId` and write through
`safeSetItem` (`js/core/safe-storage.js`), which prunes least-recently-read
positions on quota errors. Additive keys need no schema bump.
**Learning.** localStorage quota is real; an unguarded `setItem` can throw and
lose data mid-session. Pruning by last-accessed keeps the active book safe.

### 4.2 Never overwrite existing data on migration
**Rule.** Key migrations (`migrateBookKeys`) move old→new only when new is empty.
**Learning.** The bookId-hash migration had to be idempotent and non-destructive;
the selftest asserts it never clobbers current data.

---

## 5. Dependencies, offline, security

### 5.1 No new runtime/CDN dependency
**Rule.** Tier 1 features are pure platform APIs. The only runtime deps are the two
vendored EPUB libs; do not add more. Offline (the service worker) must keep working.
**Learning.** The app's value is "open `reader.html`, no build, works offline." A
CDN dependency breaks that the first time a reader is on a plane.

### 5.2 Book content is untrusted — it stays sanitized and inert
**Rule.** EPUB HTML is allowlist-sanitized (`sanitizeInline`, `safeAnchorHref`); no
`innerHTML` of book data, no book CSS, dangerous URL schemes dropped.
**Learning.** `javascript:` URLs in book anchors were a real XSS vector. The
selftest now asserts every dangerous scheme is dropped; keep new content paths
behind the sanitizer.

---

## 6. Testing & change discipline

### 6.1 Pure logic out of event handlers, so it is unit-testable
**Rule.** Extract classification/mapping/decision logic from `input.js` handlers
into pure functions in a small module; unit-test those, functional-test the wiring.
**Learning.** `input.js` handlers need a live viewport + real PointerEvents, so
they resist unit testing. Pure functions give cheap, fast coverage and double as
documentation of the decision. Every S Pen phase follows this. See
[`TESTING.md`](TESTING.md).

### 6.2 Every behaviour change ships a selftest assertion
**Rule.** Add unit and/or live assertions to `js/test/selftest.js`; the headless
run is the merge gate.
**Learning.** The suite (200+ assertions on the sample book and a real EPUB)
catches cross-mode drift, position regressions, and dead dynamic imports that are
invisible to a casual click-through.

### 6.3 One feature, one branch, one revertible PR, one safe-default pref
**Rule.** UX-changing features sit behind a pref defaulted to the safe behaviour,
wired declaratively through `DEFAULT_PREFS` + `SETTINGS`.
**Learning.** It keeps every change independently mergeable and revertible, and
lets a risky default ship "off" until proven.

---

## 7. Quick "before you commit" reminders

- Did you store a **locator**, not a Range? (1.1)
- Does it **degrade to a no-op** without the hardware/API? (2.2, 3.2)
- Did you leave the **touch machine** untouched? (2.1)
- Is the new logic a **pure function with a unit test**? (6.1)
- Is there a **measurable-better assertion** for an S Pen phase? (`TESTING.md` §5)
- Does **finger + keyboard** input still behave exactly as before?
- `node test/run-selftest.mjs` green, offline still works, no new dependency?
