# Phase 2 — Barrel-Button & Eraser Power Gestures *(Tier 1, web)*

> **Goal in one line:** use the S Pen's **side (barrel) button** and **eraser end**
> as direct modifiers — barrel+drag highlights in one motion; eraser deletes a
> highlight on contact — collapsing the multi-step select→menu→action flow.

Read first: [`00-INDEX-AND-PROCEDURE.md`](00-INDEX-AND-PROCEDURE.md),
[`../../docs/INPUT.md`](../../docs/INPUT.md) §3 (the `buttons` bitmask).

---

## Measurable-better contract

| | |
| --- | --- |
| **Metric** | Interaction cost (counting rule: `spen-support.md` §3.1 — a drag+lift is one action; a bar/menu *appearing* is not an action) |
| **Baseline (shipped)** | Highlight a passage: drag-select+lift → tap a colour swatch = **2 actions**. Delete: tap highlight (shows the edit bar) → tap **Remove** = **2 actions**. |
| **Target (S Pen)** | Barrel+drag highlights = **1 action, 0 swatch tap**. Eraser over a highlight deletes = **1 contact, 0 menu tap**. |
| **Enforcing test** | Functional: barrel-drag gesture creates exactly one highlight with no swatch tap (`highlightManager.count()` +1, 0 `.reader-sel-bar` shown). Eraser gesture over a span removes exactly one with no edit-bar (`.reader-hl-edit`) shown. |

---

## Files to touch

| File | Change |
| --- | --- |
| `js/reader/pen-signals.js` | **NEW.** Pure `classifyPenSignal(buttons, pressure)`. |
| `js/reader/input.js` | In the pen branch, branch on the classification: barrel→live highlight, eraser→delete. |
| `js/reader/highlight-render.js` | Add `deleteHighlightAt(x, y)` (thin wrapper over `itemAtPoint` + `manager.remove` + `renderAll`). |
| `js/reader-app.js` | Add `penBarrelDrag` / `penErase` callbacks routing to `highlights`. |
| `js/core/constants.js` | `penBarrel: true` in `DEFAULT_PREFS` + `SETTINGS` row. |
| settings template | `penBarrelSeg` toggle. |
| `js/test/selftest.js` | Unit asserts for `classifyPenSignal`; live asserts for `deleteHighlightAt` + barrel create. |

---

## Step 2 — pure module (`js/reader/pen-signals.js`)

```js
// Classify an S Pen contact from its PointerEvent fields. Pure.
// buttons bitmask: 1=tip, 2=barrel, 32=eraser. Eraser wins over barrel wins over tip.
export function classifyPenSignal(buttons, pressure) {
  if (buttons & 32) return 'eraser';
  if (buttons & 2)  return 'barrel';
  if ((buttons & 1) || pressure > 0) return 'tip';
  return 'hover';
}
```

This is also reused by Phase 3. Keep it the single source of truth for "what is
the pen doing right now."

---

## Step 3 — unit tests (add to `js/test/selftest.js`)

```js
import { classifyPenSignal } from '../reader/pen-signals.js';
// ...
// --- reader/pen-signals: S Pen contact classification ---
{
  assert('pen-signals', 'eraser bit wins over all',   classifyPenSignal(32 | 2 | 1, 0.9) === 'eraser');
  assert('pen-signals', 'barrel bit → barrel',        classifyPenSignal(2, 0) === 'barrel');
  assert('pen-signals', 'tip contact → tip',          classifyPenSignal(1, 0) === 'tip');
  assert('pen-signals', 'pressure without tip bit → tip', classifyPenSignal(0, 0.2) === 'tip');
  assert('pen-signals', 'nothing → hover',            classifyPenSignal(0, 0) === 'hover');
}
```

---

## Step 4 — prefs (two additions)

1. **`penBarrel: true`** in `DEFAULT_PREFS` (safe: barrel/eraser require a
   deliberate button press; they cannot fire accidentally for finger users).
   `SETTINGS`: `{ seg: "penBarrelSeg", attr: "penbarrel", pref: "penBarrel", repaginate: false, transform: v => v === "true" }`.
   Add the `penBarrelSeg` toggle ("Pen button shortcuts — On/Off").
2. **`highlightColor: 'yellow'`** in `DEFAULT_PREFS` — **this pref does not exist
   yet** (verified: only the `a11y.highlightColor` i18n strings exist). It is the
   default-colour source for barrel-drag here *and* a dependency of Phase 3, so add
   it now. No `SETTINGS` row is required unless you want a colour picker; a default
   value is enough. (`createFromWords(... || 'yellow')` falls back safely if it is
   somehow missing, but add it explicitly.)

---

## Step 5 — wiring

**`highlight-render.js`** — add:

```js
// Delete the highlight under (x,y), if any. Returns true if one was removed.
deleteHighlightAt(x, y) {
  const item = this.itemAtPoint(x, y);
  if (!item) return false;
  this.manager.remove(item.id);
  this.renderAll();
  return true;
}
```

**`input.js`** — the existing pen `pointerdown` is one monolithic block
(`input.js:236-272`) that sets `_penActive`, decides `_penNavigating =
_penTurnsPage()`, and then either arms navigation or anchors a word selection. You
must **insert the classification branch and define precedence**, not rewrite the
selection/nav logic. Here is the restructured head of the handler:

```js
viewport.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "pen") return;
  this.callbacks.penHoverEnd?.();            // Phase 1: kill any hover card
  this._penActive = true;
  this._penStartX = e.clientX; this._penStartY = e.clientY; this._penStartT = Date.now();
  this._penAnchorWord = -1; this._penMoved = false;
  try { viewport.setPointerCapture(e.pointerId); } catch (_) {}

  // PRECEDENCE: barrel/eraser (a deliberate button) WIN over penTurnsPage nav.
  this._penMode = this.state._prefs.data.penBarrel
    ? classifyPenSignal(e.buttons, e.pressure)   // 'eraser' | 'barrel' | 'tip' | 'hover'
    : 'tip';

  if (this._penMode === 'eraser') {
    document.body.classList.add("pen-contact"); e.preventDefault();
    this.callbacks.penErase(e.clientX, e.clientY);   // erase under the pen now…
    return;                                          // …and on each move (below). No selection.
  }
  // barrel AND tip both drive the word-selection drag; they differ only at COMMIT.
  this._penNavigating = (this._penMode === 'tip') && this._penTurnsPage();
  if (this._penNavigating) { /* …existing nav-arming block, unchanged… */ return; }

  // …existing selection-anchor block, unchanged:
  document.body.classList.add("pen-contact"); e.preventDefault();
  this._penFocusWord = -1;
  this._penAnchorWord = this._wordAtPoint(e.clientX, e.clientY);
}, { signal });
```

Then in the existing `pointermove` / `pointerup` pen handlers:

- **eraser:** on each `pointermove` while `(e.buttons & 32)`, call
  `this.callbacks.penErase(e.clientX, e.clientY)` (a swipe erases each highlight it
  crosses). Nothing on `pointerup` but the usual cleanup.
- **barrel:** identical drag/extend to a tip selection, **but** on `pointerup`
  commit directly instead of showing the action bar — branch on `this._penMode`:
  `if (this._penMode === 'barrel') this.callbacks.penBarrelDrag(anchorWord, focusWord);`
  else the existing `penSelect(..., true)` (action bar).
- **tip:** unchanged baseline selection flow.

When `prefs.data.penBarrel` is **off**, `_penMode` is forced to `'tip'` above, so
barrel/eraser fall through to the exact baseline behaviour (feature-detect +
degrade). A barrel press with no drag (a tap) selects the single word as a tip tap
would — barrel only changes the *commit*, not whether a deliberate gesture happened.

**`reader-app.js`** callbacks:

```js
penBarrelDrag: (a, b) => highlights.createFromWords(a, b, prefs.data.highlightColor || 'yellow'),
penErase:      (x, y) => highlights.deleteHighlightAt(x, y),
```

(`prefs.data.highlightColor` was added in Step 4.2.)

---

## Step 6–8 — functional, measurable, accidental-rate tests

In `runLiveTests` (operate on the attached `state.curChap`; clean up via
`addedHighlightIds`):

```js
// Eraser: seed a highlight, erase at its midpoint word's point, assert -1 and no edit bar.
const it = highlightManager.add({ start, end, color: 'green', text: 't' });
addedHighlightIds.push(it.id);
const before = highlightManager.count();
const midRange = wordRange(state, Math.floor((aWi + bWi) / 2));
const r = midRange.getBoundingClientRect();
const erased = highlights.deleteHighlightAt(r.left + r.width / 2, r.top + r.height / 2);
assert('pen-eraser', 'eraser deletes exactly one highlight, 0 menus',
  erased === true && highlightManager.count() === before - 1
  && document.querySelector('.reader-hl-edit') === null);

// Barrel create: commit a span directly, assert +1 and NO selection action bar.
const n0 = highlightManager.count();
const made = highlights.createFromWords(aWi, bWi, 'yellow');
if (made) addedHighlightIds.push(made.id);
assert('pen-barrel', 'barrel-drag creates one highlight with 0 swatch taps',
  !!made && highlightManager.count() === n0 + 1
  && document.querySelector('.reader-sel-bar') === null);
```

For the full gesture stream (barrel `pointerdown{buttons:2}` → moves → up), add a
Playwright spec per `TESTING.md` §4.2 and assert the same counts plus the
**interaction-cost number** (one committing action).

**Accidental rate:** dispatch barrel-button *hover* moves (`buttons:2,
pressure:0`) and a barrel press with no movement, assert no highlight is created
(barrel only acts on a deliberate drag/tap, not on a hover).

---

## Manual checklist (Galaxy + S Pen)

1. Hold the side button and drag across text → passage highlights immediately in
   the default colour, no menu.
2. Flip to the eraser end, touch a highlight → it disappears; swipe over several →
   each clears.
3. Without the button, drag → normal selection + action bar (baseline intact).
4. Finger never triggers either path.
5. Toggle the setting off → barrel/eraser behave like a plain pen.

## Acceptance

- Barrel-drag = one-motion highlight; eraser = one-contact delete; both pref-gated
  (default on), feature-detected (no barrel/eraser bits → baseline still works),
  finger/keyboard unchanged. Measurable assertions green.

**Effort: S–M** (the store already does the heavy lifting).
