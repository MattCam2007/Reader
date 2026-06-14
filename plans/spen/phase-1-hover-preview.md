# Phase 1 — Hover Preview ("Air View for Books") *(Tier 1, web)*

> **Goal in one line:** when the S Pen *hovers* over a word without touching the
> screen, show a non-committal preview (definition / footnote peek / link peek) —
> zero taps, zero risk of turning the page.

Read first: [`00-INDEX-AND-PROCEDURE.md`](00-INDEX-AND-PROCEDURE.md) and
[`../../docs/INPUT.md`](../../docs/INPUT.md). Build by following the 9-step
procedure there.

---

## Measurable-better contract

| | |
| --- | --- |
| **Metric** | Interaction cost + latency + accidental-action rate |
| **Baseline (shipped)** | To read a word's definition: tap word (shows the selection bar) → tap **Define** = **2 committing taps** (counting rule: `spen-support.md` §3.1 — the bar *appearing* is not a tap) |
| **Target (S Pen)** | Hover the word = **0 taps**; preview painted after the settle timer (no extra user action), and **0** page-turns / highlights from any number of hovers |
| **Enforcing test** | Functional (in-page): dispatch a hover `pointermove` on the viewport, assert the `.reader-def-popover` appears with no taps; dispatch 20 hovers, assert `state.page` and `highlightManager.count()` unchanged |

---

## Files to touch

| File | Change |
| --- | --- |
| `js/reader/hover-preview.js` | **NEW.** Pure hover-detection helpers + the `HoverPreview` controller (debounce, anchor, show/dismiss). |
| `js/reader/input.js` | Add a `pointermove`/`pointerleave` hover listener in the pen branch that calls the controller. ~15 lines. |
| `js/reader-app.js` | Instantiate `HoverPreview`, pass `onDefine` + footnote/link resolvers, hand it to `InputHandler`. |
| `js/core/constants.js` | Add `penHover: true` to `DEFAULT_PREFS` + a `SETTINGS` row. |
| `js/settings/settings-screen.js` (+ template) | Add the `penHoverSeg` toggle. |
| `js/test/selftest.js` | Unit asserts for the pure helpers + a live/functional assert. |

---

## Step 2 — the pure module (`js/reader/hover-preview.js`)

Export these **pure functions** (no DOM):

```js
// Is this PointerEvent an S Pen hover (near, not touching, no button)?
export function isHover(pointerType, buttons, pressure) {
  return pointerType === 'pen' && buttons === 0 && (pressure === 0 || pressure == null);
}

// Has the hover settled on a NEW word long enough to act? Pure debounce decision.
// Returns true when `word` differs from `lastWord` (caller then starts/refreshes a
// timer); used to avoid re-querying on micro-jitter.
export function hoverChangedWord(word, lastWord) {
  return word >= 0 && word !== lastWord;
}
```

The `HoverPreview` class (same file) owns the timer + popover lifecycle and is
*not* unit-tested directly (it touches the DOM) — its decision logic lives in the
pure functions above. Sketch:

```js
export class HoverPreview {
  constructor(state, signal, hooks) {
    // hooks: { onDefine(text, rect), resolveFootnote(wordIdx)|null, resolveLink(wordIdx)|null }
    this.state = state; this._hooks = hooks;
    this._timer = null; this._lastWord = -1; this._card = null;
  }
  onPenMove(x, y) {
    if (!this.state._prefs.data.penHover) return;
    const wi = wordAtPoint(this.state, x, y);            // js/model/geometry.js
    if (!hoverChangedWord(wi, this._lastWord)) return;
    this._lastWord = wi;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._show(wi, x, y), HOVER_SETTLE_MS); // ~120
  }
  dismiss() { /* clear timer, remove card, this._lastWord = -1 */ }
  _show(wi, x, y) { /* footnote? link? else definition via this._hooks.onDefine */ }
}
```

`HOVER_SETTLE_MS` (≈120) goes in `js/core/constants.js`. The *latency the user
feels* is the settle constant plus a cheap synchronous render — so the target is
"`_show` paints synchronously right after the timer fires," not a raced wall-clock
number. **Do not assert a tight wall-clock budget through the test runner's
polling** (it is flaky); instead assert (a) the popover exists after the settle,
and (b) `HOVER_SETTLE_MS <= 150` as a constant check. Keep `_show` cheap (reuse
`DefinitionPopover`, don't build new chrome).

> **Reuse, don't reinvent:** the definition card is the existing
> `DefinitionPopover`, which renders an element with class **`.reader-def-popover`**
> (`js/reader/definition.js:27`) via `onDefine(text, rect)` (already wired in
> `reader-app.js:498` as `definitionPopover.show(text, rect)`). For a footnote-ref
> word, reuse the `footnotes` popover. A link peek is a tiny "Jump to <chapter>"
> card — optional in v1; ship define + footnote first if time-boxed.

---

## Step 3 — unit tests (add to `js/test/selftest.js`)

```js
import { isHover, hoverChangedWord } from '../reader/hover-preview.js';
// ...
// --- reader/hover-preview: hover detection ---
{
  assert('hover', 'pen, no buttons, no pressure → hover', isHover('pen', 0, 0) === true);
  assert('hover', 'pen tip down → not hover', isHover('pen', 1, 0.5) === false);
  assert('hover', 'pen barrel held → not hover', isHover('pen', 2, 0) === false);
  assert('hover', 'finger move → not hover', isHover('touch', 0, 0) === false);
  assert('hover', 'mouse move → not hover', isHover('mouse', 0, 0) === false);
  assert('hover', 'changed-word true on a new word', hoverChangedWord(5, 3) === true);
  assert('hover', 'changed-word false on same word', hoverChangedWord(5, 5) === false);
  assert('hover', 'changed-word false on -1 (whitespace)', hoverChangedWord(-1, 3) === false);
}
```

---

## Step 4 — pref

`DEFAULT_PREFS`: add `penHover: true` (safe: hover never commits anything).
`SETTINGS`: `{ seg: "penHoverSeg", attr: "penhover", pref: "penHover", repaginate: false, transform: v => v === "true" }`.
Add a "Pen hover preview — On/Off" segmented control with `id="penHoverSeg"` to the
reader settings sheet (mirror `penSeg`).

---

## Step 5 — wiring (`input.js` + `reader-app.js`)

In `js/reader/input.js`, add a dedicated hover listener (separate from the
selection pen branch, because hover has `buttons===0` and must NOT set
`_penActive` or `preventDefault`):

```js
viewport.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "pen") return;
  if (this._penActive) return;                 // a contact is in progress, not a hover
  if (isHover(e.pointerType, e.buttons, e.pressure)) {
    this.callbacks.penHoverMove?.(e.clientX, e.clientY);
  }
}, { passive: true, signal });

viewport.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "pen") this.callbacks.penHoverEnd?.();
}, { signal });
```

Also dismiss the hover card on `pointerdown` (the pen landed → switch to the
selection flow) and on page turn.

In `js/reader-app.js`, instantiate and wire:

```js
const hover = new HoverPreview(state, signal, {
  onDefine,
  resolveFootnote: (wi) => /* map word → footnote ref via footnotes module, or null */,
  resolveLink: (wi) => null,   // optional v1
});
// add to the InputHandler callbacks object:
penHoverMove: (x, y) => hover.onPenMove(x, y),
penHoverEnd:  () => hover.dismiss(),
```

Dismiss `hover` in `closePanels`, on book change, and on any `pagination` turn.

---

## Step 6–8 — functional, measurable, accidental-rate tests

**Run these in-page from `runLiveTests`** (it executes inside the browser, so it
can dispatch real `PointerEvent`s on the viewport — no new Playwright spec needed;
see `TESTING.md` §4). The viewport element is `state.els?.viewport` or
`document.querySelector('.reader-viewport')`. Pattern for one hover, settling on a
word whose centre you compute from `wordRange(state, wi).getBoundingClientRect()`:

```js
const vp = document.querySelector('.reader-viewport');
const r = wordRange(state, someAttachedWordIdx).getBoundingClientRect();
const fire = () => vp.dispatchEvent(new PointerEvent('pointermove', {
  pointerType: 'pen', pressure: 0, buttons: 0,
  clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
  bubbles: true, cancelable: true }));
```

Assert:

- **Constant (latency proxy):** `HOVER_SETTLE_MS <= 150` (a stable number, not a
  raced wall-clock).
- **Functional:** fire the hover, `await` the settle (`await new Promise(res =>
  setTimeout(res, HOVER_SETTLE_MS + 30))`), assert
  `document.querySelector('.reader-def-popover') !== null` with **0 taps** in
  between.
- **Accidental rate:** capture `state.page` and `highlightManager.count()`; fire 20
  hover moves across different words; assert both unchanged.
- **Pref off:** set `state._prefs.data.penHover = false`; hover; assert no popover.
- **Cleanup:** dismiss the hover card and restore `penHover` in the `finally`.

---

## Manual checklist (Galaxy + S Pen)

1. Hover a word → definition card within a blink; move away → it dismisses.
2. Hover a footnote superscript → footnote peek (not the dictionary).
3. Land the pen (tip down) → no card; selection flow takes over (baseline intact).
4. Finger does nothing on hover-equivalent moves.
5. Turn pages, rotate, change font size → no stale card; no crash.
6. Toggle the setting off → hover does nothing.

## Acceptance

- Hover preview shows shortly after the pen settles (settle constant ≤ 150 ms);
  never selects, never navigates, never highlights. Finger + keyboard unchanged.
  Pref-gated, default on. No new dependency. `node test/run-selftest.mjs` green
  incl. the measurable assertions.

**Effort: M.**
