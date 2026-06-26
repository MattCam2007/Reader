# Architecture & Code Review

Date: 2026-06-26
Scope: `js/` (the ES-module application). CSS, vendored libs, and dictionaries
were skimmed but not audited line-by-line.

## TL;DR

The lower layers of this codebase are genuinely well-designed. `core/`,
`model/`, `formats/`, and `shared/` are cleanly separated, the format-adapter +
canonical-position + `BookSession` design is the right abstraction, and a lot of
deliberate DRY work has already happened (`shared/search.js`, `shared/render.js`,
`base-reader-app.js`, the `SETTINGS` table).

The technical debt is concentrated in **three places**:

1. The three mode entry-points (`reader-app.js` 1396 LOC, `tts-app.js` 912 LOC,
   `rsvp-app.js` 812 LOC) re-implement the same shell wiring — dropdown menus,
   panel open/close, `?src=` fetch, file input, overlay, the canonical-position
   scaffold, bookmark-context, and the returned handle — with cosmetic
   differences. This is ~60% of the duplication in the codebase.
2. `settings/settings-screen.js` (944 LOC) is a single function that builds a
   giant `innerHTML` string and wires it imperatively.
3. A scatter of smaller correctness/maintainability hazards (below).

Nothing here is on fire. These are maintainability and consistency problems: the
same logic lives in 3 copies, so a fix or feature has to be applied 3 times and
the copies have already drifted (TTS once silently miscounted words; the menu
copies differ in `e.stopPropagation()` usage; theme lists disagree).

---

## High-impact findings

### H1 — Dropdown "submenu" pattern copy-pasted 6×

**Where:** `reader-app.js:1211-1229` (book menu) & `:1286-1306` (mode menu);
`rsvp-app.js:295-313` & `:340-360`; `tts-app.js:752-773` & `:786-807`.

**What:** Each is the identical ~18-line block: a `closeX()` that sets
`hidden=true` + `aria-expanded=false`, a toggle click handler, a
`menu.addEventListener('click', closeX)`, and a `document` click-outside handler.
Six near-verbatim copies.

**Causes:** Any change to menu behaviour (e.g. close-on-Escape, focus return)
must be made in 6 places. The copies have already drifted — some call
`e.stopPropagation()` on the toggle, some don't — which is exactly the kind of
inconsistency that produces "works in Reader, broken in TTS" bugs. The
`document`-level click listeners also accumulate (one per menu per mode init).

**Fix:** Extract a `shared/dropdown-menu.js`:
```js
export function wireDropdown(btn, menu, signal) {
  if (!btn || !menu) return;
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded','false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) { menu.hidden = false; btn.setAttribute('aria-expanded','true'); }
    else close();
  }, { signal });
  menu.addEventListener('click', close, { signal });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !btn.contains(e.target) && !menu.contains(e.target)) close();
  }, { signal });
  return close;
}
```
Each call site collapses to one line. ~100 LOC removed.

### H2 — `?src=` URL-load block duplicated verbatim across modes

**Where:** `rsvp-app.js:729-743`, `tts-app.js:877-889`, and the async variant
`reader-app.js:908-924` (`loadFromUrl`).

**What:** The same "validate src → fetch → check `resp.ok` → blob → `new File(...,
'application/epub+zip')` → `loadEpub`" sequence, including the identical
`'Fetch failed: ' + status` string and `split('/').pop() || 'book.epub'`
filename derivation.

**Causes:** Three copies of network/error handling. The hard-coded
`application/epub+zip` MIME is now wrong in spirit — the app supports PDF/CBZ/CBR
too — and the format is actually detected by magic bytes downstream, so the type
is misleading in all three copies.

**Fix:** Move to `core/book-session.js` (or a small `core/load-url.js`):
```js
export async function fileFromUrl(safeUrl) {
  const resp = await fetch(safeUrl);
  if (!resp.ok) throw new Error('Fetch failed: ' + resp.status);
  const blob = await resp.blob();
  const name = safeUrl.split('/').pop() || 'book';
  return new File([blob], name); // type irrelevant; format detected by bytes
}
```
Each mode's init `src` branch becomes `fileFromUrl(safeUrl).then(loadEpub)`.

### H3 — The canonical-position scaffold is reimplemented per mode

**Where:** `reader-app.js:215-376` (`readerSections`/`getCanonicalPosition`/
`applyCanonicalPosition`/`wsWordText`/`savePosMain`); `rsvp-app.js:748-792`
(`rsvpSections`/`currentOrdinal`/`wordAt`/`getCanonicalPosition`/`savePosition`/
`restorePosition`); `tts-app.js:630-663` (`ttsSections`/`wordAt`/`getCanonicalPosition`/
`applyCanonicalPosition`/`savePosition`/`restorePosition`).

**What:** Each mode builds a `[{href, wordStart, wordCount}]` section table, a
`wordAt(ord)` accessor, then calls `buildPosition`/`resolvePosition` and wraps
`shellSavePosition`/`loadPosition` identically. The *only* genuinely
mode-specific parts are (a) how the section table and `wordAt` are derived from
that mode's data structures and (b) how an ordinal maps to the mode's cursor
(page/token/sentence).

**Causes:** The `save`/`restore`/`getCanonical`/`applyCanonical` wrappers are
boilerplate repeated 3×. Because they're hand-written each time, the highlight
(`pos.hl`) semantics live in scattered spots and are easy to get inconsistent
(RSVP sets `hl=1`, TTS computes a sentence span, Reader sets none).

**Fix:** A `core/mode-position.js` factory that takes the three mode-specific
closures and returns the common wrappers:
```js
export function makeModeCursor({ getSections, getTotalWords, wordAt,
                                 getOrdinal, seekToOrdinal, getBookId }) {
  const get = () => { /* buildPosition(...) once, here */ };
  const apply = (pos) => seekToOrdinal(resolvePosition(pos, getSections(), getTotalWords(), wordAt));
  return {
    getPosition: get,
    applyPosition: apply,
    save: () => shellSavePosition(getBookId(), get),
    restore: () => { const p = loadPosition(getBookId()); if (p) apply(p); },
  };
}
```
Removes ~60 LOC of duplication and makes the `hl` policy a single documented
parameter.

### H4 — Overlay + welcome/error/loading state duplicated

**Where:** `reader-app.js:622-644` and `tts-app.js:207-229` are **identical**
`showLoading`/`showError`/`showWelcome`/`clearOverlay` (same body classes, same
`t()` keys). RSVP has a parallel-but-different status-message variant
(`rsvp-app.js:694-708`).

**Fix:** `shared/overlay.js` taking the overlay element refs. Reader and TTS
share it directly; RSVP either adopts it or documents why its status line is
structurally different. ~25 LOC removed and the two real copies can never drift.

### H5 — Bookmark-panel wiring + context is per-mode boilerplate

**Where:** `reader-app.js:103-149`, `rsvp-app.js:123-162`, `tts-app.js:112-154`.

**What:** Each mode does `initBookmarksPanel(...)` + `setBook` + defines
`getXBookmarkContext` and `navigateXToBookmark` + `setCallbacks`. The
`closePanel` callbacks all do "remove `show-bookmarks` + set the bookmarks
button's `aria-expanded=false`" with mode-specific element IDs. The
context-builders differ only in how they extract the current chapter label and
snippet — which is exactly the per-mode part already abstracted by the canonical
position.

**Fix:** Once H3 lands, `getContext` reduces to `{ ...modeChapterAndText(),
position: cursor.getPosition() }`. The panel-open/close half belongs with H6.

---

## Medium-impact findings

### M1 — Panel open/close is hand-rolled per mode, with bug-prone `aria` juggling

**Where:** `reader-app.js:536-565`, `rsvp-app.js:418-509`, `tts-app.js:156-205`.
`setAttribute('aria-expanded', …)` appears **48 times** across the three apps.

**Causes:** Each mode manually clears a hard-coded list of `show-*` body classes
and resets each button's `aria-expanded`. Adding a panel means touching every
`closePanels()`/toggle by hand, and it's easy to forget one button (several
toggles in `rsvp-app.js` reset `tocBtn`/`searchBtn` but not always the same
set). The doc comment in `base-reader-app.js:10-12` explicitly punts on this
("left per-mode"), but a small data-driven helper would remove the risk.

**Fix:** A `shared/panels.js` that takes a registry of
`{ name, btn, bodyClass, onOpen }` and exposes `open(name)`, `closeAll()`. It
sets/clears `show-<bodyClass>` and `aria-expanded` from the registry, so the
"reset every other button" logic exists once. Each mode just registers its
panels.

### M2 — `settings-screen.js` is a 944-line god-function

**Where:** `js/settings/settings-screen.js`.

**What:** One `openSettingsScreen()` builds the entire modal as a template
literal and wires every control imperatively (`wireSeg`, `wireGeneralTab`,
per-tab builders). It already has good internal helpers (`row`, `seg`, `slider`,
`byId`), so it's not chaotic — but it's a single unit that mixes general/reader/
rsvp/tts/dict concerns and is hard to navigate or test.

**Causes:** Any settings change requires reading a very long file; the four
mode-tabs can't be unit-tested independently; the live-preview state is held in
module-level mutable vars (`_onPreviewStart` etc.) that are easy to leak between
opens.

**Fix:** Split per-tab builders into `settings/tabs/{general,read,rsvp,tts,
dict}.js`, each exporting `buildHTML(prefs)` + `wire(prefs, liveApply, byId)`.
The shell (`settings-screen.js`) stays as the tab host + lifecycle. No behaviour
change, ~200 LOC per file instead of 944 in one.

### M3 — `THEME_CLASSES` in mode-switcher diverges from the theme source of truth

**Where:** `mode-switcher.js:19`
`const THEME_CLASSES = ['theme-dark','theme-light','theme-sepia','theme-oled'];`
vs. `constants.js:16-29` `THEME_COLORS`/`ALL_THEME_NAMES` (9 themes: also
terminal, nebula, forest, ember, nord — all selectable in
`settings-screen.js:285-289`).

**What:** `clearBodyClasses()` only strips 4 of the 9 theme classes. Currently
**masked** because each mode's `init()` calls `applyTheme()` →
`applyThemeClass()` which removes all `ALL_THEME_NAMES` first. So it's not a
live user bug *today*, but it is dead, misleading, and a latent leak: any future
mode-switch path that doesn't immediately re-apply the theme will leave
`theme-nebula` etc. on `<body>`.

**Fix:** Import and use the single source:
`...ALL_THEME_NAMES.map(n => 'theme-' + n)` instead of the hard-coded list.
Delete `THEME_CLASSES`.

### M4 — `EventBus.emit` mutation-during-iteration & no listener isolation

**Where:** `core/events.js:19-25`.

**What:** `emit` does `fns.forEach(...)` over the live array. A listener that
unsubscribes itself (or another) during dispatch mutates the array mid-iteration
— `forEach` then **skips** the next listener. Also, one throwing listener aborts
delivery to the rest.

**Causes:** Subtle "my handler didn't fire" bugs that only appear when a handler
unsubscribes during emit. Since `PrefsManager` extends `EventBus` and the RSVP
app wires many `bus.on(...)`, this is reachable.

**Fix:** Iterate a copy and isolate failures:
```js
emit(event, ...args) {
  const fns = this._listeners.get(event);
  if (fns) for (const fn of [...fns]) { try { fn(...args); } catch (e) { console.error(e); } }
  const wild = this._listeners.get('*');
  if (wild) for (const fn of [...wild]) { try { fn(event, ...args); } catch (e) { console.error(e); } }
}
```

### M5 — Per-mode search cache builders are the same shape

**Where:** `rsvp-app.js:390-400` (`buildRsvpSearchCache`), `tts-app.js:689-699`
(`buildTtsSearchCache`), and Reader uses the doc-model's `text`/`wordCharStart`.

**What:** Both build `{ text, charStart[] }` by concatenating items with a
separator and recording each item's start offset, then hand it to the already-
shared `renderSearchResults`. The cache-build loop is duplicated.

**Fix:** A tiny `shared/search.js` helper
`buildSearchIndex(items, getText)` returning `{ text, charStart }`. Both RSVP and
TTS call it with their respective item arrays. ~15 LOC.

### M6 — File-input `change` handler duplicated 3×

**Where:** `reader-app.js:1233-1237`, `rsvp-app.js:331-337`, `tts-app.js:778-784`
— identical "take `files[0]`, clear `value`, `loadEpub(file)`".

**Fix:** Fold into the H2/H1 shared-wiring helper, or a one-liner
`wireFileInput(input, loadEpub, signal)`.

---

## Low-impact / polish

### L1 — `reader-app.js` `init()` is ~1360 lines in one closure
Beyond the cross-mode duplication, the reader's own `init` mixes element lookup,
position math, pagination orchestration, quick-drawer drag handling, bookmark
color popover, and DOM wiring. The quick-drawer block (`:1071-1209`) and the
quick-bookmark long-press/color-popover block (`:946-1039`) are each self-
contained enough to move into `reader/quick-drawer.js` and
`reader/quick-bookmark.js`. Improves readability without changing behaviour.

### L2 — `deriveBookId` lazy-import comment describes code that isn't there
`position.js:92-106`: the comment explains a registry-driven extension strip and
then *doesn't* do it (uses a regex), spending a paragraph justifying the absence.
Either implement the registry version or trim the comment to one line. (The
codebase generally over-comments rationale; that's mostly a virtue here, but a
few comments describe paths not taken.)

### L3 — TTS rate-step arrays are inline literals in two keydown branches
`tts-app.js:837` and `:847` each redeclare `const rates = [0.75,1,1.25,1.5,2]`.
The same list also drives the rate buttons. Hoist to a `TTS` constant.

### L4 — `setMetaThemeColor` silently no-ops for 5 of 9 themes
`THEME_COLORS` (constants.js) actually does list all 9, so this is fine — but
worth a selftest assertion that every selectable theme has a `THEME_COLORS`
entry, since the settings list and the colors map are maintained separately.

### L5 — Repeated `state.playState` guard in RSVP
`if (state.playState === 'playing') playback.pause(); else if (... 'countdown')
playback.cancelCountdown();` appears 5× in `rsvp-app.js` (TOC, search, bookmark,
two more). Extract `playback.interrupt()`.

---

## What's already good (keep doing this)

- **Format-adapter layer** (`formats/`): adding a format is genuinely one file;
  the IR boundary is clean and well-documented in `ARCHITECTURE.md`.
- **Canonical position** (`core/position.js`): the section-href anchor + ordinal
  + fraction + text-snippet fallback ladder is a thoughtful, robust design.
- **`BookSession`** as a parse-once, share-across-modes owner of blob URLs with a
  clear `dispose()` contract.
- **`shared/search.js`** and **`shared/render.js`**: exactly the right
  extractions, with commit-message-quality comments explaining the prior
  duplication they replaced.
- **AbortController lifecycle**: every listener is wired with `{ signal }`, so
  teardown is uniform and leak-resistant.
- **The `SETTINGS` table** (constants.js:117) is the declarative pattern the rest
  of the settings screen should move toward.

---

## Suggested sequencing

1. **H1 + H2 + M6** (shared wiring helpers) — highest ratio of LOC removed to
   risk; pure mechanical extraction guarded by the existing selftest.
2. **M3 + M4 + L3** — small correctness/consistency fixes, independent.
3. **H4 + M5** (shared overlay/search-index) — low risk.
4. **H3 + H5** (mode-cursor factory) — the biggest structural win; do after the
   easy extractions so the entry-points are already smaller.
5. **M2 + L1** (settings + reader-app decomposition) — largest effort, do last.

Each step is independently shippable and testable via `reader.html?selftest=1`.
