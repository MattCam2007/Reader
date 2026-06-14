# Testing Guide (`docs/TESTING.md`)

How this app is tested, and exactly how to add the **unit** and **functional**
tests every S Pen phase (and any new feature) must ship. There is one test
harness; learn it once.

> Companion: [`CONTRIBUTING.md`](CONTRIBUTING.md) (dev loop & DoD),
> [`INPUT.md`](INPUT.md) (the subsystem under test for stylus work).

---

## 1. The harness in one picture

```
 node test/run-selftest.mjs            ← the single command (also npm test)
        │
        ├─ starts a local static HTTP server over the repo
        ├─ launches headless Chromium (Playwright)
        ├─ opens reader.html?selftest=1   (and ?selftest=1&src=<an .epub> if present)
        │      └─ in the page, js/test/selftest.js runs runSelftest(state, hooks)
        │            └─ pushes {ok,label,module} results to window.__selftestResults
        ├─ reads window.__selftestResults, fails the process on any !ok
        ├─ smoke-boots reader.html?mode=rsvp and ?mode=tts (catch dead dynamic imports)
        └─ exits non-zero on any failure  → CI gate (.github/workflows/selftest.yml)
```

There are **two test styles inside `selftest.js`**, and S Pen phases use **both**:

- **Unit assertions** — pure logic, no live app. Hundreds already exist (locator
  round-trips, format detection, dictionary normalisation…). This is where a
  phase's **pure decision function** is tested.
- **Live/functional assertions** (`runLiveTests`) — drive the *real* reader
  closures via the `hooks` object (layout switches, bookmark add/navigate,
  highlight store round-trips). This is where a phase's **wired behaviour and
  simulated pen-gesture stream** is tested.

Everything runs in real Chromium, so DOM, Pointer Events, `CSS.highlights`,
`caretPositionFromPoint`, and `localStorage` are all available.

---

## 2. Running it

```sh
npm install                         # first time (installs Playwright)
npx playwright install chromium     # first time (browser binary)
node test/run-selftest.mjs          # run everything  (=  npm test)
```

You can also open `reader.html?selftest=1` in a desktop browser for a visual
pass/fail report (`showResults` paints a full-screen overlay). The headless run is
the authority and the CI gate.

---

## 3. Writing a UNIT test (pure decision function)

This is why every phase **extracts its logic into a pure function** (see
`plans/spen/00-INDEX-AND-PROCEDURE.md`). A pure function has no DOM dependency, so
it is trivially asserted.

Example — Phase 2's signal classifier. Suppose you add
`js/reader/pen-signals.js`:

```js
// Pure: classify an S Pen contact from its PointerEvent fields.
export function classifyPenSignal(buttons, pressure) {
  if (buttons & 32) return 'eraser';
  if (buttons & 2)  return 'barrel';
  if (buttons & 1 || pressure > 0) return 'tip';
  return 'hover';
}
```

Add an `import` at the top of `js/test/selftest.js` and a block anywhere in
`runSelftest` before the report:

```js
import { classifyPenSignal } from '../reader/pen-signals.js';
// ...
// --- reader/pen-signals: S Pen contact classification ---
{
  assert('pen-signals', 'eraser bit wins',        classifyPenSignal(32, 0) === 'eraser');
  assert('pen-signals', 'barrel bit → barrel',    classifyPenSignal(2, 0)  === 'barrel');
  assert('pen-signals', 'tip contact → tip',      classifyPenSignal(1, 0.4) === 'tip');
  assert('pen-signals', 'pressure-only → tip',    classifyPenSignal(0, 0.3) === 'tip');
  assert('pen-signals', 'no buttons, no pressure → hover', classifyPenSignal(0, 0) === 'hover');
}
```

`assert(module, label, ok)` is provided inside `runSelftest`. Keep labels specific
— they print on failure. Group related asserts in a `{ }` block with a `// ---`
header, matching the file's style.

---

## 4. Writing a FUNCTIONAL test (simulated S Pen gestures)

Functional tests drive the live app. Two complementary places:

### 4.1 In-page, via `runLiveTests` hooks (preferred for store/render logic)

`runLiveTests(state, hooks, assert)` already receives `highlightManager` and
`highlights` (the live `HighlightController`). Add hooks you need to the object
that `reader-app.js` exports (search `hooks = {` near the bottom of
`reader-app.js`; the highlight ones were added the same way). Then assert against
the real closures, e.g. Phase 2 eraser:

```js
// inside runLiveTests, in the highlights block (attached chapter only)
const it = highlightManager.add({ start, end, color: 'green', text: 't' });
addedHighlightIds.push(it.id);
const before = highlightManager.count();
const erased = highlights.deleteHighlightAt(/* x,y over the span */ px, py);
assert('pen-eraser', 'eraser over a highlight removes exactly one',
  erased === true && highlightManager.count() === before - 1);
```

Use the existing pattern: push every created id to `addedHighlightIds` so the
`finally` cleans up even if an assert throws. Operate only on the **currently
attached chapter** (`state.curChap`) — off-window chapters are detached.

### 4.2 Dispatching synthetic Pointer/`__spen` events from Playwright

For true end-to-end gesture coverage, drive `reader.html` (no `?selftest`) from a
*new* Playwright spec and synthesise events with `page.evaluate`. A pen
`pointermove` hover:

```js
await page.evaluate(() => {
  const vp = document.querySelector('.reader-viewport');
  const r = vp.getBoundingClientRect();
  vp.dispatchEvent(new PointerEvent('pointermove', {
    pointerType: 'pen', pressure: 0, buttons: 0,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    bubbles: true, cancelable: true,
  }));
});
```

A barrel-drag highlight = `pointerdown {buttons:2,pressure:.5}` → several
`pointermove {buttons:2}` → `pointerup`. The Tier-2 remote needs **no pointer
events at all** — inject a fake bridge and call the receiver:

```js
await page.evaluate(() => {
  window.SPenBridge = { isAvailable: () => true,
    getCapabilities: () => ({ button: true, airMotion: false, detachEvents: true }) };
  // app installs window.__spen; fire it:
  window.__spen.onButtonClick();
});
```

> **Where to put new Playwright specs:** extend `test/run-selftest.mjs` with an
> additional page run, or (cleaner) add a sibling `test/spen.mjs` that reuses the
> same `startServer` helper and is invoked from `npm test`. Keep the CI gate
> (`selftest.yml`) running whatever entry you add.

---

## 5. Encoding "measurably better" as a test (the important one)

Each S Pen phase must assert its metric number (see `plans/spen-support.md` §3).
The pattern: **count committed side-effects for a scripted gesture and compare to
the baseline path.**

Interaction-cost example (Phase 1 — definition needs 0 taps vs 3):

```js
// Functional: hover a word, assert the definition popover appeared with ZERO
// committing taps and within the latency budget.
const t0 = Date.now();
// ...dispatch the hover pointermove (Section 4.2)...
await page.waitForSelector('.definition-popover', { timeout: 500 });
const dt = Date.now() - t0;
assert('pen-hover-metric', 'definition shown on hover with 0 taps', true);
assert('pen-hover-metric', 'hover→preview latency ≤ 150ms (' + dt + ')', dt <= 150);
```

Accidental-action-rate example (passive gesture must not mutate):

```js
const turns0 = state.page, hls0 = highlightManager.count();
// ...dispatch 20 hover pointermoves...
assert('pen-hover-metric', 'hovering never turns the page', state.page === turns0);
assert('pen-hover-metric', 'hovering never creates a highlight',
  highlightManager.count() === hls0);
```

Hands-free reachability (Phase 4): fire `window.__spen.onButtonClick()` with no
pointer events and assert `state.page` advanced — baseline could never do this, so
the very existence of a green assertion *is* the 0%→100% proof.

---

## 6. Checklist for a phase's test deliverable

- [ ] Pure decision function unit-tested in `selftest.js` (Section 3).
- [ ] Wired behaviour functional-tested via hooks and/or a Playwright spec (4).
- [ ] The measurable-better assertion with its target number is present and green (5).
- [ ] Accidental-action-rate assertion: the new passive signal mutates nothing (5).
- [ ] `node test/run-selftest.mjs` passes locally and in CI.
- [ ] Cleanup: any state/highlights/bookmarks the test creates are removed in a
      `finally` (no leakage between assertions).
