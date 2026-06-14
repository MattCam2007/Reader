# Samsung S Pen Support — Master Implementation Plan (`spen-support.md`)

> **Status:** Planning / documentation only. No code in this round.
> **Audience:** the engineer (human or AI) who will build this. Phase build-sheets
> in [`plans/spen/`](spen/) are written for a *small, literal* implementer — every
> file, signature, pref, and test is spelled out so each phase can be built and
> verified in isolation without re-deriving anything.
> **Target platform: Android, Samsung Galaxy with S Pen** (Chrome / Android
> WebView). iOS / Apple Pencil is explicitly out of scope.

---

## 0. Read this first — what is already done, and what this plan adds

The **generic stylus baseline is already shipped.** Do not re-plan or re-build it.
What exists today (see [`plans/stylus-support.md`](stylus-support.md) and the code):

| Shipped | Where | What it does |
| --- | --- | --- |
| **S0 — pen gate** | `js/reader/input.js` (the `pointerdown/move/up/cancel` branch, `_penActive`) | A pen never turns the page (default). `pointerType === 'pen'` is detected; a `penTurnsPage` pref can opt back into navigation. |
| **S1 — pen word selection** | `input.js` pen branch + `HighlightController.setPenSelection` in `js/reader/highlight-render.js`, `wordAtPoint` in `js/model/geometry.js` | Pen tap selects a word; pen drag selects a word-granular range, painted via `::highlight(pen-selection)` (not the native OS selection). |
| **S2 — highlighting** | `js/core/highlights.js` (store), `js/reader/highlight-render.js` (render/edit) | Selection → persisted, locator-addressed highlight; 4 colours; notes; survives repagination/reload. |

**This means a stylus already works like a precise finger.** That is the
*baseline this plan must beat.* The S Pen has hardware a generic stylus path
ignores: **hover (Air View), a barrel button, an eraser tip, analog pressure/tilt,
and BLE "Air Action" remote button + gestures.** This plan turns each of those
into a reader feature and — crucially — **proves each one is measurably better
than the already-shipped baseline** (Section 3).

The exhaustive capability research, the two-tier (web vs native-bridge) framing,
and the device-floor notes live in [`plans/stylus-support.md` §11](stylus-support.md).
That document is **inspiration and reference, not direction.** This plan is the
direction.

---

## 1. The one rule that defines success

> **Every S Pen feature must be *measurably* better than doing the same task with
> the generic stylus baseline — and that measurement must be a CI-enforced number,
> not an opinion.**

"Measurably better" is operationalised in Section 3 as four metric families
(interaction cost, latency, accidental-action rate, hands-free reachability). Each
phase build-sheet names its metric, its **baseline number**, its **target
number**, and the **automated test that enforces the delta.** A phase is not done
until that test is green in `node test/run-selftest.mjs`.

If a proposed S Pen feature cannot be expressed as a beats-the-baseline number, it
does not ship. This is the guardrail against "we added pressure because we could."

---

## 2. Phase map (segregated, independently testable)

Each phase is **one branch, one PR, one revertible unit**, gated behind a pref
with a safe default, and shippable on its own. Phases 1–3 and 5 are **pure web
(Tier 1)** — buildable on the current PWA today. Phase 4 introduces the native
**SPenBridge**; its JS half is built and tested *now* (against a fake bridge) and
lies dormant until the WebView app exists.

```
 BASELINE (shipped):  S0 pen-gate ─ S1 word-select ─ S2 highlight
                            │
 Tier 1 (web, now):         ├─ PHASE 1  Hover preview ("Air View for books")
                            ├─ PHASE 2  Barrel-button + eraser power gestures
                            ├─ PHASE 3  Pressure-aware highlighter
                            └─ PHASE 5  Pen-detach auto-mode  (bridge-gated, web-testable)
 Tier 2 (native bridge):    └─ PHASE 4  SPenBridge + reading remote (button + air gestures)
```

| Phase | Build-sheet | Tier | Headline metric it wins on | Effort |
| --- | --- | --- | --- | --- |
| **1 — Hover preview** | [`spen/phase-1-hover-preview.md`](spen/phase-1-hover-preview.md) | Web | Taps to read a definition: **3 → 0** | M |
| **2 — Barrel + eraser** | [`spen/phase-2-barrel-and-eraser.md`](spen/phase-2-barrel-and-eraser.md) | Web | Actions to highlight: **3 → 1**; to delete: **3 → 1** | S–M |
| **3 — Pressure highlighter** | [`spen/phase-3-pressure-highlighter.md`](spen/phase-3-pressure-highlighter.md) | Web | Highlight weights expressible: **1 → 3** (no extra steps) | S–M |
| **4 — Bridge + reading remote** | [`spen/phase-4-native-bridge-and-remote.md`](spen/phase-4-native-bridge-and-remote.md) | Native | Page-turns reachable with pen off-screen: **0% → 100%** | M + native shim |
| **5 — Pen-detach auto-mode** | [`spen/phase-5-pen-detach-automode.md`](spen/phase-5-pen-detach-automode.md) | Native | Taps to enter "stylus mode": **N → 0** | S |

**Recommended order:** 1 → 2 → 3 → 4 → 5. Phase 1 is the fastest, most delightful,
purely-web win and establishes the hover plumbing the others assume. Phases 2 and
3 layer on the shipped highlight store. Phase 4 is the marquee feature but waits
for (or ships the JS half ahead of) the native app. Phase 5 is polish once the
bridge exists.

The build procedure every phase follows is in
[`spen/00-INDEX-AND-PROCEDURE.md`](spen/00-INDEX-AND-PROCEDURE.md) — **read it
before starting any phase.**

---

## 3. The measurement framework ("measurably better")

The baseline for every comparison is **"the same task performed through the
already-shipped stylus path (S0–S2) or the finger path."** Four metric families:

### 3.1 Interaction cost — *committed actions to complete a task*

Count the discrete, committing user actions (a tap that fires a handler, a
drag-then-lift, a menu open). Fewer is better. Examples:

| Task | Baseline (shipped) | With S Pen | Delta |
| --- | --- | --- | --- |
| See a word's definition | tap word → wait for sel-bar → tap **Define** = **3** | Phase 1: hover, **0** taps | **−3** |
| Highlight a passage | drag-select → lift → tap a colour swatch = **3** | Phase 2 barrel-drag, **1** | **−2** |
| Delete a highlight | tap highlight → menu opens → tap **Remove** = **3** | Phase 2 eraser, **1** | **−2** |

**How it's enforced:** each phase exposes its decision as a *pure function*
(Section 5 / `00-INDEX`) and a functional test scripts the gesture stream, then
asserts the count of committed side-effects (e.g. `CSS.highlights` mutations,
`pagination.page` changes, definition-popover appearances) equals the target.

### 3.2 Latency — *time from intent to result (ms)*

For hover/preview features. Target: a hover preview paints in **≤ 150 ms** from
pen-settle. Enforced by a functional test that timestamps the synthetic
`pointermove` and the popover's appearance.

### 3.3 Accidental-action rate — *unwanted side effects per "passive" gesture*

The S Pen hovers and rests constantly. A passive gesture (hover, a tip-down that
is not a deliberate select, a barrel-button press while reading) must cause **zero**
navigations or content mutations. Enforced: dispatch N passive synthetic events,
assert `pagination.page` unchanged and `highlightManager.count()` unchanged.
**Baseline already gets this right for finger; S Pen must not regress it.**

### 3.4 Hands-free reachability — *binary capability*

For the reading remote (Phase 4): can the action be performed with the pen **not
touching the screen**? Baseline = **no** (impossible — a web page cannot see BLE).
Phase 4 = **yes**. Enforced by a functional test that fires the fake bridge's
`onButtonClick()` with no pointer events at all and asserts the page turned.

> **Rule for the implementer:** if you cannot write the test that produces the
> number, you have not finished designing the feature. Write the test first.

---

## 4. Shared conventions (apply to every phase)

These are non-negotiable and come straight from the codebase's hard-won learnings
(see [`docs/BEST-PRACTICES.md`](../docs/BEST-PRACTICES.md) for the why):

1. **Locator, never live Range.** Anything that remembers a position in the book
   stores a `{s,b,w}` locator and re-resolves it after every relayout. Holding a
   DOM `Range`/node across repagination is a bug — off-screen chapters are
   detached (`js/reader/pagination.js`). The highlight store already obeys this;
   any new persisted anchor must too.
2. **Feature-detect and degrade to a no-op.** A passive/older S Pen, a finger, a
   no-bridge PWA build, or an engine without the Highlight API must never throw
   and never break finger input. Every hardware read is `?.`-guarded; every Tier-2
   call checks `window.SPenBridge?.isAvailable()`.
3. **No new runtime/CDN dependency.** Offline must keep working. Tier 1 is pure
   Pointer Events. Tier 2 is one small native class, not a JS library.
4. **One pref per UX-changing feature, safe default, declarative wiring.** Add to
   `DEFAULT_PREFS` and the `SETTINGS` table in `js/core/constants.js` exactly as
   `penTurnsPage` does (see `phase-*` sheets for the literal lines). Additive →
   no schema bump.
5. **Extract the decision into a pure function.** Event handlers in `input.js` are
   not unit-testable (they need a live viewport + real PointerEvents). So every
   phase pulls its *classification/mapping logic* into a small pure function in a
   new module (e.g. `classifyPenSignal(buttons, pressure)`), which the in-browser
   selftest unit-tests directly, while a Playwright functional test covers the
   wired behaviour. This is how we get both unit **and** functional coverage.
6. **Reuse, don't reinvent.** Hover preview reuses `DefinitionPopover.show` and
   `footnotes`; the remote reuses `pagination.next/prev` and RSVP/TTS playback
   methods; barrel-drag reuses `HighlightController.createFromWords`. The
   plumbing already exists — phases wire hardware signals to it.

---

## 5. The `SPenBridge` contract (Tier 2 — Phases 4 & 5)

Defined once here; Phases 4 and 5 implement against it. The web code checks for it
and no-ops when absent (PWA / Chrome), so it is safe to write the JS half now.

```js
// Present ONLY in the future WebView build; undefined in PWA/Chrome.
window.SPenBridge = {
  isAvailable(): boolean,            // BLE S Pen present & SDK connected
  getCapabilities(): { button: boolean, airMotion: boolean, detachEvents: boolean },
};
// Native → web callbacks (the native shim calls these via evaluateJavascript):
window.__spen = {
  onButtonClick(): void,
  onButtonDoubleClick(): void,
  onAirGesture(g: 'swipe_left'|'swipe_right'|'swipe_up'|'swipe_down'|'circle_cw'|'circle_ccw'): void,
  onPenAttached(attached: boolean): void,
};
```

The native side (one small Android class, **out of scope for the web phases**)
runs the Samsung S Pen Remote SDK flow (`SpenRemote.connect()` →
`SpenUnitManager` → `registerSpenEventListener` on `TYPE_BUTTON` /
`TYPE_AIR_MOTION`) and forwards each event to `window.__spen.*`. Phases 4/5
**define and install `window.__spen`** (the JS receiver) and the controller that
maps events to actions; they are testable today by faking `window.SPenBridge` and
calling `window.__spen.*` from a functional test.

---

## 6. Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Hover events fire continuously → battery / churn | Med | Debounce to settle (~120 ms); only act on a stable word; gate behind `prefs.penHover`; never run for finger/touch. |
| Barrel/eraser `buttons` bits vary by device/engine | Med | Treat them as *enhancements*; feature-detect from observed bits; the select/highlight baseline still works without them. |
| A passive S Pen (no BLE) on a Tier-2 build | Low | `getCapabilities()` drives the UI; Tier-1 features unaffected; Tier-2 silently absent. |
| Pressure/tilt absent on PE-level-2 engines | Low | Default weight when `pressure === 0`/undefined; cosmetic only. |
| Native bridge ships late | Low | Phase 4/5 JS is dormant, fully unit/functional-tested against a fake bridge; flipping it on needs no web rewrite. |
| Input handler regressions (touch ↔ pointer) | Med | Pure-function extraction + functional gesture tests for both finger and pen; never edit the touch state machine when adding a pen path. |

---

## 7. Definition of done (every phase)

Inherits [`docs/CONTRIBUTING.md` §"Definition of done"](../docs/CONTRIBUTING.md):

- One branch off fresh `master`; one revertible PR.
- New UX behind a pref in `DEFAULT_PREFS` + `SETTINGS`, safe default, additive.
- **Unit tests** (pure decision functions) added to `js/test/selftest.js`.
- **Functional tests** (scripted pen-gesture stream) added to the Playwright
  harness; `node test/run-selftest.mjs` is green, including the new
  **measurable-better assertion** with its target number.
- No new CDN/runtime dependency; offline still works; finger + keyboard input
  unchanged (regression-checked).
- The phase's metric (Section 3) is documented in the PR with before/after numbers.

---

## 8. Open questions (carried from research, with defaults to proceed on)

These have safe defaults; the implementer proceeds on the default unless the user
says otherwise.

- **Default S Pen button mapping** (Phase 4): single-click = **next page** in
  read mode, **play/pause** in RSVP/TTS. *(Default.)*
- **Air gestures** (Phase 4): **opt-in**, off by default, to avoid accidental
  turns. *(Default.)*
- **Tier-2 device floor:** Note 10 / Tab S6 / S22 Ultra+ on Android 9+; silently
  fall back to Tier 1 below that. *(Default.)*
- **Hover preview kinds** (Phase 1): definition + footnote-peek + link-peek, all
  under one `penHover` pref. *(Default.)*

---

## 9. Index of build-sheets

| File | Phase |
| --- | --- |
| [`spen/00-INDEX-AND-PROCEDURE.md`](spen/00-INDEX-AND-PROCEDURE.md) | **Start here** — build procedure + the measurable-better test recipe |
| [`spen/phase-1-hover-preview.md`](spen/phase-1-hover-preview.md) | Hover preview |
| [`spen/phase-2-barrel-and-eraser.md`](spen/phase-2-barrel-and-eraser.md) | Barrel button + eraser |
| [`spen/phase-3-pressure-highlighter.md`](spen/phase-3-pressure-highlighter.md) | Pressure-aware highlighter |
| [`spen/phase-4-native-bridge-and-remote.md`](spen/phase-4-native-bridge-and-remote.md) | SPenBridge + reading remote |
| [`spen/phase-5-pen-detach-automode.md`](spen/phase-5-pen-detach-automode.md) | Pen-detach auto-mode |

Supporting documentation produced in this pass:
[`docs/INPUT.md`](../docs/INPUT.md) (the input/stylus subsystem),
[`docs/TESTING.md`](../docs/TESTING.md) (how to write the unit + functional tests),
[`docs/BEST-PRACTICES.md`](../docs/BEST-PRACTICES.md) (the invariants & learnings),
[`docs/CONTRIBUTING.md`](../docs/CONTRIBUTING.md) (procedures & dev loop).
