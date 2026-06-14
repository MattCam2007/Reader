# Smart Home / MQTT Integration — Implementation Plan

**Date:** 2026-06-14
**Status:** 📋 Planned — not yet implemented
**Branch:** `claude/smart-home-mqtt-plan-vi3jbo`
**Audience:** This plan is written to be implemented by an AI agent with **no prior
context on this codebase**. Every file path is real, every insertion point is
named, and the existing patterns to copy are spelled out. Read
[`docs/SMART-HOME.md`](../docs/SMART-HOME.md) (event catalog + payload schema +
topic reference + dashboard recipes) and
[`docs/BEST-PRACTICES.md`](../docs/BEST-PRACTICES.md) alongside this plan.

---

## 0. What we are building (one paragraph)

Reader is a static, build-step-free, client-side PWA book reader with three
reading modes (paginated **Reader**, **RSVP** speed-reader, **TTS**). This feature
adds a **Smart Home** integration: the app connects to an **MQTT broker** (which
already exists — not part of this project) and publishes **rich, structured
events** as the user reads — *new page, new chapter, new book, end of book*, and
more — with a **different event set per reading mode**. Each event carries reading
stats (words read, WPM, session time, % complete, ETA) and book metadata so the
user can build **dashboards** (Home Assistant, Node-RED, Grafana) showing what
they're reading and how. Connection is configured in a **new "Smart" tab** in the
settings screen.

---

## 1. The single most important constraint (read this first)

> **Browsers cannot speak raw MQTT.** MQTT is a TCP protocol; browser JavaScript
> has no raw TCP sockets. The **only** way a web page can reach an MQTT broker is
> **MQTT over WebSockets** (`ws://` or `wss://`).

Consequences that shape the whole design:

1. The broker **must expose a WebSocket listener** (e.g. Mosquitto `listener 9001`
   with `protocol websockets`). We document this for the user; we do **not** ship a
   broker. The default port in our UI is **9001** (the Mosquitto WS convention),
   not 1883 (raw TCP, unreachable from a browser).
2. **Mixed content:** if Reader is served over **HTTPS** (e.g. GitHub Pages), the
   browser will block a plaintext `ws://` connection. On HTTPS you **must** use
   `wss://`. The Smart tab must warn about this explicitly (see §6.4).
3. We use the **MQTT.js** library (it implements MQTT-over-WebSockets in the
   browser). It is **vendored** (same-origin, pinned) exactly like `epub.js`/`jszip`
   and **lazy-loaded only when Smart Home is enabled**, so readers who never use
   the feature pay zero bytes.

If you forget this constraint you will waste hours debugging a connection that
*can never* work against a TCP-only broker. Put it at the top of the debugging doc.

---

## 2. How the existing app is structured (orientation for the implementer)

You do not need to read every file, but you must understand these pieces because
the integration plugs into them.

### 2.1 No build step, ES modules, static hosting
- Everything is plain ES modules loaded directly by the browser. There is **no
  bundler, no transpile, no npm runtime dependency**. `package.json` exists only
  for the headless selftest (`node test/run-selftest.mjs` via Playwright).
- Third-party libs are **vendored** in `vendor/` and loaded with `<script defer>`
  (see `reader.html`) or lazily at runtime. The service worker (`sw.js`) precaches
  them for offline use. **Follow this exact pattern for MQTT.js.**

### 2.2 The EventBus (`js/core/events.js`)
A tiny pub/sub. `on(event, fn)` returns an unsubscribe function; `emit(event,
...args)` calls listeners plus any `"*"` wildcard listeners. **Each reading-mode
app owns its own bus instance** — there is currently **no global, cross-mode bus**.
RSVP, for example, emits `playStart`, `wordsRead`, `wpmChanged`, `renderChunk` on
its bus (see `js/rsvp/playback.js`). This matters: the Smart Home publisher will
**subscribe to each mode's bus** at that mode's init, rather than expecting one
global stream.

### 2.3 Prefs (`js/core/prefs.js`, defaults in `js/core/constants.js`)
`PrefsManager extends EventBus`. Each scope is a separate localStorage key:
`general:prefs`, `reader:prefs`, `rsvp:prefs`, `tts:prefs`. `.load()`, `.save()`,
`.set(key,val)` (emits `key` and `"change"`), `.get(key)`, `.applyAll()`. **We add
a new scope `smart:prefs`** with its own defaults object.

### 2.4 BookSession (`js/core/book-session.js`)
Parsed once per book, shared by all modes. Carries `bookId`, `title`, `fileName`,
`format`, `toc`, `sections`, `capabilities`. Word counting uses `splitWords` /
`countWords` exported from this file — the **single tokenisation rule** all modes
agree on. Use these for stats so word ordinals match the rest of the app.

### 2.5 The three mode apps and their hook points
All three live at `js/reader-app.js`, `js/rsvp-app.js`, `js/tts-app.js` and export
`init(options)` returning a handle with `teardown()`. Each wires DOM/event
listeners through an **`AbortController` signal** so teardown is leak-free
(`addEventListener(..., { signal })`). **Any listener we add must use the same
`signal`** so it's torn down on mode switch.

Mode switching is orchestrated by `js/mode-switcher.js` (`switchMode`), which calls
`teardown()`, aborts the controller, and boots the next mode, passing the canonical
position. `onBookLoaded({ session })` caches the shared session.

Key existing hook points to tap (verified locations):

| Concept | Reader | RSVP | TTS |
|---|---|---|---|
| Book loaded | `loadFromSession()` (`reader-app.js:840`) | analogous load fn | analogous load fn |
| Page / advance | `updateProgressFn` (`reader-app.js:170`), pagination turn | `playback.js` `emit('renderChunk')`, `emit('wordsRead')` | `engine.js` sentence advance |
| Chapter label | `chrome.js` `currentChapterLabel()` (`:244`) | `rsvp-app.js:135` chapter loop | TTS sentence→chapter map |
| Position save | `savePosMain()` / `getCanonicalPosition()` (`reader-app.js:159/346`) | `rsvp-app.js` `getPosition` | tts position save |
| End of book | last page reached in pagination | `currentIdx >= total` in `playback.js` | last sentence in `engine.js` |

You will add small **emit calls** (or direct controller calls) at these points. Do
**not** rewrite these functions — add one line that notifies the Smart Home layer.

### 2.6 Settings screen (`js/settings/settings-screen.js`)
A modal with a `<nav class="sscreen-tabs">` of tab buttons (`data-tab="general"`,
`"read"`, `"rsvp"`, `"tts"`, `"dict"`) and a body that `showTab(tab)` fills by
calling `xTabHTML(prefs)` + `wireXTab(prefs, onChange)`. Tab labels come from i18n
(`js/i18n/en.js` keys `tab.general` etc.). **We add a `data-tab="smart"` tab.**

### 2.7 i18n (`js/i18n/`)
`t('key')` looks up the active language file (`en.js`, `fr.js`, `es.js`, `de.js`).
Every user-facing string we add gets a key in **all four** files (English value is
fine as a placeholder for the others initially; note it in the PR).

---

## 3. Target architecture

New code lives in a self-contained module: **`js/core/smart-home/`**. The mode apps
touch it through one small, stable surface so the modes stay decoupled from MQTT.

```
js/core/smart-home/
  constants.js        # SMART_DEFAULTS, topic templates, event-name enum, schema version
  mqtt-client.js      # thin wrapper over vendored MQTT.js: connect/publish/disconnect,
                      #   LWT, reconnect/backoff, status callbacks. Lazy-loads the lib.
  reading-stats.js    # session stats aggregator (words read, wpm, time, ETA, % done)
  payloads.js         # PURE functions: build the rich envelope + per-event bodies
  publisher.js        # SmartHomeController: subscribes to a mode bus, throttles,
                      #   maps events -> topics, publishes; owns mqtt-client + stats
  discovery.js        # OPTIONAL: Home Assistant MQTT Discovery config publishing
  index.js            # public surface: getSmartHome() singleton, wireMode(bus, ctx)

vendor/
  mqtt-<ver>.min.js   # vendored MQTT.js (browser build), pinned

docs/SMART-HOME.md    # living reference (event catalog, schema, topics, dashboards)
```

**Singleton, app-lifetime:** the MQTT connection should survive mode switches (so a
Reader→RSVP switch doesn't drop the broker connection). Therefore the
`SmartHomeController` and its `mqtt-client` are an **app-level singleton** created
in `js/mode-switcher.js` (which is the one module that lives across modes), **not**
inside a mode's `init()`. Each mode, on init, calls
`smartHome.wireMode(modeName, bus, ctx)` which attaches bus listeners **on the
mode's AbortController signal** so they're cleaned up on switch — but the
connection itself persists.

Data flow:

```
mode bus.emit('wordsRead', n)
        │
        ▼
SmartHomeController (subscribed to bus, knows current mode + book + stats)
   1. update ReadingStats
   2. build payload via payloads.js (pure)
   3. throttle if high-frequency
   4. mqtt-client.publish(topic, json, {qos, retain})
        │
        ▼
   MQTT.js over WebSocket ──► broker ──► dashboards / automations
```

---

## 4. Prefs & defaults (do this first — everything depends on it)

### 4.1 Add `SMART_DEFAULTS` to `js/core/smart-home/constants.js`

```js
// js/core/smart-home/constants.js

// Bump when the published JSON envelope shape changes in a breaking way.
export const SMART_SCHEMA_VERSION = 1;

// All published topics derive from baseTopic + deviceId. Keep '/' separators.
export const TOPICS = {
  status:   (base, dev) => `${base}/${dev}/status`,            // LWT: "online"/"offline" (retained)
  event:    (base, dev, name) => `${base}/${dev}/event/${name}`,
  stateBook:(base, dev) => `${base}/${dev}/state/book`,        // retained snapshot
  statePos: (base, dev) => `${base}/${dev}/state/position`,    // retained snapshot
  stateStats:(base, dev) => `${base}/${dev}/state/stats`,      // retained snapshot
};

export const SMART_DEFAULTS = {
  v: 1,
  enabled: false,            // master switch; when false the lib never loads
  brokerUrl: '',             // host only, e.g. "192.168.1.50" or "broker.local"
  port: 9001,                // Mosquitto WS default; NOT 1883 (TCP, unreachable)
  tls: false,               // false => ws://, true => wss://
  path: '/mqtt',             // WS path; many brokers use "/" or "/mqtt"
  username: '',
  password: '',              // ⚠ stored plaintext in localStorage — warn in UI
  clientIdPrefix: 'reader',
  baseTopic: 'reader',       // topic root
  deviceName: 'Reader',      // human label included in payloads & discovery
  qos: 0,                    // 0/1/2
  retainState: true,         // retain state/* topics so dashboards show current value
  retainEvents: false,       // events are transient by default
  haDiscovery: false,        // publish Home Assistant MQTT Discovery configs
  minProgressIntervalMs: 5000, // throttle floor for progress/word-read spam
  // Per-event toggles (default on for the headline events). Keys are canonical
  // event names from EVENTS below.
  events: {
    'book.opened': true,
    'book.finished': true,
    'chapter.changed': true,
    'reader.page.turned': true,
    'reading.started': true,
    'reading.paused': true,
    'progress.updated': true,
    'rsvp.wpm.changed': true,
    'rsvp.training.levelUp': true,
    'tts.voice.changed': false,
    'bookmark.added': true,
  },
};
```

### 4.2 Canonical event-name enum

Put the full list in `constants.js` as `EVENTS` and document it in
`docs/SMART-HOME.md` §"Event catalog". See that doc for the authoritative list and
per-mode breakdown. Keep names **dot-namespaced** and stable — dashboards key off
them.

### 4.3 Wire the new prefs scope into the settings screen

In `js/settings/settings-screen.js`:
- Add `import { SMART_DEFAULTS } from '../core/smart-home/constants.js';`
- Add a module singleton `let _smartPrefs = null;` next to the others (`:49-52`).
- In `openSettingsScreen`, create it:
  `_smartPrefs = getOrCreatePrefs(_smartPrefs, { storageKey: 'smart:prefs', defaults: SMART_DEFAULTS });`
- Add `onSmartChange` to the destructured `config` (`:88-94`) and thread it through.

---

## 5. The MQTT client wrapper (`js/core/smart-home/mqtt-client.js`)

A thin, dependency-injected wrapper. **Lazy-load the vendored lib** the same way
format adapters do (see `js/formats/pdf/pdf-adapter.js` `loadLibs`).

```js
// js/core/smart-home/mqtt-client.js
let _mqttLibPromise = null;

// Lazy-load vendored MQTT.js exactly once. Vendored same-origin (see reader.html
// note + sw.js precache list). Exposes window.mqtt (UMD build).
function loadMqttLib() {
  if (_mqttLibPromise) return _mqttLibPromise;
  _mqttLibPromise = new Promise((resolve, reject) => {
    if (window.mqtt) return resolve(window.mqtt);
    const s = document.createElement('script');
    s.src = 'vendor/mqtt-5.10.1.min.js'; // keep version in sync with sw.js
    s.onload = () => window.mqtt ? resolve(window.mqtt) : reject(new Error('mqtt lib missing'));
    s.onerror = () => reject(new Error('failed to load MQTT library'));
    document.head.appendChild(s);
  });
  return _mqttLibPromise;
}

export class MqttClient extends EventTarget {
  constructor() { super(); this.client = null; this.status = 'disconnected'; }

  _setStatus(s) { this.status = s; this.dispatchEvent(new CustomEvent('status', { detail: s })); }

  // cfg: { url, username, password, clientId, lwtTopic, lwtPayload, qos }
  async connect(cfg) {
    const mqtt = await loadMqttLib();
    this.disconnect(); // idempotent
    this._setStatus('connecting');
    this.client = mqtt.connect(cfg.url, {
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      clientId: cfg.clientId,
      clean: true,
      reconnectPeriod: 4000,         // built-in backoff; do not hand-roll
      connectTimeout: 8000,
      will: cfg.lwtTopic ? {
        topic: cfg.lwtTopic, payload: 'offline', qos: cfg.qos ?? 0, retain: true,
      } : undefined,
    });
    this.client.on('connect', () => {
      this._setStatus('connected');
      // Birth message: mark online (retained), counterpart to the LWT.
      if (cfg.lwtTopic) this.publish(cfg.lwtTopic, 'online', { qos: cfg.qos ?? 0, retain: true });
    });
    this.client.on('reconnect', () => this._setStatus('connecting'));
    this.client.on('close',    () => this._setStatus('disconnected'));
    this.client.on('error', (e) => { this._setStatus('error'); this.dispatchEvent(new CustomEvent('error', { detail: e })); });
  }

  publish(topic, payload, opts = {}) {
    if (!this.client || this.status !== 'connected') return false; // best-effort; drop when offline
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.client.publish(topic, body, { qos: opts.qos ?? 0, retain: !!opts.retain });
    return true;
  }

  disconnect() {
    if (this.client) { try { this.client.end(true); } catch (_) {} this.client = null; }
    this._setStatus('disconnected');
  }
}
```

**Reminders for the implementer:**
- `mqtt.connect(url, opts)` — `url` is the **full** `ws(s)://host:port/path`. Build
  it in `publisher.js` from prefs: ``${tls?'wss':'ws'}://${brokerUrl}:${port}${path}``.
- `clientId` must be **unique** — collisions cause the broker to disconnect the
  older client in a flapping loop. Use `clientIdPrefix + '-' + random`.
- Do **not** hand-roll reconnect; MQTT.js handles it via `reconnectPeriod`.
- Best-effort publish: if disconnected, drop the event. The **retained state
  topics** mean a dashboard recovers the current picture on reconnect anyway.

---

## 6. The publisher / controller (`js/core/smart-home/publisher.js`)

### 6.1 Responsibilities
- Own the `MqttClient` and a `ReadingStats` instance.
- Hold the current context: `mode`, `book` (from BookSession), latest `position`.
- Subscribe to a mode's bus (via `wireMode`) and translate bus events → canonical
  events → topics.
- Throttle high-frequency events using `minProgressIntervalMs`.
- Publish retained `state/*` snapshots after every meaningful change so dashboards
  always have current values.
- Respect per-event toggles and the master `enabled` switch.

### 6.2 Public surface (`index.js`)

```js
// js/core/smart-home/index.js
import { SmartHomeController } from './publisher.js';
let _instance = null;
export function getSmartHome() {
  if (!_instance) _instance = new SmartHomeController();
  return _instance;
}
```

### 6.3 Controller skeleton

```js
// js/core/smart-home/publisher.js (skeleton — fill in per event catalog)
import { MqttClient } from './mqtt-client.js';
import { ReadingStats } from './reading-stats.js';
import { buildEnvelope, buildStateBook, buildStatePosition } from './payloads.js';
import { TOPICS, SMART_DEFAULTS } from './constants.js';
import { PrefsManager } from '../prefs.js';

export class SmartHomeController {
  constructor() {
    this.prefs = new PrefsManager({ storageKey: 'smart:prefs', defaults: SMART_DEFAULTS });
    this.prefs.load();
    this.mqtt = new MqttClient();
    this.stats = new ReadingStats();
    this.ctx = { mode: null, book: null, position: null };
    this.deviceId = this._deviceId();
    this._lastProgressTs = 0;
  }

  _deviceId() {
    let id = localStorage.getItem('smart:deviceId');
    if (!id) { id = 'dev-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('smart:deviceId', id); }
    return id;
  }

  // Called once at app boot (from mode-switcher) and whenever the Smart tab saves.
  applyConfig() {
    this.prefs.load();
    const p = this.prefs.data;
    if (!p.enabled || !p.brokerUrl) { this.mqtt.disconnect(); return; }
    const base = p.baseTopic, dev = this.deviceId;
    const url = `${p.tls ? 'wss' : 'ws'}://${p.brokerUrl}:${p.port}${p.path || ''}`;
    this.mqtt.connect({
      url, username: p.username, password: p.password,
      clientId: `${p.clientIdPrefix}-${dev}`,
      lwtTopic: TOPICS.status(base, dev), qos: p.qos,
    });
  }

  // Called by each mode's init(). Listeners bind to the mode's AbortController
  // signal so they are removed on mode switch (connection persists).
  wireMode(mode, bus, ctx, signal) {
    this.ctx.mode = mode;
    this.ctx.book = ctx.book;
    this.stats.startSession(ctx.book);
    // Example wiring — see full mapping in §6.5 and docs/SMART-HOME.md.
    // bus is an EventBus (js/core/events.js): on() returns an unsubscribe fn,
    // but we also honour signal for symmetry with the rest of the app.
    const off = [];
    off.push(bus.on('book.opened', (info) => this.onBookOpened(info)));
    off.push(bus.on('page.turned', (info) => this.onPageTurned(info)));
    // ...
    if (signal) signal.addEventListener('abort', () => off.forEach(fn => fn()));
  }

  emitCanonical(name, body) {
    const p = this.prefs.data;
    if (!p.enabled || p.events[name] === false) return;
    const base = p.baseTopic, dev = this.deviceId;
    const envelope = buildEnvelope(name, this.ctx, this.stats, this.deviceId, p.deviceName);
    Object.assign(envelope, body || {});
    this.mqtt.publish(TOPICS.event(base, dev, name), envelope, { qos: p.qos, retain: p.retainEvents });
    this._publishState(); // keep retained snapshots fresh
  }

  _publishState() {
    const p = this.prefs.data; if (!p.retainState) return;
    const base = p.baseTopic, dev = this.deviceId;
    this.mqtt.publish(TOPICS.stateBook(base, dev), buildStateBook(this.ctx), { qos: p.qos, retain: true });
    this.mqtt.publish(TOPICS.statePos(base, dev), buildStatePosition(this.ctx, this.stats), { qos: p.qos, retain: true });
    this.mqtt.publish(TOPICS.stateStats(base, dev), this.stats.snapshot(), { qos: p.qos, retain: true });
  }

  // Throttled progress (page turns, word batches).
  onProgress(position) {
    this.ctx.position = position; this.stats.onProgress(position);
    const now = Date.now();
    if (now - this._lastProgressTs < this.prefs.data.minProgressIntervalMs) return;
    this._lastProgressTs = now;
    this.emitCanonical('progress.updated');
  }
}
```

### 6.4 Throttling rules
- `progress.updated`, `rsvp.words.read`: throttle to `minProgressIntervalMs`
  (default 5 s). **Always** publish the un-throttled `state/position` retained
  snapshot inside `_publishState()` so dashboards stay live without event spam.
- `chapter.changed`, `book.opened`, `book.finished`, `reading.started/paused`,
  `bookmark.added`: **never** throttle (low frequency, high value).
- `reader.page.turned`: publish the event but also fold into progress throttle if
  the user is flipping fast — emit the page event but throttle the heavy stats
  recompute. Keep it simple: emit page event each turn, recompute ETA lazily.

### 6.5 Event mapping (which bus event → which canonical event)
The authoritative table is in **`docs/SMART-HOME.md` §"Per-mode event mapping"**.
Summary of where to subscribe in each mode app:

- **Reader (`reader-app.js`)**: in `updateProgressFn` (`:170`) call
  `smartHome.onProgress(getCanonicalPosition())`; on a detected chapter change
  (compare `chrome.currentChapterLabel()` to last) emit `chapter.changed`; when the
  last page is reached emit `book.finished` + `reader.book.finished`.
- **RSVP (`rsvp-app.js` / `js/rsvp/playback.js`)**: map `playStart`→`reading.started`
  + `rsvp.play.started`, `playStop`→`reading.paused`, `wordsRead`→accumulate stats +
  throttled `rsvp.words.read`, `wpmChanged`→`rsvp.wpm.changed`, training level-up→
  `rsvp.training.levelUp`, `currentIdx>=total`→`book.finished`.
- **TTS (`tts-app.js` / `js/tts/engine.js`)**: play→`reading.started`+`tts.play.started`,
  pause→`reading.paused`, sentence advance→throttled `progress.updated`+chapter check,
  voice change→`tts.voice.changed`, last sentence→`book.finished`+`tts.book.finished`.

> Implementation tactic to minimise churn in the mode apps: rather than adding many
> `smartHome.x()` calls, add **one** line at each mode's `init()` that calls
> `smartHome.wireMode(mode, bus, { book }, signal)` and let the controller listen to
> the **existing** bus events (RSVP already emits most of what we need). Only add
> *new* `bus.emit()` calls where a needed signal doesn't exist yet (e.g. Reader's
> page turn / chapter change — add `bus.emit('page.turned', {...})` in
> `updateProgressFn`). This keeps mode code almost untouched.

---

## 7. Payloads (`js/core/smart-home/payloads.js`) — keep these PURE

Pure functions = trivially unit-testable in the existing selftest harness (§10).
No DOM, no MQTT, no clock except an injected/`Date.now()` timestamp. See
`docs/SMART-HOME.md` §"Payload schema" for the full envelope. Core builder:

```js
// js/core/smart-home/payloads.js
import { SMART_SCHEMA_VERSION } from './constants.js';

export function buildEnvelope(event, ctx, stats, deviceId, deviceName, now = Date.now()) {
  const b = ctx.book || {};
  const pos = ctx.position || {};
  const s = stats.snapshot();
  return {
    schema: SMART_SCHEMA_VERSION,
    event,
    ts: new Date(now).toISOString(),
    mode: ctx.mode,
    device: { id: deviceId, name: deviceName },
    book: {
      id: b.bookId, title: b.title, author: b.author || null,
      format: b.format, totalWords: b.totalWords ?? null, totalChapters: b.totalChapters ?? null,
    },
    position: {
      fraction: pos.fraction ?? null,
      percent: pos.fraction != null ? Math.round(pos.fraction * 1000) / 10 : null,
      chapterIndex: pos.chapterIndex ?? null,
      chapterTitle: pos.chapterTitle ?? null,
      page: pos.page ?? null, totalPages: pos.totalPages ?? null,
      wordOrdinal: pos.wordOrdinal ?? null,
    },
    stats: {
      sessionWordsRead: s.wordsRead, sessionMs: s.elapsedMs, sessionWpm: s.wpm,
      wordsRemaining: s.wordsRemaining, etaMinutes: s.etaMinutes,
    },
  };
}

export function buildStateBook(ctx) { /* compact retained snapshot of ctx.book */ }
export function buildStatePosition(ctx, stats) { /* compact retained snapshot */ }
```

---

## 8. Reading stats (`js/core/smart-home/reading-stats.js`)

Mirror the existing `js/rsvp/stats.js` `StatsTracker` (session words, play time,
avg WPM) but generalise it for all modes and add **% complete, words remaining, and
ETA**. Use `countWords`/`splitWords` from `book-session.js` for any word math so
ordinals match the rest of the app.

```js
export class ReadingStats {
  startSession(book) {
    this.book = book;
    this.totalWords = book?.totalWords ?? 0;
    this.wordsRead = 0; this.elapsedMs = 0; this._runStart = null; this._lastFraction = 0;
  }
  resume() { if (!this._runStart) this._runStart = Date.now(); }
  pause()  { if (this._runStart) { this.elapsedMs += Date.now() - this._runStart; this._runStart = null; } }
  addWords(n) { this.wordsRead += n; }
  onProgress(pos) { if (pos?.fraction != null) this._lastFraction = pos.fraction; }
  get wpm() {
    const ms = this.elapsedMs + (this._runStart ? Date.now() - this._runStart : 0);
    return ms > 2000 ? Math.round(this.wordsRead / ms * 60000) : 0;
  }
  snapshot() {
    const wpm = this.wpm;
    const wordsRemaining = Math.max(0, Math.round(this.totalWords * (1 - this._lastFraction)));
    return {
      wordsRead: this.wordsRead,
      elapsedMs: this.elapsedMs + (this._runStart ? Date.now() - this._runStart : 0),
      wpm, percent: Math.round(this._lastFraction * 1000) / 10,
      wordsRemaining,
      etaMinutes: wpm > 0 ? Math.round(wordsRemaining / wpm) : null,
    };
  }
}
```

> `book.totalWords` / `totalChapters`: compute once at load from the session. Reader
> already builds a doc model with `doc.wsToToken.length` (total whitespace words);
> RSVP computes `state.totalWords`. Add `totalWords` and `totalChapters` onto the
> `ctx.book` you pass to `wireMode` so payloads don't depend on mode internals.

---

## 9. Settings — the new "Smart" tab

### 9.1 Add the tab button
In `settings-screen.js` `_screen.innerHTML` nav (`:128-134`), add after the dict tab:
```html
<button class="sscreen-tab" role="tab" data-tab="smart" type="button">${t('tab.smart')}</button>
```

### 9.2 Add to `showTab` dispatch (`:160-177`)
```js
} else if (tab === 'smart') {
  body.innerHTML = smartTabHTML(smartPrefs.data);
  wireSmartTab(smartPrefs, onSmartChange);
}
```

### 9.3 `smartTabHTML(p)` — controls to include
- **Master toggle:** Enable Smart Home (segmented on/off).
- **Connection status pill** (live; updated from `mqtt` status events): Disconnected
  / Connecting / Connected / Error.
- **Broker host** (text), **Port** (number, default 9001), **TLS** toggle (ws/wss),
  **WS path** (text, default `/mqtt`).
- **Username / Password** (password field). Under it, an inline warning:
  `t('smart.credsWarning')` → *"Credentials are stored unencrypted on this device.
  Use a dedicated, least-privilege MQTT account."*
- **Base topic** (text, default `reader`), **Device name** (text).
- **QoS** (0/1/2 segmented), **Retain state** toggle, **HA Discovery** toggle.
- **Per-event toggles** (a list generated from `EVENTS`).
- **"Test connection"** button → calls `smartHome.applyConfig()` then surfaces the
  status pill result; optionally publishes a `book.opened`-style test event.
- A short help line linking conceptually to `docs/SMART-HOME.md` (broker must expose
  a **WebSocket** listener; on HTTPS you must use **wss**).

> Mirror the markup/wiring style of an existing tab — `generalTabHTML`/`wireGeneralTab`
> (`:281-391`) is the closest template (plain inputs + segmented controls + a
> `createPicker` for QoS). Reuse `createPicker` from `js/shared/picker.js` for
> segmented choices and the existing `.sscreen-*` CSS classes (add a couple of new
> rules in `css/` only if needed — prefer reuse).

### 9.4 `wireSmartTab(prefs, liveApply)`
On each control change: `prefs.set(key, value); prefs.save();` then call
`getSmartHome().applyConfig()` so the connection re-establishes with new settings.
Subscribe to the controller's `mqtt` `status` event to update the status pill while
the screen is open (unsubscribe on tab teardown via the existing
`destroyTabHandles()` mechanism).

### 9.5 i18n keys
Add to `js/i18n/{en,fr,es,de}.js`: `tab.smart`, `smart.enable`, `smart.broker`,
`smart.port`, `smart.tls`, `smart.path`, `smart.username`, `smart.password`,
`smart.credsWarning`, `smart.baseTopic`, `smart.deviceName`, `smart.qos`,
`smart.retain`, `smart.haDiscovery`, `smart.test`, `smart.status.*`, plus a label
per event toggle. English values now; translations can follow.

---

## 10. Boot wiring (`js/mode-switcher.js`)

1. At top: `import { getSmartHome } from './core/smart-home/index.js';`
2. After the first successful boot (or at module init), call
   `getSmartHome().applyConfig();` so the connection comes up if enabled.
3. In each mode boot, after `init(...)` returns the handle, call
   `getSmartHome().wireMode(targetMode, handle.bus, { book: sessionBookCtx }, currentController.signal)`.
   - You need each mode's `init` to **expose its `bus`** and **`signal`** on the
     returned handle (Reader/TTS may not today — add `bus` and `signal` to the
     returned object; it's a one-line change in each `init`).
   - `sessionBookCtx` = `{ bookId, title, author, format, totalWords, totalChapters }`
     derived from `cachedSession` + the mode's word/chapter counts.
4. In `onBookLoaded({ session })`, after caching, call
   `getSmartHome().onBookOpened(...)` so a fresh book fires `book.opened` + refreshes
   retained `state/book`.

> Why here and not in each app: `mode-switcher.js` is the only module that persists
> across mode switches, so the singleton's lifecycle naturally matches the
> connection's. The connection should **not** drop on a Reader→RSVP switch.

---

## 11. Vendoring MQTT.js & service worker

1. **Download** the browser UMD build of MQTT.js (pin a version, e.g. `mqtt@5.x`
   `dist/mqtt.min.js`) into `vendor/mqtt-<ver>.min.js`. Keep the version in the
   filename, like the existing `epub-0.3.93.min.js`.
2. **Do NOT** add it to `reader.html` `<script defer>` (we lazy-load it only when
   enabled — see §5). 
3. **`sw.js`:** add the vendored path to the precache list **only if** you want it
   available offline regardless of use. Better: leave it out of the shell precache
   and let it be cached at runtime on first lazy load (cache-first, like the
   per-format CDN libs). Document the choice. Keep the version comment in `sw.js`
   in sync (the file already has a "keep versions in sync" convention).
4. Bump the `sw.js` `CACHE` version note if you change precaching, so returning
   users pick up the new asset list (see the cache-naming comment at the top of
   `sw.js`).

> **License check:** MQTT.js is MIT — fine to vendor. Record the version + license
> in the PR description and (optionally) a `vendor/README.md`.

---

## 12. Step-by-step implementation order (for the simpler AI)

Do these in order; each step is independently verifiable.

1. **Constants & prefs.** Create `js/core/smart-home/constants.js`
   (`SMART_DEFAULTS`, `TOPICS`, `EVENTS`, `SMART_SCHEMA_VERSION`). Add `smart:prefs`
   to settings-screen prefs creation. *Verify:* open settings, no crash.
2. **Payloads (pure).** Create `payloads.js` + `reading-stats.js`. *Verify:* add
   selftest assertions (§13) and run `node test/run-selftest.mjs`.
3. **MQTT client.** Vendor MQTT.js → `vendor/`. Create `mqtt-client.js`. *Verify:*
   from devtools, manually connect to a local Mosquitto WS broker and publish a
   test string; watch with `mosquitto_sub -t '#' -v`.
4. **Controller.** Create `publisher.js` + `index.js`. Wire `applyConfig()`.
   *Verify:* enabling in settings connects; status pill flips to Connected.
5. **Smart tab UI.** Add tab button, `smartTabHTML`, `wireSmartTab`, i18n keys.
   *Verify:* every field persists across reload; Test button connects.
6. **Boot wiring.** `mode-switcher.js`: `applyConfig()` at boot, `wireMode()` per
   mode, `onBookOpened` on load. Expose `bus`/`signal` on each mode handle.
   *Verify:* `book.opened` fires when a book loads; retained `state/book` appears.
7. **Per-mode events.** Add the minimal `bus.emit` calls / controller subscriptions
   per §6.5 for Reader, RSVP, TTS. *Verify:* each mode produces its event set
   (watch `mosquitto_sub -t 'reader/#' -v`).
8. **End-of-book & chapter detection.** Implement `book.finished` and
   `chapter.changed` in all three modes. *Verify:* reach the last page/word/sentence.
9. **Throttling.** Confirm `progress.updated` / `rsvp.words.read` respect
   `minProgressIntervalMs`; state snapshots still update live.
10. **Optional: HA Discovery** (`discovery.js`). Publish retained config topics so
    Home Assistant auto-creates sensors. *Verify:* sensors appear in HA.
11. **Docs.** Update `README.md` (one feature paragraph + link), confirm
    `docs/SMART-HOME.md` matches the shipped event names/payloads.
12. **Commit per logical step**, push to `claude/smart-home-mqtt-plan-vi3jbo`.

---

## 13. Testing

### 13.1 Automated (the existing harness)
The selftest (`js/test/selftest.js`, run headlessly via `node test/run-selftest.mjs`)
is the regression net. Add **pure-function** tests — they need no broker:
- `buildEnvelope(...)` produces the right shape, ISO timestamp, schema version,
  null-safety when `book`/`position` are absent.
- `ReadingStats`: wpm/ETA/wordsRemaining math; pause/resume time accounting;
  percent from fraction.
- `TOPICS.*` builders produce expected strings.
- Per-event toggle gating: `emitCanonical` is a no-op when `enabled=false` or the
  event toggle is off (inject a **mock MqttClient** that records `publish` calls —
  do **not** open a socket in tests).
- Throttle: two rapid `onProgress` calls publish one `progress.updated`.

Pattern: the selftest already constructs an `EventBus` and asserts (`selftest.js:52`).
Add a `smart-home` test group following the same `assert(...)` style. **Keep all
Smart Home tests broker-free** (mock the client) so CI stays hermetic.

### 13.2 Manual (with a real broker)
1. **Run a broker with a WS listener.** Mosquitto `mosquitto.conf`:
   ```
   listener 1883
   listener 9001
   protocol websockets
   allow_anonymous true   # dev only
   ```
   `mosquitto -c mosquitto.conf -v`
2. **Watch everything:** `mosquitto_sub -h localhost -t 'reader/#' -v`
   (or use **MQTT Explorer** for a tree view — best for inspecting retained state).
3. **Serve Reader:** `python3 -m http.server` → `http://localhost:8000/reader.html`.
   (Use `localhost` + `ws://` so there's no mixed-content block.)
4. Configure the Smart tab (host `localhost`, port `9001`, path `/mqtt`, TLS off),
   enable, Test. Confirm status → Connected and a retained `reader/<dev>/status` =
   `online` appears.
5. Load a book → expect `book.opened` + retained `state/book`. Turn pages → page
   events + throttled progress. Switch to RSVP, play → `reading.started`,
   `rsvp.words.read`, `wpmChanged`. Reach the end → `book.finished`.
6. **Kill the tab** → broker should publish the LWT `offline` to the status topic.

### 13.3 Dashboard validation
- Point Home Assistant / Node-RED / Grafana (via MQTT) at the topics. The retained
  `state/*` topics should render immediately on dashboard load. See
  `docs/SMART-HOME.md` §"Dashboards".

---

## 14. Debugging guide (put the top 3 in `docs/SMART-HOME.md` too)

| Symptom | Likely cause | Fix |
|---|---|---|
| Connect hangs / times out, no error | Pointing at TCP port **1883** (browsers can't) | Use the broker's **WebSocket** port (default 9001) and ensure `protocol websockets` |
| `SecurityError` / mixed content in console | `ws://` on an **https** page | Use `wss://` (TLS) when Reader is served over HTTPS |
| Connects then immediately disconnects, loops | Duplicate **clientId** (two tabs / stale id) | Ensure unique `clientId` (`prefix + deviceId`); deviceId is random + persisted |
| `Not authorized` (CONNACK rc 4/5) | Bad username/password or ACL | Fix creds; check broker ACL allows publish to `baseTopic/#` |
| Status topic never shows `offline` | LWT not set, or graceful `end()` | LWT is set in `connect()`; on tab close the OS drops the socket → broker fires LWT |
| Events missing on dashboard after restart | Event topics aren't retained | Read the **retained `state/*`** topics for current values; events are transient by design |
| Nothing publishes | `enabled=false`, event toggle off, or not connected | Check master toggle, per-event toggle, status pill |
| `window.mqtt is undefined` | Vendored lib path wrong / not loaded | Confirm `vendor/mqtt-<ver>.min.js` exists and the `<script>` src matches |
| Works on localhost, fails on phone | `localhost` resolves to the phone | Use the broker's LAN IP/hostname; ensure phone can reach the broker port |

**General debugging tips:**
- Turn on verbose broker logging (`mosquitto -v`) — it logs CONNECT, SUBSCRIBE,
  PUBLISH, and disconnect reasons.
- In devtools, `MqttClient` dispatches `status` and `error` events — log them.
- Use **MQTT Explorer** to see retained vs transient and the full topic tree.
- Reproduce the WS handshake with `wscat -c ws://localhost:9001/mqtt` (won't speak
  MQTT, but confirms the WS endpoint is reachable).

---

## 15. Security & privacy notes (carry into `docs/BEST-PRACTICES.md`)

- **Credentials are stored plaintext** in `localStorage` (`smart:prefs`). This is
  unavoidable for a static client app; mitigate by recommending a **dedicated,
  least-privilege MQTT user** scoped to `baseTopic/#`. Surface the warning in the UI.
- **Prefer `wss://`** anywhere beyond localhost; plaintext `ws://` exposes creds and
  reading habits on the wire.
- **Reading data is personal.** Publishing what/when you read to a broker is a
  privacy surface. The feature is **off by default** and fully opt-in; document what
  is published (book title, position, timing) in `docs/SMART-HOME.md`.
- **No secrets in the repo.** Never commit a broker URL/credentials. Tests mock the
  client and never connect.
- **CSP / connect-src:** if a CSP is ever added, it must allow `ws:`/`wss:` to the
  broker. Note this in the security doc.

---

## 16. Out of scope (explicitly, so the simpler AI doesn't gold-plate)

- Shipping or configuring an MQTT broker.
- Two-way control (subscribing to commands to control the reader). This plan is
  **publish-only**. A future phase could subscribe to `reader/<dev>/cmd/#` for
  remote play/pause — note it as a follow-up, do not build it now.
- Cloud relays, account systems, or per-user multi-device sync.
- Rewriting the mode apps' event systems. Add hooks; don't refactor.

---

## 17. Acceptance checklist

- [ ] `node test/run-selftest.mjs` green, including new broker-free Smart Home tests.
- [ ] Smart tab: all fields persist; status pill reflects real connection state.
- [ ] Feature is **off by default**; with it off, MQTT.js is **never loaded**.
- [ ] Enabling + valid WS broker → Connected; retained `status=online` published.
- [ ] `book.opened` on load; `reader.page.turned` on page turn; `chapter.changed`
      on chapter boundary; `book.finished` at end — in **all three modes**' variants.
- [ ] Each mode emits its documented event set (verified via `mosquitto_sub`).
- [ ] High-frequency events throttled; retained `state/*` always current.
- [ ] LWT `offline` fires on ungraceful disconnect.
- [ ] `docs/SMART-HOME.md` matches shipped event names + payloads.
- [ ] `README.md` mentions the feature; security warnings present in UI + docs.
- [ ] Committed in logical steps and pushed to `claude/smart-home-mqtt-plan-vi3jbo`.
</content>
</invoke>
