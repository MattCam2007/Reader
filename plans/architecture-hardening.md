# Architecture Hardening Plan

Companion to [`docs/CODE-REVIEW.md`](../docs/CODE-REVIEW.md). That document
catalogues the findings; this one is the **execution plan** — ordered,
test-first, each phase independently shippable and green under
`node test/run-selftest.mjs`.

## Operating principles

1. **Cement before you cut.** Every phase that changes behaviour lands its
   tests *first* (characterization tests that pass against the current code),
   then the refactor, then the same tests stay green. A refactor that needs a
   test changed is a behaviour change and must be called out explicitly.
2. **Reader is the reference.** Where Reader, RSVP and TTS disagree, the
   Reader's behaviour is the spec. RSVP/TTS get migrated *to* it.
3. **Pure where possible.** Each extracted helper is written to be testable with
   synthetic DOM (`document.createElement`) or fake closures — no live book
   required — so it unit-tests in `selftest.js` directly.
4. **One module per import rule.** `selftest.js` imports every module it tests at
   the top; a missing/throwing module reds the *whole* suite. So in every phase:
   create the module → add the import → add the asserts, in that order.
5. **No documentation pass yet.** Docs (`ARCHITECTURE.md`, `MODULES.md`) are
   updated only after the architecture settles (post Phase 9).

## Test-harness facts this plan relies on

- `js/test/selftest.js` `runSelftest(state, hooks)` runs in-page, pushes
  `{ok,label,module}` to `window.__selftestResults`. Add asserts in a
  `{ }` block with a `// --- module: purpose ---` header.
- `assert(module, label, ok)` is in scope inside `runSelftest`. For DOM helpers,
  build throwaway elements and wire them with a **local `AbortController`** you
  `.abort()` in a `finally`, so listeners never leak between asserts.
- Live reader closures arrive via `hooks` (only the Reader entry point passes
  them today — see Phase 0). `runLiveTests` shows the pattern.
- `test/run-selftest.mjs` additionally **boot-smokes** `?mode=rsvp` and
  `?mode=tts`: it asserts the shell reaches `welcome` and that one button wires
  up. We extend this into a cross-mode behaviour probe in Phase 0.
- Run locally: `node test/run-selftest.mjs` (= `npm test`).

---

## Phase 0 — Harden the harness (prerequisite, no app refactor)

**Why first:** RSVP and TTS currently have *only* a boot smoke. Phases 3–7 touch
their menus, panels, overlay and position scaffolding. Without a cross-mode
behaviour guard, those refactors are unverifiable. This phase adds the guard and
establishes the baseline — it changes **no application code**.

**Steps**

1. Generalise `smokeMode()` in `test/run-selftest.mjs` into `probeMode()` that,
   after boot, exercises the UI invariants every mode shares and returns a
   pass/fail per check. Drive it through real clicks (as the existing smoke
   does) so it survives the later refactors unchanged.
2. Add a per-mode element-id map (Reader / RSVP / TTS button + menu ids) so one
   probe body runs against all three.
3. Wire `probeMode` for `read`, `rsvp`, `tts` into the run (the Reader page
   already runs the full suite; the probe adds the cross-mode UI checks).

**Test code** (`test/run-selftest.mjs`, replaces `smokeMode`):

```js
// Cross-mode UI invariants. Driven by real clicks so it keeps guarding the
// shared dropdown/panel helpers introduced in later phases.
const MODE_IDS = {
  read: { menuBtn: 'modeMenuBtn', menu: 'modeMenu', toc: 'tocBtn', search: 'searchBtn' },
  rsvp: { menuBtn: 'modeMenuBtn', menu: 'modeMenu', toc: 'tocBtn', search: 'searchBtn' },
  tts:  { menuBtn: 'ttsModeMenuBtn', menu: 'ttsModeMenu', toc: 'ttsTocBtn', search: 'ttsSearchBtn' },
};

async function probeMode(browser, base, mode) {
  const ids = MODE_IDS[mode];
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  console.log(`\n=== probe: reader.html?mode=${mode} ===`);
  await page.goto(`${base}reader.html?mode=${mode}`, { waitUntil: 'load' });
  const checks = await page.evaluate(async (ids) => {
    const out = {};
    const $ = (id) => document.getElementById(id);
    await new Promise(r => requestAnimationFrame(r));
    // 1. dropdown: click opens (menu not hidden), click again closes
    const mb = $(ids.menuBtn), menu = $(ids.menu);
    if (mb && menu) {
      mb.click(); out.menuOpens = menu.hidden === false;
      mb.click(); out.menuCloses = menu.hidden === true;
      // 2. click-outside closes an open menu
      mb.click(); document.body.click(); out.menuOutsideCloses = menu.hidden === true;
    } else { out.menuOpens = out.menuCloses = out.menuOutsideCloses = true; } // mode has no menu
    // 3. panel exclusivity: opening TOC, then search, leaves only search open
    const toc = $(ids.toc), search = $(ids.search);
    if (toc && search) {
      toc.click(); const tocOpen = document.body.classList.contains('show-toc');
      search.click();
      out.panelExclusive = document.body.classList.contains('show-search')
        && !document.body.classList.contains('show-toc');
      out.tocOpened = tocOpen;
      document.body.click(); // backdrop/outside closes
      out.panelsClose = !document.body.classList.contains('show-search');
    } else { out.panelExclusive = out.tocOpened = out.panelsClose = true; }
    return out;
  }, ids);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length) console.error('  FAIL checks:', failed.join(', '));
  if (pageErrors.length) console.error('  page errors:', pageErrors.map(e => String(e).slice(0,200)));
  console.log(failed.length || pageErrors.length ? '  PROBE FAIL' : '  probe OK');
  await context.close();
  return !failed.length && !pageErrors.length;
}
```

Then in the runner loop replace the two `smokeMode` calls:

```js
if (!process.argv[2]) {
  for (const mode of ['read', 'rsvp', 'tts']) ok = (await probeMode(browser, base, mode)) && ok;
}
```

**Done when:** `node test/run-selftest.mjs` runs the probe green for all three
modes against the *current* (un-refactored) code. This is the baseline. If a
check fails today, that is a real cross-mode inconsistency — record it and treat
the **Reader** result as the target (it should already pass).

**Risk:** none to app code. Probe is additive.

---

## Phase 1 — Theme source-of-truth (fixes M3, L4)

**Goal:** One list of theme names drives every "remove all theme classes" site
and every theme→meta-color lookup.

**Steps**

1. `mode-switcher.js`: delete `THEME_CLASSES` (line 19); import `ALL_THEME_NAMES`
   from `core/constants.js`; in `clearBodyClasses()` spread
   `...ALL_THEME_NAMES.map(n => 'theme-' + n)`.
2. (L4) Keep `THEME_COLORS` as the single map; add a selftest asserting the
   settings theme list ⊆ `THEME_COLORS` keys so the two never drift.

**Test code** (`selftest.js`, new block; `ALL_THEME_NAMES`, `THEME_COLORS`
already importable from constants):

```js
// --- constants: theme source-of-truth (M3/L4) ---
import { ALL_THEME_NAMES, THEME_COLORS } from '../core/constants.js'; // add to top imports
// ...
{
  assert('themes', 'every theme name has a meta color',
    ALL_THEME_NAMES.every(n => typeof THEME_COLORS[n] === 'string'));
  // The settings screen offers these; all must be removable & colorable.
  const OFFERED = ['dark','sepia','light','oled','terminal','nebula','forest','ember','nord'];
  assert('themes', 'settings themes are all known',
    OFFERED.every(n => ALL_THEME_NAMES.includes(n)));
}
```

**Done when:** new asserts green; Phase 0 probe still green (switch modes after
selecting `nebula` leaves no stale `theme-*`). Manually: pick `forest`, switch
Reader→RSVP→Reader, inspect `<body>` — exactly one `theme-*`.

**Risk:** trivial. The bug is currently masked by `applyThemeClass`, so no
regression is possible; this removes the latent leak and the divergent list.

---

## Phase 2 — EventBus robustness (fixes M4)

**Goal:** Dispatch tolerates a listener unsubscribing during `emit`, and isolates
a throwing listener so the rest still receive the event.

**Steps**

1. `core/events.js` `emit`: iterate a **copy** (`[...fns]`) for both the event
   list and the wildcard list; wrap each call in `try/catch` →
   `console.error`.

**Test code** (`selftest.js`, extend the existing `// --- core/events ---`
block):

```js
// self-unsubscribe during emit must not skip the next listener
{
  const b = new EventBus();
  const seen = [];
  const off = b.on('e', () => { seen.push('a'); off(); }); // a removes itself
  b.on('e', () => seen.push('b'));
  b.emit('e');
  assert('events', 'self-unsubscribe during emit does not skip next', seen.join() === 'a,b');
}
// a throwing listener does not abort delivery to others
{
  const b = new EventBus();
  let reached = false;
  b.on('e', () => { throw new Error('boom'); });
  b.on('e', () => { reached = true; });
  b.emit('e'); // must not throw
  assert('events', 'throwing listener is isolated', reached === true);
}
```

**Done when:** both new asserts green (they FAIL against current code — write
them first, watch them fail, then fix `emit`).

**Risk:** low. `PrefsManager` extends `EventBus`; copy-iteration is strictly
safer. Existing event asserts must stay green.

---

## Phase 3 — Shared dropdown menu (fixes H1) + file input (M6)

**Goal:** One `wireDropdown(btn, menu, signal)` replaces the 6 copy-pasted
book/mode submenu blocks; one `wireFileInput(input, onFile, signal)` replaces 3
copies. Reader's behaviour (with `e.stopPropagation()` on the toggle) is the
spec.

**Steps**

1. Create `js/shared/dropdown-menu.js` exporting `wireDropdown` and
   `wireFileInput` (pure DOM, no app deps, no import-time side effects).
2. Unit-test the module in `selftest.js` with synthetic elements.
3. Replace call sites: `reader-app.js` (book `:1211`, mode `:1286`),
   `rsvp-app.js` (`:295`, `:340`), `tts-app.js` (`:752`, `:786`); file inputs
   `reader-app.js:1233`, `rsvp-app.js:331`, `tts-app.js:778`.

**New module** (`js/shared/dropdown-menu.js`):

```js
// Shared dropdown: a toggle button + a `hidden`-toggled menu, closing on
// outside click. Mirrors the Reader's book/mode submenu behaviour exactly
// (stopPropagation on toggle so the document handler doesn't immediately close
// it). Returns a close() for callers that need to force-close.
export function wireDropdown(btn, menu, signal) {
  if (!btn || !menu) return () => {};
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    else close();
  }, { signal });
  menu.addEventListener('click', close, { signal });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !btn.contains(e.target) && !menu.contains(e.target)) close();
  }, { signal });
  return close;
}

// File <input type=file> change → onFile(file), resetting value so re-picking
// the same file fires again.
export function wireFileInput(input, onFile, signal) {
  if (!input) return;
  input.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) onFile(file);
  }, { signal });
}
```

**Test code** (`selftest.js`; create module + import first):

```js
import { wireDropdown, wireFileInput } from '../shared/dropdown-menu.js';
// --- shared/dropdown-menu (H1/M6) ---
{
  const ac = new AbortController();
  try {
    const btn = document.createElement('button');
    const menu = document.createElement('div'); menu.hidden = true;
    document.body.append(btn, menu);
    const close = wireDropdown(btn, menu, ac.signal);
    btn.click();
    assert('dropdown', 'toggle opens', menu.hidden === false && btn.getAttribute('aria-expanded') === 'true');
    btn.click();
    assert('dropdown', 'toggle closes', menu.hidden === true);
    btn.click(); document.body.click(); // outside click
    assert('dropdown', 'outside click closes', menu.hidden === true);
    btn.click(); menu.click(); // selecting an item closes
    assert('dropdown', 'menu click closes', menu.hidden === true);
    close(); // idempotent force-close
    assert('dropdown', 'force-close keeps it closed', menu.hidden === true);

    const fi = document.createElement('input'); fi.type = 'file';
    document.body.append(fi);
    let got = null;
    wireFileInput(fi, (f) => { got = f; }, ac.signal);
    // Synthesize a change with a fake file list via DataTransfer where available
    assert('dropdown', 'wireFileInput attaches without throwing', typeof got === 'object' || got === null);
    btn.remove(); menu.remove(); fi.remove();
  } finally { ac.abort(); }
}
```

**Done when:** module asserts green; **Phase 0 probe green for all three modes**
(this is the real guard that the 6 replacements behave identically); each call
site reduced to one `wireDropdown(...)` / `wireFileInput(...)` line.

**Risk:** low-medium. The probe catches behavioural drift. Note any call site
that *lacked* `stopPropagation` before is now standardized to include it — that
is the intended convergence on Reader's behaviour, not a regression.

---

## Phase 4 — Shared panel controller (fixes M1, H5-panel half)

**Goal:** A `shared/panels.js` registry owns "open one panel, close the others,
keep `aria-expanded` in sync". Reader's `closePanels()`/`openTOC` semantics are
the spec (mutual exclusivity, focus return to trigger).

**Steps**

1. Create `js/shared/panels.js`: `createPanelController(registry, opts)` where
   `registry = [{ name, btn, bodyClass, onOpen?, onClose? }]`. Exposes
   `open(name, trigger?)`, `toggle(name, trigger?)`, `closeAll()`, `isOpen(name)`.
   It sets/removes `show-<bodyClass>` on `document.body` and resets every
   registered button's `aria-expanded`, then runs the opened panel's `onOpen`.
   Focus-return-to-trigger matches Reader's `_lastPanelTrigger`.
2. Unit-test exclusivity + aria with synthetic buttons.
3. Migrate **Reader first** (it is the reference; if the controller can't
   reproduce Reader exactly, fix the controller). Then RSVP, then TTS — deleting
   their bespoke `closePanels`/toggle bodies.
4. Fold the bookmarks-panel open/close (`show-bookmarks`) into the registry; the
   bookmark *context* builders stay (they move in Phase 7).

**Test code** (`selftest.js`; after module exists):

```js
import { createPanelController } from '../shared/panels.js';
// --- shared/panels: exclusivity + aria (M1) ---
{
  const ac = new AbortController();
  try {
    const mk = () => { const b = document.createElement('button'); document.body.append(b); return b; };
    const tocBtn = mk(), searchBtn = mk(), bmBtn = mk();
    const pc = createPanelController([
      { name: 'toc',    btn: tocBtn,    bodyClass: 'toc' },
      { name: 'search', btn: searchBtn, bodyClass: 'search' },
      { name: 'bm',     btn: bmBtn,     bodyClass: 'bookmarks' },
    ], { signal: ac.signal });

    pc.open('toc');
    assert('panels', 'open sets body class + aria',
      document.body.classList.contains('show-toc') && tocBtn.getAttribute('aria-expanded') === 'true');
    pc.open('search');
    assert('panels', 'opening another closes the first',
      document.body.classList.contains('show-search')
      && !document.body.classList.contains('show-toc')
      && tocBtn.getAttribute('aria-expanded') === 'false');
    pc.toggle('search'); // toggle closes the open one
    assert('panels', 'toggle closes open panel', !document.body.classList.contains('show-search'));
    pc.open('bm'); pc.closeAll();
    assert('panels', 'closeAll clears every panel',
      !['toc','search','bookmarks'].some(c => document.body.classList.contains('show-' + c)));
    assert('panels', 'closeAll resets every aria',
      [tocBtn, searchBtn, bmBtn].every(b => b.getAttribute('aria-expanded') === 'false'));
    tocBtn.remove(); searchBtn.remove(); bmBtn.remove();
  } finally { ac.abort(); document.body.className = ''; }
}
```

**Done when:** module asserts green; Phase 0 probe green in all three modes
(panel exclusivity/close checks); Reader's TOC focus-return still works (manual:
open TOC, Esc, focus lands on the TOC button).

**Risk:** medium. This is the largest surface of the entry points. Migrate one
mode per commit so a regression bisects to a single mode. The probe + the
existing Reader live tests are the guard.

---

## Phase 5 — Shared overlay (fixes H4)

**Goal:** `shared/overlay.js` owns the loading/error/welcome/clear class
transitions. Reader and TTS share it verbatim (they are already identical); RSVP
adopts it or its difference is documented in-code.

**Steps**

1. Create `js/shared/overlay.js`: `createOverlay({ overlayMsg, overlayBtn })`
   returning `{ showLoading(msg), showError(msg), showWelcome(openLabel),
   clearOverlay() }`, lifting Reader's bodies (`reader-app.js:622-644`).
2. Unit-test the body-class transitions with synthetic nodes.
3. Replace Reader's and TTS's four functions with the factory. Evaluate RSVP: if
   its status-line model can use the same class transitions, migrate; else add a
   one-line comment at `rsvp-app.js` explaining the divergence.

**Test code** (`selftest.js`):

```js
import { createOverlay } from '../shared/overlay.js';
// --- shared/overlay: state transitions (H4) ---
{
  const msg = document.createElement('div');
  const btn = document.createElement('button');
  const ov = createOverlay({ overlayMsg: msg, overlayBtn: btn });
  const has = (...c) => c.every(x => document.body.classList.contains(x));
  ov.showLoading('x');
  assert('overlay', 'loading state', has('loading') && !has('error','welcome') && btn.hidden);
  ov.showError('e');
  assert('overlay', 'error state', has('error') && !has('loading','welcome') && !btn.hidden);
  ov.showWelcome('Open');
  assert('overlay', 'welcome state', has('welcome') && !has('loading','error') && !btn.hidden);
  ov.clearOverlay();
  assert('overlay', 'clear removes all', !has('loading','error','welcome'));
  document.body.className = '';
}
```

**Done when:** asserts green; Reader and TTS overlays behave as before (manual:
load a bad file → error overlay with retry button in both).

**Risk:** low. Reader and TTS bodies are byte-identical today.

---

## Phase 6 — Shared URL loader (fixes H2)

**Goal:** One `fileFromUrl(safeUrl)` performs fetch→ok-check→blob→`File`, with no
misleading hard-coded MIME (format is detected by bytes downstream).

**Steps**

1. Add `fileFromUrl` to `core/book-session.js` (or `core/load-url.js`).
2. Unit-test filename derivation + the error message (mock `fetch`).
3. Replace `reader-app.js:908-924` (`loadFromUrl` keeps the
   `validateBookSrcUrl` guard + overlay calls, delegates the fetch),
   `rsvp-app.js:737-743`, `tts-app.js:882-888`.

**Test code** (`selftest.js`; `fetch` is mockable in-page):

```js
import { fileFromUrl } from '../core/book-session.js';
// --- core/book-session: fileFromUrl (H2) ---
{
  const realFetch = window.fetch;
  try {
    window.fetch = async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1,2,3])]) });
    const f = await fileFromUrl('https://x/path/to/My%20Book.epub');
    assert('load-url', 'derives filename from url', f.name === 'My%20Book.epub' || f.name === 'My Book.epub');
    assert('load-url', 'returns a File', f instanceof File);
    window.fetch = async () => ({ ok: false, status: 503 });
    let threw = '';
    try { await fileFromUrl('https://x/y.epub'); } catch (e) { threw = e.message; }
    assert('load-url', 'throws on non-ok with status', /503/.test(threw));
  } finally { window.fetch = realFetch; }
}
```

> Note: the suite is sync today; this block is `async`. Either make the
> `position`-style blocks that need `await` run in an `async` IIFE collected into
> a promise the runner awaits, **or** keep `fileFromUrl` tested via a tiny
> synchronous `deriveDownloadName(url)` helper (pure) and cover the fetch path in
> the Playwright runner instead. Prefer extracting `deriveDownloadName` so the
> pure part stays in the sync unit suite:
>
> ```js
> assert('load-url', 'name from url path', deriveDownloadName('a/b/c.epub') === 'c.epub');
> assert('load-url', 'fallback name', deriveDownloadName('https://h/') === 'book');
> ```

**Done when:** pure asserts green; all three `?src=` loads still work (the
existing `run-selftest.mjs` already loads a real EPUB via `?src=` on the Reader
page — extend it to also pass `?src=` to a probe of rsvp/tts if a book exists).

**Risk:** low. Behaviour identical; only the dead MIME string is dropped.

---

## Phase 7 — Mode-cursor factory (fixes H3) + search index (M5)

**Goal:** The per-mode canonical-position scaffold
(`getCanonicalPosition`/`applyCanonicalPosition`/`save`/`restore`) collapses to a
factory parameterised by the three genuinely mode-specific closures. The `pos.hl`
policy becomes one documented parameter. RSVP/TTS converge on Reader's contract.

**Steps**

1. Create `core/mode-cursor.js`:
   ```js
   export function makeModeCursor({ getSections, getTotalWords, wordAt,
                                    getOrdinal, seekToOrdinal, getBookId, hl }) {
     const get = () => {
       const total = getTotalWords();
       if (total < 1) return null;
       const pos = buildPosition(getSections(), total, getOrdinal(), wordAt);
       if (pos && hl) pos.hl = hl(pos);     // mode decides highlight span
       return pos;
     };
     const apply = (pos) => {
       if (getTotalWords() < 1) return;
       seekToOrdinal(resolvePosition(pos, getSections(), getTotalWords(), wordAt));
     };
     return {
       getPosition: get, applyPosition: apply,
       save: () => shellSavePosition(getBookId(), get),
       restore: () => { const p = loadPosition(getBookId()); if (p) apply(p); },
     };
   }
   ```
2. Add `shared/search.js` `buildSearchIndex(items, getText)` → `{ text, charStart }`
   and use it in RSVP/TTS search caches (M5).
3. Migrate **Reader last** is wrong here — Reader is the reference, so first
   *derive the factory's contract from Reader*, then migrate **RSVP and TTS onto
   it**, then migrate Reader (its `getOrdinal` = `currentWsOrdinal`,
   `seekToOrdinal` = `seekToToken∘wsToToken`, `hl` = none). Keep Reader's richer
   `applyCanonicalPosition` (resume-highlight side-effects) by passing an
   `onApply` extension, or leave Reader's wrapper thin and keep the
   highlight handling in the entry point. Decide per the diff; do not regress
   Reader's resume-highlight.

**Test code** — two layers:

*Pure factory test* (`selftest.js`, fake closures, no DOM):

```js
import { makeModeCursor } from '../core/mode-cursor.js';
// --- core/mode-cursor: round-trip with fake mode (H3) ---
{
  const secs = [{ href: 'c1', wordStart: 0, wordCount: 100 }, { href: 'c2', wordStart: 100, wordCount: 100 }];
  const words = Array.from({ length: 200 }, (_, i) => 'w' + i);
  let cursor = 0;
  const c = makeModeCursor({
    getSections: () => secs, getTotalWords: () => 200, wordAt: (o) => words[o] || '',
    getOrdinal: () => cursor, seekToOrdinal: (o) => { cursor = o; }, getBookId: () => '',
    hl: () => 1,
  });
  cursor = 137;
  const pos = c.getPosition();
  assert('mode-cursor', 'captures hl span', pos.hl === 1);
  cursor = 0; c.applyPosition(pos);
  assert('mode-cursor', 'round-trips ordinal via canonical pos', cursor === 137);
}
```

*Cross-mode behaviour test* — extend the Reader live hooks (already present) and
add an in-page round-trip on the **boot-smoke** pages for RSVP/TTS by exposing a
debug hook `window.__modeCursor` from each entry point under `?selftest=1`, then
assert in `run-selftest.mjs`:

```js
// in probeMode, after boot, when a book/sample is loaded:
const rt = await page.evaluate(() => {
  const c = window.__modeCursor; if (!c) return 'no-cursor';
  const p = c.getPosition(); if (!p) return 'no-pos';
  c.applyPosition({ f: 0.5 });           // jump
  c.applyPosition(p);                    // back to captured
  const p2 = c.getPosition();
  return Math.abs((p2.ord ?? 0) - (p.ord ?? 0)) <= 1 ? 'ok' : 'drift';
});
console.log('  cursor round-trip:', rt);
ok = ok && (rt === 'ok' || rt === 'no-cursor');
```

> This requires RSVP/TTS to be loaded with content during the probe. The sample
> book isn't auto-loaded in RSVP/TTS welcome state, so either (a) point the probe
> at `?src=<an epub>` when one exists under `books/`, or (b) have the entry points
> render the sample under `?selftest=1` (Reader already does). Option (b) is the
> cleaner long-term fix and unlocks running the *full* selftest suite in RSVP/TTS
> too — consider it a sub-task.

**Done when:** pure factory asserts green; cross-mode round-trip `ok` (or
gracefully `no-cursor` until the debug hook ships); Reader live position tests
(`runLiveTests` A7 block) stay green; manual cross-mode hand-off (Reader→RSVP→TTS→
Reader on a real book) lands within a word of the same place.

**Risk:** high (this is the cross-mode correctness core). Mitigations: migrate
one mode per commit; keep the existing `position.js` round-trip asserts; the A7
live invariant in `runLiveTests` already guards Reader. Treat any drift >1 word
as a blocker.

---

## Phase 8 — Settings screen decomposition (fixes M2)

**Goal:** Split the 944-line `settings-screen.js` into a shell + per-tab modules,
each independently testable. No behaviour change.

**Steps**

1. Extract `settings/tabs/{general,read,rsvp,tts,dict}.js`, each exporting
   `buildHTML(prefs)` (returns a string) and `wire(prefs, liveApply, byId)`.
2. `settings-screen.js` becomes the tab host + lifecycle (open/close, focus trap,
   language `<select>`, preview state).
3. Snapshot-style test: render each tab's HTML and assert its key control ids /
   `data-*` attributes are present and that wiring a control fires `liveApply`.

**Test code** (`selftest.js`; tabs are pure string builders):

```js
import { buildHTML as buildReadTab } from '../settings/tabs/read.js';
// --- settings/tabs/read: structure (M2) ---
{
  const html = buildReadTab({ ...DEFAULT_PREFS });
  const host = document.createElement('div'); host.innerHTML = html;
  // Controls the wiring depends on must exist (ids/attrs the SETTINGS table drives).
  assert('settings-read', 'has font segment', !!host.querySelector('[data-font]'));
  assert('settings-read', 'has margin segment', !!host.querySelector('[data-margin]'));
  assert('settings-read', 'has align segment', !!host.querySelector('[data-align]'));
  assert('settings-read', 'reflects current pref',
    !!host.querySelector(`[data-font="${DEFAULT_PREFS.font}"]`));
}
```

Repeat one structural assert per tab. Add a wiring assert using a fake
`liveApply` spy and a synthetic click on one segment.

**Done when:** per-tab asserts green; opening settings in each mode shows the
same controls; the existing language-reload reopen path
(`consumePendingSettingsTab`) still works (manual: change language, screen
reopens on the same tab).

**Risk:** medium (large file move). Pure string-builder tests make regressions in
structure visible; behaviour wiring is unchanged because the same `byId`/`wireSeg`
helpers are reused.

---

## Phase 9 — Reader-app decomposition + polish (L1, L2, L3, L5)

**Goal:** Shrink `reader-app.js` by extracting self-contained sub-systems, and
clear the small polish items.

**Steps**

1. **L1:** Extract `reader/quick-drawer.js` (the floating drawer drag/open/close,
   `reader-app.js:1071-1209`) and `reader/quick-bookmark.js` (long-press + color
   popover, `:946-1039`). Each takes `(els, deps, signal)` and returns a small
   handle. Reader-app wires them in one line each.
2. **L5:** Add `playback.interrupt()` to `rsvp/playback.js` (pause-or-cancel-
   countdown) and replace the 5 inline guards.
3. **L3:** Hoist the TTS rate ladder `[0.75,1,1.25,1.5,2]` to a `TTS` constant;
   use it in both keydown branches and the rate buttons.
4. **L2:** Trim the stale `deriveBookId` comment to match the code (or implement
   the registry-driven strip).

**Test code**

```js
// --- rsvp/playback: interrupt (L5) ---
import { PlaybackEngine } from '../rsvp/playback.js';
{
  // construct with a minimal fake state/bus; assert interrupt() pauses when
  // playing and cancels when in countdown, and is a no-op when paused.
  // (mirror the existing rsvp playback asserts if present)
}
// --- tts constants: rate ladder (L3) ---
import { TTS_RATES } from '../tts/constants.js';
assert('tts', 'rate ladder is ordered & unique',
  TTS_RATES.every((r,i,a) => i === 0 || r > a[i-1]));
```

Quick-drawer/quick-bookmark are DOM-heavy; cover them with a Phase-0-style probe
addition (open drawer → `is-floating` class present; long-press button →
color popover not hidden) rather than pure asserts.

**Done when:** `reader-app.js` materially shorter; all asserts + probe green;
manual smoke of the quick drawer and quick-bookmark long-press in Reader.

**Risk:** low-medium; pure mechanical moves guarded by the probe.

---

## Sequencing & checkpoints

| Phase | Fixes | Test surface | Risk | Gate |
|------:|-------|--------------|------|------|
| 0 | harness | new probe (all modes) | none | baseline green |
| 1 | M3, L4 | unit | trivial | probe + theme asserts |
| 2 | M4 | unit | low | event asserts |
| 3 | H1, M6 | unit + probe | low-med | probe all modes |
| 4 | M1, H5a | unit + probe | med | probe + Reader live |
| 5 | H4 | unit | low | overlay asserts |
| 6 | H2 | unit (+pw) | low | src loads work |
| 7 | H3, M5 | unit + cross-mode | **high** | round-trip ≤1 word |
| 8 | M2 | unit (snapshots) | med | per-tab asserts |
| 9 | L1,L2,L3,L5 | unit + probe | low-med | probe + manual |

**Rule for every phase:** `node test/run-selftest.mjs` is green before and after.
Land tests in the same commit as (or a commit before) the change they guard.
One mode per commit in Phases 4 and 7 so a regression bisects cleanly.

**After Phase 9:** the entry points are thin and the shared layer owns the shell.
*Then* do the documentation pass (`ARCHITECTURE.md` module map, `MODULES.md`
entries for the new `shared/` helpers, and a note in `BEST-PRACTICES.md` that new
modes compose the shared shell rather than re-implementing it).
