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
pure functions above. **Critical design point (read this):** a definition is keyed
by *word text*, but a **footnote/link target is an `<a href>` element**, not a word
token — the code identifies note refs element-side (`footnotes.js:15,42`), and
there is no word-index→anchor mapping anywhere. So `_show` must hit-test
**element-first, word-second**:

```js
export class HoverPreview {
  constructor(state, signal, hooks) {
    // hooks: { onDefine(text, rect), peekFootnote(anchor)|null, peekLink(anchor)|null }
    //   peekFootnote/peekLink take the ANCHOR ELEMENT under the pen, not a word index.
    this.state = state; this._hooks = hooks;
    this._timer = null; this._lastKey = null; this._card = null;
  }
  onPenMove(x, y) {
    if (!this.state._prefs.data.penHover) return;
    // Element-first: is the pen over a link/footnote anchor?
    const anchor = document.elementFromPoint(x, y)?.closest('a[href]');
    // Word-second: otherwise, which word token is under the pen?
    const wi = anchor ? -1 : wordAtPoint(this.state, x, y);   // js/model/geometry.js
    if (!anchor && wi < 0) return;                            // nothing hoverable
    // Dedupe on a single key: the anchor's href, or the word index (the word path
    // reuses the pure hoverChangedWord logic conceptually — same word → no-op).
    const key = anchor ? ('a:' + (anchor.getAttribute('href') || '')) : ('w:' + wi);
    if (key === this._lastKey) return;                        // no new target
    this._lastKey = key;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._show(anchor, wi, x, y), HOVER_SETTLE_MS); // ~120
  }
  dismiss() { /* clear timer, remove card, this._lastKey = null */ }
  _show(anchor, wi, x, y) {
    const rect = (anchor || wordRange(this.state, wi))?.getBoundingClientRect?.();
    if (anchor) {                       // footnote or internal link
      this._hooks.peekFootnote && this._hooks.peekFootnote(anchor)      // footnotes.js peekAt
        || (this._hooks.peekLink && this._hooks.peekLink(anchor));
      return;
    }
    if (wi >= 0) {                      // ordinary word → definition
      const text = /* word text from doc.words[wi] */;
      this._hooks.onDefine(text, rect);
    }
  }
}
```

> **`hoverChangedWord` is still the pure unit for the word path** (debounce on a
> new word). The element path debounces on the anchor's `href` (`_lastKey`). Keep
> both in the pure helpers if you want them tested; the element hit-test itself is
> DOM and lives in the class.

**This requires one small new public API on `FootnoteManager`** (its peek logic is
private today — `_isNoteRef`, `_findTarget`, `_show` at `footnotes.js:42,51`). Add:

```js
// In FootnoteManager: peek a note popover for an anchor element, read-only.
// Returns true if it showed one (i.e. the anchor is a resolvable note ref).
peekAt(anchor) {
  if (!this._isNoteRef(anchor)) return false;
  const target = this._findTarget(anchor);
  if (!target) return false;
  this._show(anchor, target);   // reuses the existing popover chrome
  return true;
}
```

`peekFootnote` in the hooks is then `(anchor) => footnotes.peekAt(anchor)`.
`peekLink` (internal-link "Jump to <chapter>") is **optional in v1** — ship
definition + footnote first; if time-boxed, pass `peekLink: null`.

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
> `reader-app.js:498` as `definitionPopover.show(text, rect)`). The footnote peek
> reuses `FootnoteManager`'s popover via the new `peekAt` above — **not** a
> word-index lookup.

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

**Dismiss the hover card when the pen lands** — add this to the existing pen
`pointerdown` handler (top of it, after the `pointerType !== "pen"` guard) so a
landing pen switches cleanly from preview to the selection flow:

```js
this.callbacks.penHoverEnd?.();   // a contact is starting → kill any hover card
```

Also dismiss on page turn (below).

In `js/reader-app.js`, instantiate and wire — note the hooks take the **anchor
element**, not a word index (see Step 2):

```js
const hover = new HoverPreview(state, signal, {
  onDefine,                                   // word → definition
  peekFootnote: (anchor) => footnotes.peekAt(anchor),   // anchor → note popover (new API)
  peekLink: null,                             // optional in v1
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

Assert (`selftest.js` needs `import { HOVER_SETTLE_MS } from '../core/constants.js'`
for the constant check below):

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
