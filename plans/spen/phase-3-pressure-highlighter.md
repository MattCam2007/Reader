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

**`input.js`** — during the pen selection drag, track
`this._penMaxPressure = Math.max(this._penMaxPressure, e.pressure || 0)` on each
`pointermove`; reset on `pointerdown`. On commit (the barrel path from Phase 2, or
the action-bar swatch path), pass `pressureToWeight(this._penMaxPressure)`.

> If Phase 2 is not built, wire weight into the swatch-tap commit in
> `HighlightController._showPenBar` instead (the swatch handler calls
> `createFromWords(lo, hi, c)` — add the weight argument there).

---

## Step 6–7 — functional + measurable tests

In `runLiveTests`:

```js
// Weight persists and renders.
const w = highlightManager.add({ start, end, color: 'blue', weight: 'heavy', text: 't' });
addedHighlightIds.push(w.id);
assert('pen-pressure', 'weight persists on the stored item',
  highlightManager.getAll().find(i => i.id === w.id).weight === 'heavy');
let ok = true; try { highlights.renderAll(); } catch (_) { ok = false; }
assert('pen-pressure', 'renderAll with weighted highlights does not throw', ok);

// Measurable: three distinct weights are reachable from the pure mapping,
// proving 3 emphasis levels exist (baseline = 1) with no extra user step.
const levels = new Set([pressureToWeight(0.2), pressureToWeight(0.5), pressureToWeight(0.9)]);
assert('pen-pressure', 'three distinct weights reachable in one stroke (baseline 1)', levels.size === 3);
```

**Accidental rate:** a zero-pressure (synthetic / non-pressure engine) commit must
still produce a valid `'medium'` highlight — assert it does, proving graceful
degradation, not breakage.

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
