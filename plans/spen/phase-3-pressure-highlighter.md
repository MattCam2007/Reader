# Phase 3 — Pressure-Aware Highlighter *(Tier 1, web)*

> **Goal in one line:** let tip **pressure** choose the highlight's weight
> (light / medium / heavy) *during the same stroke* — so a reader can emphasise a
> passage by pressing harder, with no extra step.

Read first: [`00-INDEX-AND-PROCEDURE.md`](00-INDEX-AND-PROCEDURE.md). Depends on
the highlight store (shipped) and ideally Phase 2 (shares `pen-signals.js` and the
`highlightColor` pref).

---

## Measurable-better contract

| | |
| --- | --- |
| **Metric** | Interaction cost — *expressiveness per action* (distinct emphasis levels reachable in a single highlight gesture) |
| **Baseline (shipped)** | A highlight has **1** weight. Changing emphasis = recolour via the edit menu (extra taps), and there is no intensity at all. |
| **Target (S Pen)** | **3** weights selectable *within the one highlight stroke* (0 extra taps), driven by pressure. |
| **Enforcing test** | Unit: `pressureToWeight` maps the three pressure bands to `light/medium/heavy`. Functional: a stroke sampled at high pressure stores `weight:'heavy'`; the stored item round-trips and `renderAll()` does not throw. |

---

## Files to touch

| File | Change |
| --- | --- |
| `js/reader/pen-signals.js` | Add pure `pressureToWeight(pressure)`. |
| `js/core/highlights.js` | Accept + persist an optional `weight` on items (additive, default `'medium'`). |
| `js/reader/highlight-render.js` | `createFromWords` accepts a `weight`; publish weight into the `::highlight` name or a CSS var so the paint differs. |
| `js/reader/input.js` | Sample `e.pressure` over the pen-selection drag; pass the representative weight on commit. |
| `css/components/selection.css` | Per-weight opacity for `::highlight(hl-<color>)` (light/medium/heavy). |
| `js/core/constants.js` | (Optional) `penPressure: true` pref + `SETTINGS` row. |
| `js/test/selftest.js` | Unit asserts for `pressureToWeight`; live assert for weight persistence. |

---

## Step 2 — pure function (`js/reader/pen-signals.js`)

```js
// Map analog tip pressure (0..1) to a discrete highlight weight. Pure.
// Bands chosen so a light rest is 'light', normal writing is 'medium', a
// deliberate press is 'heavy'. pressure 0/undefined (e.g. PE level-2 engines or
// a synthetic event) defaults to 'medium' so the feature degrades cleanly.
export function pressureToWeight(pressure) {
  if (pressure == null || pressure === 0) return 'medium';
  if (pressure < 0.34) return 'light';
  if (pressure < 0.67) return 'medium';
  return 'heavy';
}
```

For the *representative* weight of a whole stroke, the handler keeps a running
**max** pressure (a deliberate hard press anywhere in the stroke wins) and calls
`pressureToWeight(maxPressure)` on commit. That reduction is trivial; the band
mapping is the pure, unit-tested part.

---

## Step 3 — unit tests (`js/test/selftest.js`)

```js
import { pressureToWeight } from '../reader/pen-signals.js';
// ...
// --- reader/pen-signals: pressure → weight ---
{
  assert('pen-pressure', '0 / undefined → medium (graceful default)',
    pressureToWeight(0) === 'medium' && pressureToWeight(undefined) === 'medium');
  assert('pen-pressure', 'light band',  pressureToWeight(0.2) === 'light');
  assert('pen-pressure', 'medium band', pressureToWeight(0.5) === 'medium');
  assert('pen-pressure', 'heavy band',  pressureToWeight(0.9) === 'heavy');
  assert('pen-pressure', 'band boundaries are monotonic',
    ['light','medium','heavy'].indexOf(pressureToWeight(0.1))
      <= ['light','medium','heavy'].indexOf(pressureToWeight(0.99)));
}
```

---

## Step 4 — store change (`js/core/highlights.js`)

Make `add` accept and persist `weight` (additive — old items without it read as
`'medium'`):

```js
add({ start, end, color = 'yellow', weight = 'medium', text = '', note = '' }) {
  // ...existing id/createdAt...
  const item = { id, createdAt: Date.now(), start, end,
    color: color || 'yellow', weight: weight || 'medium',
    text: (text || '').slice(0, 120), note: note || '' };
  // ...push + _save + return...
}
```

No schema bump (additive, safe default). Add an `updateWeight(id, weight)` mirroring
`updateColor` if you want post-hoc adjustment (optional).

---

## Step 5 — render + wiring

**`highlight-render.js`** — `createFromWords(a, b, color, weight='medium')` passes
`weight` to `manager.add`. In `renderAll`, bucket by `color`+`weight` and publish
under `hl-<color>-<weight>` (the Highlight API supports no per-range CSS vars, so
**distinct `::highlight` names per weight is the only reliable path**).

> ⚠️ **Combinatorial cost — read before you start.** `renderAll` today publishes
> two name families per colour: `hl-<c>` and `hl-<c>-note`. Adding weight as a
> *third* dimension naively yields **colour(4) × weight(3) × note(2) = 24**
> `::highlight` names and 24 CSS rules, and `renderAll` must bucket every item into
> the right one. **Do not cross weight with note.** Keep weight on the *fill*
> (`hl-<color>-<weight>`, 12 names) and keep the note cue as the **separate
> underline layer it already is** — i.e. publish a single `hl-<c>-note` underline
> family in parallel, independent of weight. That holds it to 12 fill names + 4
> note names = 16, and `renderAll` stays a double loop (colour × weight) plus the
> existing note pass. This is the bulk of the phase's work; budget for it.

**`css/components/selection.css`** — three opacity tiers per colour, e.g.:

```css
::highlight(hl-yellow-light)  { background: rgba(255,213,0,.18); }
::highlight(hl-yellow-medium) { background: rgba(255,213,0,.32); }
::highlight(hl-yellow-heavy)  { background: rgba(255,213,0,.50); }
/* …repeat for green/blue/pink… */
```

### The pressure data path (the part that's easy to get wrong)

Pressure is measured in `input.js`, but the **action-bar swatch commit happens in
`highlight-render.js`'s `_showPenBar`** — a different module with no access to the
pen event. There is no weight on the pen-selection state today (`_penSel = { lo,
hi }`, `highlight-render.js:23,165`). So you must **thread the weight through the
selection state**, or the headline (drag → lift → tap swatch) path silently always
commits `'medium'`. Wiring, end to end:

1. **`input.js`** — track the stroke's peak pressure:
   ```js
   // pointerdown (pen selection): this._penMaxPressure = e.pressure || 0;
   // pointermove (pen selection): this._penMaxPressure = Math.max(this._penMaxPressure, e.pressure || 0);
   ```
   Pass the weight through the existing `penSelect` callback (add a 4th arg):
   ```js
   this.callbacks.penSelect(anchor, focus, showBar, pressureToWeight(this._penMaxPressure));
   ```
2. **`reader-app.js`** — forward it:
   `penSelect: (a, b, showBar, weight) => highlights.setPenSelection(a, b, showBar, weight),`
3. **`highlight-render.js`** — store it on the live selection and use it at commit:
   ```js
   setPenSelection(a, b, showBar, weight = 'medium') {
     // …existing…
     this._penSel = { lo: Math.min(a, b), hi: Math.max(a, b), weight };
     // …existing render + bar…
   }
   // in _showPenBar, the swatch handler:
   sw.addEventListener('click', () => {
     this.createFromWords(lo, hi, c, this._penSel.weight);   // <-- weight, not default
     this.clearPenSelection();
   });
   ```
   and `createFromWords(aWi, bWi, color, weight = 'medium')` forwards `weight` to
   `manager.add` (Step 4).
4. **Barrel path (Phase 2)** — `penBarrelDrag` likewise passes
   `pressureToWeight(this._penMaxPressure)` to `createFromWords`.

> Without step 1→3 the pure `pressureToWeight` mapping exists but **never reaches a
> stored highlight via the swatch path** — and a pure-function-only test would not
> catch it. That is exactly why Step 6 adds an end-to-end stroke test below.

---

## Step 6–7 — functional + measurable tests

In `runLiveTests` (in-page; clean up via `addedHighlightIds`):

```js
// (a) Store-level: weight persists and renders.
const w = highlightManager.add({ start, end, color: 'blue', weight: 'heavy', text: 't' });
addedHighlightIds.push(w.id);
assert('pen-pressure', 'weight persists on the stored item',
  highlightManager.getAll().find(i => i.id === w.id).weight === 'heavy');
let ok = true; try { highlights.renderAll(); } catch (_) { ok = false; }
assert('pen-pressure', 'renderAll with weighted highlights does not throw', ok);

// (b) END-TO-END (the one that actually proves the feature works): set a pen
// selection carrying a heavy weight, commit via the same call the swatch uses,
// and assert the STORED item is heavy. This catches the "pressure never reaches
// the commit" bug that a pure-function test cannot see.
highlights.setPenSelection(aWi, bWi, true, 'heavy');
assert('pen-pressure', 'pen selection carries the stroke weight',
  highlights._penSel && highlights._penSel.weight === 'heavy');
const heavy = highlights.createFromWords(aWi, bWi, 'blue', highlights._penSel.weight);
if (heavy) addedHighlightIds.push(heavy.id);
assert('pen-pressure', 'committing the weighted selection stores weight=heavy',
  !!heavy && highlightManager.getAll().find(i => i.id === heavy.id).weight === 'heavy');
highlights.clearPenSelection();

// (c) Measurable: three distinct weights reachable from the mapping (baseline 1).
const levels = new Set([pressureToWeight(0.2), pressureToWeight(0.5), pressureToWeight(0.9)]);
assert('pen-pressure', 'three distinct weights reachable in one stroke (baseline 1)', levels.size === 3);

// (d) Accidental rate / graceful degradation: a zero-pressure commit (synthetic or
// non-pressure engine) still stores a valid 'medium' highlight.
const med = highlights.createFromWords(aWi, bWi, 'blue', pressureToWeight(0));
if (med) addedHighlightIds.push(med.id);
assert('pen-pressure', 'zero-pressure commit degrades to a valid medium highlight',
  !!med && highlightManager.getAll().find(i => i.id === med.id).weight === 'medium');
```

> Test (b) intentionally uses the **same `createFromWords(..., weight)` call the
> swatch handler uses**, so it fails if you forget to thread `_penSel.weight`
> (Step 5). A green pure-mapping test (c) alone would not.

---

## Manual checklist (Galaxy + S Pen)

1. Light drag → faint highlight; firm drag → bold highlight; same gesture, no menu.
2. On a device/engine without pressure → highlights still appear at medium weight.
3. Existing highlights (pre-feature, no `weight`) still render (as medium).
4. Reload → weights persist and re-render correctly after relayout.

## Acceptance

- Pressure selects one of three weights inside the highlight stroke with no extra
  step; degrades to medium without pressure; additive store change (no migration);
  finger/keyboard unaffected. Measurable assertion (3 vs 1) green.

**Effort: M.** The pure mapping + store change are trivial; the real work is the
`renderAll` bucketing and the per-weight `::highlight` names/CSS (see the
combinatorial warning in Step 5 — keep weight off the note dimension).
