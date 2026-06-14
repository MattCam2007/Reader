# Phase 4 — SPenBridge + Reading Remote *(Tier 2, native bridge; JS half testable now)*

> **Goal in one line:** use the S Pen like a presentation clicker — its **BLE
> button** and **in-air gestures** turn pages / control playback **with the pen
> not touching the screen**. This is the marquee S Pen feature.

Read first: [`00-INDEX-AND-PROCEDURE.md`](00-INDEX-AND-PROCEDURE.md) and
[`../spen-support.md` §5](../spen-support.md) (the `SPenBridge` contract).

> **Tiering:** the BLE button/air-gestures are invisible to a web page — they need
> a tiny native Android shim (the WebView app, a *future* packaging step). **This
> phase builds and fully tests the JS half now against a faked bridge.** When the
> native app ships, it just calls `window.__spen.*` and the feature lights up with
> zero web rewrite.

---

## Measurable-better contract

| | |
| --- | --- |
| **Metric** | Hands-free reachability (binary capability) + interaction cost |
| **Baseline (shipped)** | Turning a page requires touching the screen. Pen-off-screen page-turns reachable: **0%** (a web page cannot see BLE). |
| **Target (S Pen)** | Button-click / air-swipe turns the page with the pen **off-screen**: **100%** of nav actions reachable hands-free. |
| **Enforcing test** | Functional: inject a fake `window.SPenBridge`, fire `window.__spen.onButtonClick()` with **no pointer events at all**, assert `state.page` advanced. The green assertion *is* the 0%→100% proof. |

---

## Files to touch (web only)

| File | Change |
| --- | --- |
| `js/core/spen-bridge.js` | **NEW.** Installs `window.__spen` receiver; `isBridgeAvailable()`, `bridgeCapabilities()`; feature-detect helpers. |
| `js/reader/spen-remote.js` | **NEW.** `SPenRemoteController`: maps a normalized signal+mode+mapping → an action and invokes it. Contains the pure `gestureToAction`. |
| `js/mode-switcher.js` | Export `getCurrentMode()` (the controller needs the active mode). |
| `js/reader-app.js` (and rsvp/tts apps) | Instantiate the controller, give it the mode's action methods (`pagination.next/prev`, playback toggle…). |
| `js/core/constants.js` | `DEFAULT_SPEN_MAPPING` + `penAirGestures: false` pref (+ `SETTINGS` row). |
| settings template | A small action-picker per signal (can be v1.1) + the air-gestures toggle. |
| `js/test/selftest.js` | Unit asserts for `gestureToAction`; functional assert via fake bridge. |

**Native (out of scope here, tracked separately):** one Android class running the
Samsung S Pen Remote SDK and forwarding events to `window.__spen.*`.

---

## Step 2 — pure mapping (`js/reader/spen-remote.js`)

```js
// Normalized S Pen remote signals.
export const SPEN_SIGNALS = ['button', 'button2', 'swipe_left', 'swipe_right',
  'swipe_up', 'swipe_down', 'circle_cw', 'circle_ccw'];

// Pure: given a signal, the active mode, and the user's mapping, return the
// action name to run (or null). Mapping is a plain object:
//   { read: { button: 'next', swipe_left: 'next', ... }, rsvp: {...}, tts: {...} }
export function gestureToAction(signal, mode, mapping) {
  const m = mapping && mapping[mode];
  if (!m) return null;
  return m[signal] || null;
}
```

`DEFAULT_SPEN_MAPPING` (in `constants.js`), encoding the §8 defaults:

```js
export const DEFAULT_SPEN_MAPPING = {
  read: { button: 'next', button2: 'prev',
          swipe_left: 'next', swipe_right: 'prev', swipe_up: 'chapterNext',
          swipe_down: 'chapterPrev', circle_cw: 'toggleToc', circle_ccw: 'toggleToc' },
  rsvp: { button: 'playPause', button2: 'playPause',
          swipe_left: 'stepNext', swipe_right: 'stepPrev',
          swipe_up: 'wpmUp', swipe_down: 'wpmDown' },
  tts:  { button: 'playPause', button2: 'playPause',
          swipe_left: 'sentenceNext', swipe_right: 'sentencePrev' },
};
```

---

## Step 3 — unit tests (`js/test/selftest.js`)

```js
import { gestureToAction, SPEN_SIGNALS } from '../reader/spen-remote.js';
import { DEFAULT_SPEN_MAPPING } from '../core/constants.js';
// ...
// --- reader/spen-remote: gesture → action mapping ---
{
  const M = DEFAULT_SPEN_MAPPING;
  assert('spen-remote', 'read: button → next', gestureToAction('button', 'read', M) === 'next');
  assert('spen-remote', 'read: double-click → prev', gestureToAction('button2', 'read', M) === 'prev');
  assert('spen-remote', 'rsvp: button → playPause', gestureToAction('button', 'rsvp', M) === 'playPause');
  assert('spen-remote', 'tts: swipe_left → sentenceNext', gestureToAction('swipe_left', 'tts', M) === 'sentenceNext');
  assert('spen-remote', 'unknown signal → null', gestureToAction('nope', 'read', M) === null);
  assert('spen-remote', 'unknown mode → null', gestureToAction('button', 'xyz', M) === null);
  assert('spen-remote', 'SPEN_SIGNALS covers all mapped keys',
    Object.values(M).every(modeMap => Object.keys(modeMap).every(k => SPEN_SIGNALS.includes(k))));
}
```

---

## Step 4 — bridge receiver (`js/core/spen-bridge.js`)

```js
export function isBridgeAvailable() {
  try { return !!(window.SPenBridge && window.SPenBridge.isAvailable && window.SPenBridge.isAvailable()); }
  catch (_) { return false; }
}
export function bridgeCapabilities() {
  try { return (window.SPenBridge && window.SPenBridge.getCapabilities && window.SPenBridge.getCapabilities()) || {}; }
  catch (_) { return {}; }
}
// Install the native→web receiver. `handlers` = { onButton, onButton2, onAir, onAttach }.
export function installSPenReceiver(handlers) {
  window.__spen = {
    onButtonClick:       () => handlers.onButton && handlers.onButton(),
    onButtonDoubleClick: () => handlers.onButton2 && handlers.onButton2(),
    onAirGesture:        (g) => handlers.onAir && handlers.onAir(g),
    onPenAttached:       (a) => handlers.onAttach && handlers.onAttach(!!a),
  };
}
```

The receiver is installed unconditionally (it is just a dispatch table). When no
native shim exists, nothing ever calls it → dormant, zero cost. The functional
test calls it directly to simulate the native side.

---

## Step 5 — controller + wiring

**`js/reader/spen-remote.js`** — `SPenRemoteController`:

```js
export class SPenRemoteController {
  constructor({ getMode, getMapping, actions, prefs }) {
    this._getMode = getMode; this._getMapping = getMapping;
    this._actions = actions;  // { next, prev, chapterNext, ..., playPause, ... }
    this._prefs = prefs;
    installSPenReceiver({
      onButton:  () => this._run('button'),
      onButton2: () => this._run('button2'),
      onAir:     (g) => { if (this._prefs.data.penAirGestures) this._run(g); },
      onAttach:  (a) => this._actions.onAttach && this._actions.onAttach(a), // Phase 5
    });
  }
  _run(signal) {
    const action = gestureToAction(signal, this._getMode(), this._getMapping());
    const fn = action && this._actions[action];
    if (fn) fn();   // + optional brief on-screen toast "Next page" for feedback
  }
}
```

**`mode-switcher.js`** — add `export function getCurrentMode() { return currentMode; }`
(the module already tracks `currentMode`).

**`reader-app.js`** — build the `actions` map from existing methods and instantiate:

```js
const remote = new SPenRemoteController({
  getMode: getCurrentMode,
  getMapping: () => prefs.data.spenMapping || DEFAULT_SPEN_MAPPING,
  prefs,
  actions: {
    next: () => pagination.next(), prev: () => pagination.prev(),
    chapterNext: () => chapters.next?.(), chapterPrev: () => chapters.prev?.(),
    toggleToc: () => openTOC(),
    // rsvp/tts apps provide playPause/stepNext/etc. in their own wiring
  },
});
```

(RSVP/TTS apps instantiate their own controller with their playback actions, or a
single shared controller reads `getCurrentMode()` and each app registers its
actions — pick the simpler given how mode-switcher tears down listeners.)

> **Air gestures are opt-in** (`penAirGestures: false` default) per §8 — they can
> fire accidentally while gesturing. Button clicks are always on (deliberate).

---

## Step 6–7 — functional + measurable tests

The whole point — **no pointer events, pen off-screen:**

```js
// Inject a fake bridge + fire the receiver; assert hands-free page turn.
window.SPenBridge = { isAvailable: () => true,
  getCapabilities: () => ({ button: true, airMotion: true, detachEvents: true }) };
// (reader-app already called installSPenReceiver via the controller)
const before = state.page;
window.__spen.onButtonClick();          // simulate the native BLE button event
assert('spen-remote', 'button click turns the page with NO pointer events (hands-free 0%→100%)',
  state.page === before + 1 || /* at chapter end */ state.page >= before);

// Double-click goes back.
const p1 = state.page;
window.__spen.onButtonDoubleClick();
assert('spen-remote', 'double-click navigates previous', state.page <= p1);

// Air gesture respects the opt-in pref.
prefs.data.penAirGestures = false;
const p2 = state.page;
window.__spen.onAirGesture('swipe_left');
assert('spen-remote', 'air gesture is inert when penAirGestures is off', state.page === p2);
prefs.data.penAirGestures = true;
window.__spen.onAirGesture('swipe_left');
assert('spen-remote', 'air gesture turns page when enabled', state.page !== p2);
```

**Degradation:** with `window.SPenBridge` undefined (the PWA case),
`isBridgeAvailable()` is false and nothing throws — assert that constructing the
controller and leaving `window.__spen` uncalled has no effect on `state.page`.

---

## Manual checklist (Galaxy + S Pen + WebView app, when native shim exists)

1. Pen out of the silo, screen at arm's length: single button-click → next page;
   double-click → previous.
2. Air-swipe left/right (with air gestures enabled) → next/prev.
3. In RSVP/TTS: button = play/pause.
4. In the PWA (no WebView): the feature is silently absent; nothing errors.
5. Remapping a signal in settings persists and takes effect.

## Acceptance

- Button + (opt-in) air gestures drive the active mode's actions hands-free;
  fully feature-detected (no bridge → silent no-op); mapping persisted and
  per-mode; default mapping = §8. The hands-free assertion is green (the 0%→100%
  proof). No web rewrite needed when the native shim lands.

**Effort: M (JS) + a small native class (separate track).**
