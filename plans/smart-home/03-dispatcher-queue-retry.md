# Phase 3 — Dispatcher, Queue & Retry (`03-dispatcher-queue-retry.md`)

**Goal.** The runtime that actually delivers events: filter per endpoint,
throttle, format, send via `fetch`/`sendBeacon`, and queue+retry when offline.
Plus the per-mode façade (`ReadingTelemetry`) the modes will call in Phase 4.

**Unlocks (metric):** a live selftest emits an event and it arrives at a stub
sink (`window.__webhookSink`), respecting event/mode filters and throttle; a
queued event survives a simulated offline→online and is **not** double-delivered.

**Net-new files:** `js/core/webhook-dispatcher.js`, `js/core/reading-telemetry.js`.
**Touches:** `js/test/selftest.js`.

---

## Step 1 — Read the baseline

- Phase 1 modules (`webhook-events`, `webhook-payload`, `webhook-formats`,
  `reading-stats`) and Phase 2 (`webhook-config`).
- `js/core/events.js` — the dispatcher may expose a tiny internal `EventBus`,
  but the public entry is `dispatch(envelope)`; modes go through the façade.
- `js/core/safe-storage.js` — `safeSetItem` for the persisted queue.
- `js/core/sw-register.js` / `sw.js` — optional future home for Background Sync
  (not required for Phase 3; the in-page retry loop is enough).

---

## Step 2 — Pure decision: `shouldSend()` (exported, tested)

```js
// Pure: does THIS endpoint want THIS event right now? Filter + throttle only.
// lastSentMap: { [endpointId+':'+type]: epochMs }. Mutated by the caller on send.
export function shouldSend(endpoint, type, mode, lastSentMap, now, eventDefs) {
  if (!endpoint.enabled) return false;
  if (!endpoint.modes.includes(mode)) return false;
  const wantsAll = endpoint.events.includes('*');
  if (!wantsAll && !endpoint.events.includes(type)) return false;
  const def = eventDefs[type];
  if (!def || !def.modes.includes(mode)) return false;     // event not valid for mode
  const throttleMs = endpoint.throttleOverrides?.[type] ?? def.throttleMs ?? 0;
  if (throttleMs > 0) {
    const last = lastSentMap[endpoint.id + ':' + type] || 0;
    if (now - last < throttleMs) return false;
  }
  return true;
}
```

---

## Step 3 — `js/core/webhook-dispatcher.js`

```js
import { loadConfig, CONFIG_KEY } from './webhook-config.js';
import { EVENT_DEFS } from './webhook-events.js';
import { formatPayload } from './webhook-formats.js';

const QUEUE_KEY = 'webhooks:queue';
const QUEUE_MAX = 200;             // bounded FIFO — see WEBHOOKS.md §4.6
const RETRY_BASE_MS = 4000;        // backoff base; doubles up to a cap
const RETRY_MAX_MS = 5 * 60 * 1000;

export class WebhookDispatcher {
  constructor({ signal } = {}) {
    this._lastSent = Object.create(null);
    this._log = [];                // ring buffer for the debug UI (last ~50)
    this._retryTimer = null;
    this._online = navigator.onLine;
    window.addEventListener('online',  () => { this._online = true; this.flushQueue(); }, { signal });
    window.addEventListener('offline', () => { this._online = false; }, { signal });
    this.flushQueue();             // attempt any leftover from last session
  }

  // The single public entry the façade calls. NEVER throws.
  dispatch(envelope) {
    try {
      const cfg = loadConfig();
      if (!cfg.enabled) return;
      const now = Date.now();
      for (const ep of cfg.endpoints) {
        if (!shouldSend(ep, envelope.event, envelope.source.mode, this._lastSent, now, EVENT_DEFS)) continue;
        this._lastSent[ep.id + ':' + envelope.event] = now;
        const epEnvelope = ep.includeLifetime ? envelope : stripLifetime(envelope);
        this._send(ep, epEnvelope);
      }
    } catch (e) { warnOnce('dispatch', e); }
  }

  async _send(endpoint, envelope, { beacon = false } = {}) {
    const { url, headers, body, raw } = mergeFormat(endpoint, envelope);
    try {
      if (beacon && navigator.sendBeacon && !Object.keys(endpoint.headers||{}).length) {
        const ok = navigator.sendBeacon(url, new Blob([serialize(body, raw)], { type:'application/json' }));
        this._record(endpoint, envelope, ok ? 'beacon' : 'beacon-fail'); return;
      }
      const resp = await fetch(url, {
        method: endpoint.method || 'POST',
        headers: { 'Content-Type': raw ? 'text/plain' : 'application/json', ...headers, ...endpoint.headers },
        body: serialize(body, raw),
        keepalive: beacon,           // survive unload when beacon unavailable (auth headers)
        mode: 'cors',
      });
      this._record(endpoint, envelope, resp.ok ? resp.status : 'http-' + resp.status);
      if (!resp.ok) this._enqueue(endpoint, envelope);   // 5xx etc. → retry
    } catch (e) {
      // Network/CORS error in production: queue + single throttled warn, never spam.
      this._record(endpoint, envelope, 'neterr');
      this._enqueue(endpoint, envelope);
    }
  }

  // Surfaced to the Test button — same path but RETURNS the result (fails loud).
  async sendOne(endpoint, envelope) {
    const { url, headers, body, raw } = mergeFormat(endpoint, envelope);
    const resp = await fetch(url, { method: endpoint.method||'POST',
      headers: { 'Content-Type': raw?'text/plain':'application/json', ...headers, ...endpoint.headers },
      body: serialize(body, raw), mode: 'cors' });
    return { ok: resp.ok, status: resp.status };
  }

  _enqueue(endpoint, envelope) {
    const q = loadQueue();
    q.push({ endpointId: endpoint.id, envelope, tries: 0, at: Date.now() });
    while (q.length > QUEUE_MAX) q.shift();        // drop oldest
    saveQueue(q);
    this._scheduleRetry();
  }

  async flushQueue() {
    if (!this._online) return;
    const cfg = loadConfig();
    const q = loadQueue();
    if (!q.length) return;
    const keep = [];
    for (const item of q) {
      const ep = cfg.endpoints.find(e => e.id === item.endpointId);
      if (!ep || !ep.enabled) continue;            // endpoint gone → drop (idempotency-safe)
      try {
        const r = await this.sendOne(ep, item.envelope);
        if (!r.ok) { item.tries++; if (item.tries < 8) keep.push(item); }
      } catch (_) { item.tries++; if (item.tries < 8) keep.push(item); }
    }
    saveQueue(keep);
    if (keep.length) this._scheduleRetry();
  }

  _scheduleRetry() {
    if (this._retryTimer) return;
    const q = loadQueue();
    const tries = q.length ? Math.max(...q.map(i => i.tries)) : 0;
    const delay = Math.min(RETRY_BASE_MS * 2 ** tries, RETRY_MAX_MS);
    this._retryTimer = setTimeout(() => { this._retryTimer = null; this.flushQueue(); }, delay);
  }

  getLog() { return this._log.slice(-50); }
  _record(ep, env, status) {
    this._log.push({ t: Date.now(), endpoint: ep.name || ep.id, event: env.event, status });
    if (this._log.length > 100) this._log.shift();
    if (new URLSearchParams(location.search).get('webhookdebug') === '1')
      console.debug('[webhook]', ep.name, env.event, status);
  }
}
```

**Notes**
- `mergeFormat(endpoint, envelope)` runs `formatPayload(endpoint.format, env)`
  then overlays the endpoint's own `url`/`headers` (format-provided `url`/headers
  win only when the format sets them, e.g. ntfy's `Title` header).
- The queue is **bounded** and self-trimming. Items whose endpoint was deleted
  are dropped on flush (idempotency keys make any accidental resend harmless).
- One `WebhookDispatcher` is created at app level (Phase 4 wires it in
  `mode-switcher.js`) and shared across mode switches, so `_lastSent` throttle
  state and the queue persist across a mode change within a session.

---

## Step 4 — `js/core/reading-telemetry.js` (the façade)

```js
import { buildEventPayload } from './webhook-payload.js';
import { ReadingStats, loadLifetime, saveLifetime, /* … */ } from './reading-stats.js';

// One per mode session. modeAdapter = { mode, snapshot() } from the app.
// dispatcher + sourceMeta are app-level and passed in by mode-switcher (Phase 4).
export function createTelemetry({ modeAdapter, dispatcher, sourceMeta }) {
  const stats = new ReadingStats({ mode: modeAdapter.mode });

  function emit(type, data = {}) {
    try {
      const snap = modeAdapter.snapshot() || {};
      // Update session stats from the position in this snapshot (Δwords etc.).
      if (snap.position) stats.observe(snap.position);
      const lifetime = updateLifetimeFor(type, snap, stats);   // returns the today/lifetime block
      const ctx = {
        mode: modeAdapter.mode,
        source: { ...sourceMeta, mode: modeAdapter.mode },
        device: deviceBlock(),
        book: snap.book, position: snap.position, pace: snap.pace,
        session: stats.snapshotSession(),
        lifetime,                 // dispatcher strips it for endpoints that opted out
        data,
      };
      const env = buildEventPayload(type, ctx);
      dispatcher.dispatch(env);
    } catch (e) { /* swallow — never break the reader (WEBHOOKS §4.1) */ }
  }

  return { emit, stats,
    markPaused: (...a) => stats.markPaused(...a),
    markResumed: (...a) => stats.markResumed(...a),
    endSession: (reason) => emit('session.ended', { reason, totalActiveMs: stats.activeMs }),
  };
}
```

`updateLifetimeFor` folds active-time/words into `stats:lifetime` and
`stats:book:<id>` (on meaningful events — heartbeats, chapter/page, finished),
computes the streak + today's goal progress, and returns the `lifetime` block.
It is also where `goal.reached` is detected (today's words/minutes crossed the
goal for the first time today) and `book.finished` flips the per-book
`finishedAt`.

---

## Step 5 — Tests

```js
import { shouldSend } from '../core/webhook-dispatcher.js';
import { EVENT_DEFS, EVENTS } from '../core/webhook-events.js';

const ep = { id:'e1', enabled:true, modes:['read'], events:['*'], throttleOverrides:{} };
const last = {};
assert('webhooks', 'shouldSend passes a valid reader event',
  shouldSend(ep, EVENTS.PAGE_TURNED, 'read', last, 1000, EVENT_DEFS) === true);
last['e1:'+EVENTS.PAGE_TURNED] = 1000;
assert('webhooks', 'throttle blocks within window',
  shouldSend(ep, EVENTS.PAGE_TURNED, 'read', last, 1500, EVENT_DEFS) === false);
assert('webhooks', 'throttle allows after window',
  shouldSend(ep, EVENTS.PAGE_TURNED, 'read', last, 4500, EVENT_DEFS) === true);
assert('webhooks', 'mode filter blocks rsvp event on reader',
  shouldSend(ep, EVENTS.RSVP_WPM_CHANGED, 'read', {}, 0, EVENT_DEFS) === false);
assert('webhooks', 'explicit event list excludes others',
  shouldSend({ ...ep, events:['chapter.started'] }, EVENTS.PAGE_TURNED, 'read', {}, 9e9, EVENT_DEFS) === false);
```

**Live test** (`runLiveTests`): install a sink that captures sends, point the
dispatcher at it, emit two `page.turned` 1s apart (expect 1 delivered due to
throttle), then one after 4s (expect 2). For the queue: monkeypatch `fetch` to
reject, dispatch, assert the item is queued; restore `fetch`, call `flushQueue`,
assert delivered exactly once. Use `window.__webhookSink` per
[`06-testing-and-debugging.md`](06-testing-and-debugging.md).

---

## Definition of done

- [ ] `dispatch()` never throws; honours enabled/mode/event/throttle filters.
- [ ] Offline event queues (bounded) and flushes once on reconnect — no double-deliver.
- [ ] `sendOne()` returns a result for the Test button (fails loud).
- [ ] `lifetime` stripped for endpoints with `includeLifetime:false`.
- [ ] Debug ring buffer populated; `?webhookdebug=1` logs.
- [ ] All Step 5 tests green.
</content>
