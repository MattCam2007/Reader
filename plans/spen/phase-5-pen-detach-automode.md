# Phase 5 — Pen-Detach Auto-Mode *(Tier 2, native bridge; JS half testable now)*

> **Goal in one line:** when the user **pulls the S Pen out of the silo**, the
> reader automatically enters a "stylus reading mode" (hover preview on, pen never
> turns the page, highlighter affordance visible); when the pen is reinserted, it
> reverts — with **zero taps**.

Read first: [`00-INDEX-AND-PROCEDURE.md`](00-INDEX-AND-PROCEDURE.md) and
[`phase-4-native-bridge-and-remote.md`](phase-4-native-bridge-and-remote.md)
(this phase reuses the `window.__spen.onPenAttached` receiver installed there).

---

## Measurable-better contract

| | |
| --- | --- |
| **Metric** | Interaction cost — taps to enter "stylus mode" |
| **Baseline (shipped)** | To get the stylus-optimised state (hover on, pen-no-turn, highlighter ready) the user opens settings and toggles preferences = **N taps** (≥ 3). |
| **Target (S Pen)** | Detaching the pen does it automatically = **0 taps**; reattaching reverts = **0 taps**. |
| **Enforcing test** | Functional: call `window.__spen.onPenAttached(false)`, assert `body.spen-active` present and the stylus prefs applied with **0** user interactions; `onPenAttached(true)` reverts. |

---

## Files to touch (web only)

| File | Change |
| --- | --- |
| `js/reader/spen-remote.js` | Add an `onAttach(attached)` handler that toggles `body.spen-active` + the stylus prefs. (Receiver already wired in Phase 4.) |
| `js/reader-app.js` | Provide the `onAttach` action: add/remove `body.spen-active`, snapshot/restore prefs. |
| `js/core/constants.js` | `penAutoMode: true` pref + `SETTINGS` row. |
| `css/...` | Optional `body.spen-active` affordances (show a subtle highlighter hint). |
| `js/test/selftest.js` | Pure `autoModeClass(attached, enabled)` unit test + functional attach/detach assert. |

This phase is small. The only non-web part is the native shim broadcasting the
Android S Pen attach/detach intent into `window.__spen.onPenAttached` — built in
the Phase 4 native track.

---

## Step 2 — pure helper (`js/reader/spen-remote.js`)

```js
// Pure: should the document carry the spen-active class right now?
// attached=false means the pen is OUT of the silo (→ stylus mode active).
export function autoModeActive(attached, enabled) {
  return !!enabled && attached === false;
}
```

---

## Step 3 — unit tests (`js/test/selftest.js`)

```js
import { autoModeActive } from '../reader/spen-remote.js';
// ...
// --- reader/spen-remote: pen-detach auto-mode ---
{
  assert('spen-automode', 'pen out + enabled → active', autoModeActive(false, true) === true);
  assert('spen-automode', 'pen in + enabled → inactive', autoModeActive(true, true) === false);
  assert('spen-automode', 'disabled → never active', autoModeActive(false, false) === false);
}
```

---

## Step 4 — pref

`DEFAULT_PREFS`: `penAutoMode: true` (safe: only reacts to a real hardware detach
event, which never occurs in the PWA, so default-on is inert there).
`SETTINGS`: `{ seg: "penAutoModeSeg", attr: "penauto", pref: "penAutoMode", repaginate: false, transform: v => v === "true" }`.
Add the `penAutoModeSeg` toggle ("Auto stylus mode on pen-out — On/Off").

---

## Step 5 — wiring (`reader-app.js`)

Provide the `onAttach` action to the Phase 4 controller:

```js
let _spenPrevPrefs = null;
function onPenAttached(attached) {
  if (!prefs.data.penAutoMode) return;
  const active = autoModeActive(attached, prefs.data.penAutoMode);
  document.body.classList.toggle('spen-active', active);
  if (active) {
    // Entering stylus mode: snapshot then force the stylus-optimised prefs.
    _spenPrevPrefs = { penHover: prefs.data.penHover, penTurnsPage: prefs.data.penTurnsPage };
    prefs.data.penHover = true;
    prefs.data.penTurnsPage = false;   // pen must not turn the page in stylus mode
    applyPrefs();
  } else if (_spenPrevPrefs) {
    // Reverting: restore exactly what the user had.
    prefs.data.penHover = _spenPrevPrefs.penHover;
    prefs.data.penTurnsPage = _spenPrevPrefs.penTurnsPage;
    _spenPrevPrefs = null;
    applyPrefs();
  }
}
// In the Phase 4 SPenRemoteController actions map, REPLACE the `onAttach: () => {}`
// stub with `onAttach: onPenAttached`.
```

> **Do not persist** these forced prefs — they are a transient overlay tied to the
> hardware state. Snapshot in memory, restore on reattach. Persisting them would
> leave the user stuck in stylus mode after the pen goes back in.

---

## Step 6–7 — functional + measurable tests (`runLiveTests` or Playwright)

```js
// Detach: 0 taps, stylus mode engages.
const hadHover = prefs.data.penHover, hadTurn = prefs.data.penTurnsPage;
window.__spen.onPenAttached(false);
assert('spen-automode', 'pen-out engages stylus mode with 0 taps',
  document.body.classList.contains('spen-active') === true
  && prefs.data.penHover === true && prefs.data.penTurnsPage === false);

// Reattach: reverts to the user's prior prefs, still 0 taps.
window.__spen.onPenAttached(true);
assert('spen-automode', 'pen-in reverts to prior prefs with 0 taps',
  document.body.classList.contains('spen-active') === false
  && prefs.data.penHover === hadHover && prefs.data.penTurnsPage === hadTurn);

// Disabled pref → no effect.
prefs.data.penAutoMode = false;
const cls0 = document.body.classList.contains('spen-active');
window.__spen.onPenAttached(false);
assert('spen-automode', 'auto-mode off → detach is inert',
  document.body.classList.contains('spen-active') === cls0);
prefs.data.penAutoMode = true;
```

Restore any mutated prefs in the `finally` of `runLiveTests` (the suite already
snapshots/restores prefs — extend that snapshot to include `penHover`,
`penTurnsPage`, `penAutoMode`).

---

## Manual checklist (Galaxy + S Pen + WebView app)

1. Pull the pen out → a subtle "stylus mode" cue appears; hover preview works; a
   pen swipe does not turn the page.
2. Put the pen back → reverts to exactly the prior settings.
3. Toggle the feature off → detaching does nothing.
4. PWA build (no detach events) → unaffected, no errors.

## Acceptance

- Detaching the pen engages stylus mode with zero taps and reverts cleanly on
  reattach; forced prefs are transient (not persisted); pref-gated (default on but
  inert without hardware); no effect in the PWA. Measurable (0-tap) assertion green.

**Effort: S.**
