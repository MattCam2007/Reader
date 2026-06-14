# S Pen Build-Sheets — Index & Build Procedure (`00-INDEX-AND-PROCEDURE.md`)

> **Read this whole file before starting any phase.** It tells you *how* to build
> a phase; each `phase-N-*.md` tells you *what*. The phases assume you follow this
> procedure exactly. You do not need to invent anything — every decision is made
> for you here or in the phase sheet.

Master plan & rationale: [`../spen-support.md`](../spen-support.md).
Subsystem map: [`../../docs/INPUT.md`](../../docs/INPUT.md).
Test harness: [`../../docs/TESTING.md`](../../docs/TESTING.md).
Invariants you must not break: [`../../docs/BEST-PRACTICES.md`](../../docs/BEST-PRACTICES.md).

---

## 1. The build order

| Build this | Sheet | Tier | Depends on |
| --- | --- | --- | --- |
| 1 | [`phase-1-hover-preview.md`](phase-1-hover-preview.md) | Web | baseline (shipped) |
| 2 | [`phase-2-barrel-and-eraser.md`](phase-2-barrel-and-eraser.md) | Web | baseline highlight store |
| 3 | [`phase-3-pressure-highlighter.md`](phase-3-pressure-highlighter.md) | Web | Phase 2 (or baseline) |
| 4 | [`phase-4-native-bridge-and-remote.md`](phase-4-native-bridge-and-remote.md) | Native | baseline; fake-bridge testable now |
| 5 | [`phase-5-pen-detach-automode.md`](phase-5-pen-detach-automode.md) | Native | Phase 4 receiver |

Build them in this order. Each is a separate branch and PR. **Do not start phase
N+1 until phase N's `node test/run-selftest.mjs` is green.**

---

## 2. The 9-step procedure for every phase

Every phase sheet is organised so you can follow these steps top to bottom:

1. **Read the baseline.** Open the files the sheet's "Files to touch" lists and
   read them fully. They already work — you are extending, not rewriting.
2. **Create the pure module.** Add the small `js/reader/*.js` (or `js/core/*.js`)
   the sheet specifies, containing only the **pure decision function(s)** with the
   exact signatures given. No DOM access in these functions.
3. **Unit-test the pure module.** Add the `import` + the `// ---` assert block to
   `js/test/selftest.js` exactly as the sheet lists. Run `node
   test/run-selftest.mjs`; the new asserts must pass before you wire anything.
4. **Add the pref.** Follow [`CONTRIBUTING.md` §3](../../docs/CONTRIBUTING.md): add
   to `DEFAULT_PREFS` and the `SETTINGS` table in `js/core/constants.js`, with the
   exact key/default the sheet gives. Add the settings-screen control markup.
5. **Wire it in.** Make the minimal edits the sheet lists to `js/reader/input.js`
   and/or `js/reader-app.js`, routing the hardware signal through a callback to the
   feature module. Keep the touch state machine untouched.
6. **Functional-test the wiring.** Add the live/`runLiveTests` hook assertions
   and/or the Playwright gesture spec the sheet specifies.
7. **Add the measurable-better assertion.** The sheet names the metric, baseline,
   and target. Write the test that produces that number (see `TESTING.md` §5). It
   must be green.
8. **Add the accidental-action-rate assertion.** Prove the new passive signal
   mutates nothing it shouldn't.
9. **Manual-verify on a Galaxy + S Pen** against the sheet's manual checklist,
   then commit. (CI only proves the logic; hardware proves the feel.)

If a step has no work for a given phase, the sheet says so explicitly.

---

## 3. The pure-function discipline (why every phase has step 2–3)

`js/reader/input.js` event handlers cannot be unit-tested — they need a live
viewport and real PointerEvents. So **every phase isolates its decision into a
pure function** that takes plain numbers/strings and returns a plain result. That
function gets fast unit tests; the handler that calls it gets a functional test.
This is the single most important convention in these sheets. Example shapes:

```js
classifyPenSignal(buttons, pressure) -> 'hover'|'tip'|'barrel'|'eraser'   // Phase 2
isHover(pointerType, buttons, pressure) -> boolean                        // Phase 1
pressureToWeight(pressure) -> 'light'|'medium'|'heavy'                    // Phase 3
gestureToAction(gesture, mode, mapping) -> actionName | null              // Phase 4
```

Keep them dependency-free and exported, so `selftest.js` can import them.

---

## 4. The measurable-better contract (step 7, every phase)

The whole point of S Pen support is *beating the generic-stylus baseline by a
number*. Each sheet states:

- **Metric** — which family (interaction cost / latency / accidental rate /
  hands-free reachability — `spen-support.md` §3).
- **Baseline** — the number for the shipped path (e.g. "3 taps to define").
- **Target** — the S Pen number (e.g. "0 taps").
- **Enforcing test** — the assertion that computes and checks it.

A phase is **not done** until that assertion is green. If you cannot write it, stop
and re-read the sheet — the feature is mis-scoped.

---

## 5. Guardrails (the short list — full list in BEST-PRACTICES.md)

- Locator, never a live Range, for anything persisted.
- Feature-detect every hardware read; degrade to a no-op.
- Add to the **pen branch**, never the touch machine.
- Clean up contact flags/classes on `pointerup` **and** `pointercancel`.
- One pref, safe default, declarative wiring.
- No new dependency; offline keeps working; finger + keyboard unchanged.

---

## 6. Shared helpers you will reuse (don't reimplement)

| Need | Use |
| --- | --- |
| Word under a point | `wordAtPoint(state, x, y)` (`js/model/geometry.js`) → index or −1 |
| Word ↔ portable locator | `toLocator` / `resolveLocator` (`js/model/locator.js`) |
| Commit a highlight from word indices | `highlights.createFromWords(a, b, color)` |
| Find a stored highlight at a point | `highlights.itemAtPoint(x, y)` / `itemAtWord(wi)` |
| Re-paint highlights after relayout | `highlights.renderAll()` |
| Show a definition popover | `onDefine(text, rect)` (wired to `DefinitionPopover.show`) |
| Footnote popover | `js/reader/footnotes.js` (`activePopover`, `dismiss`) |
| Turn a page | `pagination.next()` / `prev()` / `goTo(p)` |
| Active reading mode | `js/mode-switcher.js` (`getCurrentMode()` — add an export if missing) |
| Pref value | `state._prefs.data.<key>` |

---

## 7. After all five phases

- Update `README.md` (the docs table + a short "S Pen" feature blurb).
- Confirm `plans/spen-support.md` §2 metric table reflects the shipped numbers.
- The native shim for Phases 4–5 (one Android class implementing the Samsung S Pen
  Remote SDK and calling `window.__spen.*`) is the only non-web work and is tracked
  separately from these web phases.
