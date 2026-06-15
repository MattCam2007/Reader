# Phase 2 — Config & Settings UI (`02-config-and-settings-ui.md`)

**Goal.** Let the user manage webhook endpoints and pick events from a new
**Settings → Smart Home** tab, persisted in `localStorage`. No sending yet (a
stubbed "Test" button is fine; real delivery lands in Phase 3).

**Unlocks (metric):** a round-trippable config (`loadConfig()/saveConfig()`)
and a UI that can add/edit/delete an endpoint, toggle events, and persist —
verified by a live selftest that writes config through the UI path and reads it
back.

**Net-new files:** `js/core/webhook-config.js`.
**Touches:** `js/settings/settings-screen.js`, `js/core/constants.js` (general
defaults), i18n strings, settings CSS.

---

## Step 1 — Read the baseline

- `js/settings/settings-screen.js` — the singleton settings screen. Note:
  - `openSettingsScreen(config)` takes `initialTab` and per-scope `on*Change`
    callbacks; it builds `_screen.innerHTML` with a header + tab strip + panes.
  - **`byId()` is scoped to `_screen`** (book content can shadow global ids — DOM
    clobbering defence). Use `byId`, never `document.getElementById`, inside it.
  - Prefs are module-singletons (`getOrCreatePrefs`) loaded from `localStorage`.
- `js/core/prefs.js` / `PrefsManager` — how prefs persist + emit changes.
- `js/core/constants.js` — `GENERAL_DEFAULTS` (add the global webhook switches +
  daily goal here, since they're app-wide, not per reading mode).

> The Smart Home config is richer than a flat pref (a list of endpoints), so it
> lives in its **own** `localStorage` key (`webhooks:config`) via
> `webhook-config.js`, **not** in a `PrefsManager`. The general-prefs additions
> are only the simple app-wide scalars (daily goal, master enable).

---

## Step 2 — `js/core/webhook-config.js`

```js
import { safeSetItem } from './safe-storage.js';
import { FORMATS } from './webhook-formats.js';
import { ALL_EVENTS } from './webhook-events.js';

const CONFIG_KEY = 'webhooks:config';

export const DEFAULT_CONFIG = { version: 1, enabled: true, endpoints: [] };

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return structuredCloneSafe(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch (_) { return structuredCloneSafe(DEFAULT_CONFIG); }
}

export function saveConfig(cfg) {
  try { safeSetItem(CONFIG_KEY, JSON.stringify(normalizeConfig(cfg))); return true; }
  catch (_) { return false; }
}

// Fill defaults, drop unknown formats/events, clamp throttles. NEVER throws.
export function normalizeConfig(cfg) { /* … */ }

// Returns { ok: true } or { ok:false, error:'…' }. Pure — unit-tested.
export function validateEndpoint(ep) {
  if (!ep || typeof ep !== 'object') return { ok:false, error:'missing' };
  if (!isHttpUrl(ep.url)) return { ok:false, error:'URL must be http(s)://' };
  if (!FORMATS.includes(ep.format)) return { ok:false, error:'unknown format' };
  if (!Array.isArray(ep.events) || !ep.events.length) return { ok:false, error:'pick at least one event' };
  return { ok:true };
}

// Reuse the security posture of js/core/src-url.js: http/https only, no
// file:/javascript:/data:. (You may import a shared helper if you factor one out.)
export function isHttpUrl(u) {
  try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; }
  catch (_) { return false; }
}

export function newEndpoint() {
  return { id: 'ep_' + Math.random().toString(36).slice(2, 8), name: '', url: '',
    method: 'POST', enabled: true, format: 'generic', headers: {}, events: ['*'],
    modes: ['read','rsvp','tts'], includeLifetime: false, throttleOverrides: {}, milestoneStep: 10 };
}
```

Export `CONFIG_KEY` for the dispatcher and the "purge on delete" path.

---

## Step 3 — General-pref additions (`js/core/constants.js`)

Add to `GENERAL_DEFAULTS` (app-wide, simple scalars):

```js
export const GENERAL_DEFAULTS = {
  // … existing …
  webhooksEnabled: true,     // master switch mirror (also lives in config.enabled)
  dailyGoalWords: 0,         // 0 = off; e.g. 5000
  dailyGoalMinutes: 0,       // 0 = off; e.g. 30
};
```

`dailyGoal*` feed `goal.reached` and the `lifetime.today.goal*` fields. Follow
[`CONTRIBUTING.md` §3](../../docs/CONTRIBUTING.md) for adding the controls.

---

## Step 4 — The Settings tab

In `settings-screen.js`, add a `smart-home` tab. Two parts:

**(a) Tab button + pane** in the `_screen.innerHTML` template, alongside the
existing tabs (Read/RSVP/TTS/General). Gate visibility on nothing — it's
app-wide, available in every mode (unlike mode-specific tabs).

**(b) Render the endpoint manager** into the pane. Keep it vanilla DOM built in
JS (the screen mixes template HTML + JS-built lists elsewhere — follow the
voice-list / TOC-list pattern). Structure:

```
Smart Home
  [● Webhooks enabled]            ← master toggle → general prefs + config.enabled
  Daily goal: [ 5000 ] words  [ 30 ] min
  ─ Endpoints ───────────────────────────────
  ▸ Home Assistant  (home-assistant)  [●]  [Edit] [Test] [Delete]
  ▸ Phone push      (ntfy)            [○]  [Edit] [Test] [Delete]
  [ + Add endpoint ]
  ─ Recent deliveries (Phase 3+) ────────────
  (debug log table, empty until Phase 3)
```

**Endpoint editor** (inline expander or modal): Name, URL, Format (`<select>` of
`FORMATS`), Method, Headers (key/value rows), Modes (read/rsvp/tts checkboxes),
Events (checkbox list grouped Shared / Reader / RSVP / TTS — derive from
`EVENT_DEFS`, plus an "All events (\*)" master), `includeLifetime` toggle,
`milestoneStep` number, per-event throttle overrides (advanced, collapsed).

On save: `validateEndpoint(ep)`; if `!ok`, show the error inline; else upsert
into `loadConfig()` and `saveConfig()`.

> **Reminder:** all lookups inside the pane go through `byId()` (scoped). All
> listeners pass `{ signal }` — but the settings screen manages its own
> `_cleanup`; follow how existing panes register/cleanup listeners there.

**i18n:** add the visible strings to the locale files the app uses (see other
settings strings, `t('…')`). Keys like `webhooks.title`, `webhooks.addEndpoint`,
`webhooks.test`, `webhooks.testOk`, `webhooks.testFail`.

---

## Step 5 — The "Test" button (stub now, real in Phase 3)

For Phase 2, "Test" builds a sample `book.opened` envelope via
`buildEventPayload` (using a synthetic book ctx) and `console.log`s it, then
shows `webhooks.testOk`. Phase 3 replaces the body with a real
`dispatcher.sendOne(endpoint, env)` that surfaces network/CORS errors (the one
place we fail loud — see [`WEBHOOKS.md` §4.9](../../docs/WEBHOOKS.md)).

---

## Step 6 — Tests

Pure unit tests in `selftest.js`:

```js
import { DEFAULT_CONFIG, normalizeConfig, validateEndpoint, isHttpUrl, newEndpoint } from '../core/webhook-config.js';

assert('webhooks', 'default config has no endpoints', loadOk(DEFAULT_CONFIG) && DEFAULT_CONFIG.endpoints.length === 0);
assert('webhooks', 'rejects non-http url', !isHttpUrl('javascript:alert(1)') && !isHttpUrl('file:///etc/passwd'));
assert('webhooks', 'accepts https', isHttpUrl('https://ha.local/api/webhook/x'));
assert('webhooks', 'validateEndpoint flags empty events',
  validateEndpoint({ url:'https://x', format:'generic', events:[] }).ok === false);
assert('webhooks', 'newEndpoint validates', validateEndpoint({ ...newEndpoint(), url:'https://x', events:['*'] }).ok);
assert('webhooks', 'normalize drops unknown format',
  normalizeConfig({ endpoints:[{ ...newEndpoint(), format:'bogus', url:'https://x' }] }).endpoints[0].format !== 'bogus');
```

Live test (in `runLiveTests`): open the config, push an endpoint via
`saveConfig`, reload via `loadConfig`, assert round-trip equality. (Full UI
interaction tests are optional; the settings screen is hard to drive headlessly —
prefer asserting the config layer.)

---

## Definition of done

- [ ] `webhook-config.js` round-trips through `localStorage`; never throws.
- [ ] Smart Home tab renders in every mode's settings; add/edit/delete/persist works.
- [ ] Master toggle + daily goal persist to general prefs.
- [ ] "Test" logs a valid envelope (real send deferred to Phase 3).
- [ ] Unit + round-trip tests green.
</content>
