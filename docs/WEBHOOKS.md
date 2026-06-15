# Smart-Home Webhooks Subsystem (`docs/WEBHOOKS.md`)

How Reader turns reading activity into configurable webhooks. This is the
**subsystem reference** — modules, data flow, security, and the best
practices/reminders/learnings to read before changing any webhook code.

> Companions: [`EVENT-CATALOG.md`](EVENT-CATALOG.md) (the payload contract),
> [`ARCHITECTURE.md`](ARCHITECTURE.md), [`BEST-PRACTICES.md`](BEST-PRACTICES.md),
> [`STATE.md`](STATE.md). Build plan: [`../plans/smart-home-webhooks.md`](../plans/smart-home-webhooks.md).

---

## 1. One-paragraph mental model

Reading modes emit **semantic events** (`page.turned`, `chapter.started`, …) to
a single per-mode façade (`ReadingTelemetry`). The façade gathers the book,
position, and pace at that instant, updates the **session + lifetime stats**,
builds the **canonical envelope** (`buildEventPayload`), and hands it to the
**dispatcher**. The dispatcher filters per endpoint (which events/modes), applies
**throttles**, runs the per-endpoint **format adapter**, and sends via
`fetch`/`sendBeacon` — queueing to `localStorage` and retrying when offline.
Modes never touch the network; the dispatcher never touches reading logic.

---

## 2. Modules

All under `js/core/` unless noted. Pure modules have **no** DOM/storage/network
and run under Node for tests.

| Module | Kind | Exports (key) |
| --- | --- | --- |
| `webhook-events.js` | pure data | `EVENTS` (constants), `EVENT_DEFS` (modes+throttle+defaults), `MODE_EVENTS`, `eventsForMode(mode)` |
| `reading-stats.js` | core+IO | `ReadingStats` (session tracker), `applyEvent(state,type,ctx)`, `loadLifetime()`, `saveLifetime()`, `localDateKey(d)`, `estimateMinutesRemaining()` |
| `webhook-payload.js` | pure | `buildEventPayload(type, ctx, { now, idFn })` |
| `webhook-formats.js` | pure | `formatPayload(format, envelope)`, `FORMATS` |
| `webhook-config.js` | core+IO | `loadConfig()`, `saveConfig()`, `validateEndpoint()`, `DEFAULT_CONFIG` |
| `webhook-dispatcher.js` | impure | `WebhookDispatcher` (`dispatch(envelope)`, `flushQueue()`), `shouldSend()` (pure, exported for tests) |
| `reading-telemetry.js` | glue | `createTelemetry(modeAdapter)` → `{ emit(type, data) }` |
| `settings/webhooks-tab.js` *(or inline in `settings-screen.js`)* | UI | Smart Home settings tab |

### Data flow (a page turn in Reader)
```
reader-app.js updateProgressFn()  (page changed)
  └─ telemetry.emit('page.turned', { from, to, direction })
       └─ ReadingTelemetry: modeAdapter.snapshot()  → { book, position, pace, mode }
            └─ ReadingStats.note('page.turned', snapshot)   // session + lifetime
            └─ buildEventPayload('page.turned', { ...snapshot, stats })  → envelope
                 └─ WebhookDispatcher.dispatch(envelope)
                      └─ for each enabled endpoint:
                           shouldSend(endpoint,'page.turned','read',lastSent,now)?  // throttle/filter
                           formatPayload(endpoint.format, envelope)  → { url, headers, body }
                           send()  → ok | queue+retry
```

### The mode adapter (what each app provides to the façade)
Each mode builds **one** small adapter object and passes it to
`createTelemetry`. It exposes getters the façade calls on every emit — never
copies of state, so the snapshot is always current:

```js
const telemetry = createTelemetry({
  mode: 'read',
  snapshot() {
    return {
      book: bookSnapshot(),           // from BookSession (title/id/format/totals)
      position: positionSnapshot(),   // from getCanonicalPosition() + chapter/page
      pace: paceSnapshot(),           // wpm/rate/avg
    };
  },
});
```
The façade owns `ReadingStats`, the dispatcher, and the envelope build, so the
three mode adapters stay tiny and identical in shape.

---

## 3. Configuration & storage schema

`localStorage` keys (read via try/catch, written via `safeSetItem`):

| Key | Holds |
| --- | --- |
| `webhooks:config` | `DEFAULT_CONFIG`-shaped endpoint list + global switches |
| `webhooks:queue` | Pending sends (offline/retry), bounded FIFO |
| `stats:lifetime` | Lifetime aggregate + bounded per-day map |
| `stats:book:<bookId>` | Per-book progress (firstOpenedAt, activeMs, furthestFraction, finishedAt) |
| `instance:id` | Random stable per-profile id (`source.instanceId`) |

`webhooks:config`:
```jsonc
{
  "version": 1,
  "enabled": true,                 // global master switch ("pause all webhooks")
  "endpoints": [
    {
      "id": "ep_home",
      "name": "Home Assistant",
      "url": "https://ha.local/api/webhook/reader",
      "method": "POST",
      "enabled": true,
      "format": "home-assistant",  // generic | home-assistant | ifttt | ntfy | mqtt-http
      "headers": { "Authorization": "Bearer …" },
      "events": ["*"],             // or explicit list, e.g. ["chapter.started","book.finished"]
      "modes":  ["read","rsvp","tts"],
      "includeLifetime": false,
      "throttleOverrides": { "page.turned": 5000 },
      "milestoneStep": 10          // emit progress.milestone every N %
    }
  ]
}
```

Endpoints, defaults, and validation live in `webhook-config.js`. **Default ships
with zero endpoints** — the feature is inert until the user adds one.

---

## 4. Best practices, reminders & learnings

The rules this subsystem must obey. Each is a *reminder* with the *learning*
behind it. Read before changing webhook code.

### 4.1 Emitting must never block or break reading
**Rule.** `telemetry.emit()` and every send are fully wrapped in try/catch
inside the subsystem; a mode calls `emit()` like calling `console.log`.
**Learning.** A page turn / RSVP tick is a hot path. If a malformed endpoint URL
or a synchronous `JSON.stringify` on a cyclic object threw here, the reader would
freeze on every turn. Catch everything; degrade to a dropped event. Never let a
webhook concern surface a user-visible error.

### 4.2 Don't recount words or reinvent position
**Rule.** Stats and payloads read the mode's existing `getCanonicalPosition()`
and total-word count. **No second word stream.**
**Learning.** [`BEST-PRACTICES.md` §1.4](BEST-PRACTICES.md): divergent word
counts already caused a cumulative cross-mode "off by a page" drift once. A
webhook that reported a different `percentComplete` than the app's own progress
bar is the same bug wearing a hat.

### 4.3 Throttle the chatty events — per endpoint, per event
**Rule.** `page.turned`, `session.heartbeat`, `rsvp.wpm_changed`,
`tts.rate_changed` are rate-limited (defaults in `EVENT_DEFS`).
**Learning.** RSVP at 800 wpm with `chunkSize: 1` fires word advances ~13×/sec;
a fast Reader flicks pages every second. Un-throttled, that's a self-inflicted
DoS on a Raspberry-Pi-class hub. Throttle is keyed `(endpointId + eventType)` so
one slow endpoint doesn't starve another.

### 4.4 Idempotency keys, not duplicate counts
**Rule.** Every event has an `idempotencyKey` stable for its logical occurrence
(book + event + coarse bucket), so a queued retry is dedupable.
**Learning.** Offline → online flushes the queue. Without a stable key, a hub
counting `page.turned` would double-count every page read on the train. The key
deliberately excludes the timestamp.

### 4.5 Local date for streaks & "today"
**Rule.** Per-day buckets use the **local** calendar date, not UTC.
**Learning.** `Date.toISOString().slice(0,10)` is UTC. For a reader at UTC−5,
9 pm reading lands on "tomorrow", silently breaking streaks and the daily goal.
`localDateKey()` converts to local first; there is a selftest for it.

### 4.6 Bound everything persisted
**Rule.** The offline queue is a bounded FIFO (drop oldest); the per-day stats
map is pruned to the last ~400 days.
**Learning.** `safeSetItem` prunes *positions* on quota errors, but an unbounded
webhook queue could fill storage first and evict a reader's actual saved place —
the worst outcome (see `safe-storage.js`). Webhook data must never crowd out
reading data; keep it small and self-trimming.

### 4.7 `sendBeacon` for unload, `fetch` otherwise
**Rule.** `session.ended` / `book.closed` on `pagehide`/`visibilitychange`
use `navigator.sendBeacon` (survives unload); everything else uses `fetch`.
**Learning.** A `fetch` started during unload is cancelled by the browser, so
the most important "you stopped reading" event would be the one most likely to
be lost. Beacon is fire-and-forget and unload-safe. (Beacon can't set custom
headers — endpoints needing auth headers fall back to a `keepalive: true`
`fetch`; document this per format.)

### 4.8 Opt-in, local-first, transparent
**Rule.** No endpoints by default; config in `localStorage` only; `lifetime`
opt-in per endpoint; a master pause switch; this doc lists every field every
event can send.
**Learning.** Reading is sensitive. The app's whole stance is local-first (no
server, [`ARCHITECTURE.md`](ARCHITECTURE.md)). Webhooks are the one place data
leaves the device, so the bar for consent and clarity is highest here.

### 4.9 CORS is the user's problem to enable — fail loud in the test, quiet in prod
**Rule.** The **Test** button surfaces network/CORS errors to the user; live
emits swallow them (after a single throttled `console.warn`).
**Learning.** Browsers block cross-origin responses without CORS headers. A
home hub the user controls can add them; a third-party can't. The test path must
tell the user *now* (so they fix their endpoint), but production must never spam
the console or retry-storm a permanently-blocked endpoint.

### 4.10 Keep pure modules pure
**Rule.** `webhook-events`, `webhook-payload`, `webhook-formats` import cleanly
under Node — no DOM, no `localStorage`, no `Date.now()` baked in (inject `now`).
**Learning.** `selftest.js` runs them in real Chromium but also imports them at
module top level; a stray `document.` reference at import time hard-fails the
**entire** suite. Inject the clock so payload tests are deterministic.

---

## 5. Security checklist

- Validate endpoint URLs (`https:`/`http:` only; reuse the spirit of
  `js/core/src-url.js`'s `validateBookSrcUrl`). Block `file:`, `javascript:`,
  `data:`.
- Never log full payloads with `lifetime` to the console by default.
- Headers are user-supplied; send verbatim but never echo secrets into the
  debug UI in plaintext (mask all but the last 4 chars).
- The offline queue may persist payloads containing reading data — clearing app
  data / "remove endpoint" must also purge its queued items.

---

## 6. Debugging

- **Debug log:** the dispatcher keeps an in-memory ring buffer of the last N
  sends (`type`, endpoint, status, ms). Surfaced in Settings → Smart Home →
  "Recent deliveries". Add `?webhookdebug=1` to also `console.debug` each send.
- **Local sink:** `06-testing-and-debugging.md` ships a 10-line Node echo server;
  point an endpoint at `http://localhost:8787/` and watch events arrive.
- **Selftest:** `node test/run-selftest.mjs` covers the pure builders, the
  throttle/filter decision, and a live emit into `window.__webhookSink`.
- **Common issues:** see the troubleshooting table in
  [`../plans/smart-home/06-testing-and-debugging.md`](../plans/smart-home/06-testing-and-debugging.md).
</content>
