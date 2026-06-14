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
| **Metric** | Hands-free reachability (binary capability) |
| **Baseline (shipped)** | Turning a page requires touching the screen. Pen-off-screen page-turn reachable: **0%** (a web page cannot see BLE). |
| **Target (S Pen)** | The S Pen **button** (on by default) turns the page with the pen **off-screen**: page-turn reachable hands-free **0% → 100%**. Air-swipe chapter/WPM actions are **opt-in** (`penAirGestures`, default off), so they are *additional* hands-free capability, not part of the headline number. |
| **Enforcing test** | Functional (in-page): inject a fake `window.SPenBridge`, fire `window.__spen.onButtonClick()` with **no pointer events at all**, assert `state.page` advanced. The green assertion *is* the 0%→100% proof. |

---

## Files to touch (web only)

| File | Change |
| --- | --- |
| `js/core/spen-bridge.js` | **NEW.** Installs the `window.__spen` receiver **once** (idempotent); owns the *active controller* slot; `isBridgeAvailable()`, `bridgeCapabilities()`. |
| `js/reader/spen-remote.js` | **NEW.** `SPenRemoteController` (one per app instance): holds its app's mode + action map + mapping; registers itself as active on construct, clears on teardown. Contains the pure `gestureToAction`. |
| `js/reader-app.js` (and later rsvp/tts apps) | Construct a controller for that app, passing its mode and that mode's real action methods. **Each app registers its own** — see the lifecycle note in Step 5. |
| `js/mode-switcher.js` | *(Optional)* export `getCurrentMode()` for diagnostics; the controller does **not** depend on it — each app's controller already knows its own mode. |
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

## Step 4 — bridge receiver, **as a singleton** (`js/core/spen-bridge.js`)

The receiver `window.__spen` is a **process-global** the native shim calls, but the
app is **torn down and rebooted on every mode switch** (`mode-switcher.js` aborts
each app's listeners). So `window.__spen` must be installed **once**, and route to
whichever app's controller is currently *active*. Never re-assign `window.__spen`
per app — that races the global.

```js
let _active = null; // the SPenRemoteController of the live app, or null

export function setActiveSpenController(c) { _active = c; }
export function clearActiveSpenController(c) { if (_active === c) _active = null; }

export function isBridgeAvailable() {
  try { return !!(window.SPenBridge && window.SPenBridge.isAvailable && window.SPenBridge.isAvailable()); }
  catch (_) { return false; }
}
export function bridgeCapabilities() {
  try { return (window.SPenBridge && window.SPenBridge.getCapabilities && window.SPenBridge.getCapabilities()) || {}; }
  catch (_) { return {}; }
}

// Install the native→web receiver EXACTLY ONCE. Idempotent: safe to call from
// every app boot; only the first call wires window.__spen. Each callback forwards
// to the currently-active controller (or no-ops when none is live).
export function installSPenReceiver() {
  if (window.__spen) return;
  window.__spen = {
    onButtonClick:       () => _active && _active.onButton('button'),
    onButtonDoubleClick: () => _active && _active.onButton('button2'),
    onAirGesture:        (g) => _active && _active.onAir(g),
    onPenAttached:       (a) => _active && _active.onAttach(!!a),
  };
}
```

When no native shim exists nothing ever calls `window.__spen` → dormant, zero cost.
The functional test calls it directly to simulate the native side.

---

## Step 5 — controller + per-app wiring (the lifecycle that matters)

**`js/reader/spen-remote.js`** — one controller **per app instance**. It carries
*its own* mode (the app that built it knows whether it is `read`/`rsvp`/`tts`), so
there is no global-mode lookup. It registers itself as the active controller and —
critically — **clears itself when the app is torn down**, using the same
`AbortController` `signal` every other listener in the app uses.

```js
import { installSPenReceiver, setActiveSpenController, clearActiveSpenController } from '../core/spen-bridge.js';
// gestureToAction + SPEN_SIGNALS are defined in THIS file (Step 2) — keep them
// co-located so the selftest imports them from '../reader/spen-remote.js'.

export class SPenRemoteController {
  // mode: 'read'|'rsvp'|'tts'; actions: { next, prev, ... }; getMapping(): mapping; prefs; signal
  constructor({ mode, actions, getMapping, prefs, signal }) {
    this._mode = mode; this._actions = actions;
    this._getMapping = getMapping; this._prefs = prefs;
    installSPenReceiver();             // idempotent — wires window.__spen once, ever
    setActiveSpenController(this);     // this app is now the live target
    // When the app is torn down (mode switch / unload), stop being the target.
    if (signal) signal.addEventListener('abort', () => clearActiveSpenController(this));
  }
  onButton(signal) { this._run(signal); }                 // 'button' | 'button2'
  onAir(gesture)   { if (this._prefs.data.penAirGestures) this._run(gesture); }
  onAttach(att)    { if (this._actions.onAttach) this._actions.onAttach(att); } // Phase 5
  _run(signal) {
    const action = gestureToAction(signal, this._mode, this._getMapping());
    const fn = action && this._actions[action];
    if (fn) fn();   // + optional brief on-screen toast ("Next page") for feedback
  }
}
```

> **Why this shape (don't skip):** `window.__spen` is global and the native shim
> holds a reference to it for the app's lifetime, but each mode is a *separate app
> instance* with its own listeners aborted on switch. The singleton receiver +
> `setActiveSpenController`/`clearActiveSpenController` (tied to the app's `signal`)
> makes "the live app is the target" correct by construction, with no stale
> pagination calls from a torn-down reader while RSVP is active.

**`reader-app.js`** — build the `actions` map from **real, verified** methods and
construct the controller with `mode: 'read'` and the app's `signal`:

```js
const remote = new SPenRemoteController({
  mode: 'read',
  signal,                                   // the app's AbortController signal
  prefs,
  getMapping: () => prefs.data.spenMapping || DEFAULT_SPEN_MAPPING,
  actions: {
    next: () => pagination.next(),          // pagination.js:219 ✓
    prev: () => pagination.prev(),          // pagination.js:232 ✓
    // Chapter jump uses the REAL seek path (there is no chapters.next()):
    chapterNext: () => seekToToken(sectionFirstTok(state.curChap + 1)),
    chapterPrev: () => seekToToken(sectionFirstTok(state.curChap - 1)),
    toggleToc: () => openTOC(),             // reader-app.js:541 ✓
    onAttach: onPenAttached,                // Phase 5 (no-op stub until then)
  },
});

// Helper: first render-token of a section, clamped (doc.sections[i].wordStart is
// the section's first word — doc-model.js:30; seekToToken is reader-app.js:257).
function sectionFirstTok(i) {
  const secs = state.doc.sections;
  if (!secs || !secs.length) return 0;
  const j = Math.max(0, Math.min(secs.length - 1, i));
  return secs[j].wordStart;
}
```

> **C2 correction:** earlier drafts mapped `chapterNext/chapterPrev` to
> `chapters.next?.()`. **That API does not exist** — `js/reader/chapters.js`
> exports only `buildChapterIndex`. Chapter movement is done by seeking to a
> section's first token via the existing `seekToToken` (which already handles
> attaching a windowed chapter). Use `sectionFirstTok` above.

RSVP/TTS apps, when they adopt the remote, construct **their own**
`SPenRemoteController` with `mode: 'rsvp'`/`'tts'`, their `signal`, and their real
playback methods (e.g. `playback.toggle()` — `playback.js:93`; step/sentence/WPM
methods from their navigation modules — wire to the actual exported names, do not
assume). The singleton receiver routes to whichever is currently active.

> **Air gestures are opt-in** (`penAirGestures: false` default) per §8 — they can
> fire accidentally while gesturing. Button clicks are always on (deliberate).

---

## Step 6–7 — functional + measurable tests

**Run in-page from `runLiveTests`** (where `state`, `prefs` are in scope); restore
any mutated prefs and remove the injected `window.SPenBridge` in the `finally`. The
whole point — **no pointer events, pen off-screen:**

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
