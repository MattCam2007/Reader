# Phase 6 — Testing & Debugging (`06-testing-and-debugging.md`)

**Goal.** Make the whole subsystem provable and debuggable: the selftest
coverage map, a local sink + echo server, the in-app debug log, and a
troubleshooting table. Most assertions were written alongside their phase — this
sheet is the consolidation and the manual-verification harness.

**Touches:** `js/test/selftest.js` (final coverage), `docs/WEBHOOKS.md` (debug
section). No net-new runtime files.

---

## 1. The harness (recap)

`node test/run-selftest.mjs` boots real Chromium, opens
`reader.html?selftest=1`, runs `runSelftest(state, hooks)` (unit + live), then
smoke-boots `?mode=rsvp` and `?mode=tts`. See [`../../docs/TESTING.md`](../../docs/TESTING.md).
Everything webhook-related runs **in-page** — no net-new infra, no real network.

Two test styles, both used here:
- **Unit** — pure builders/reducers/decisions (`webhook-events`,
  `webhook-payload`, `webhook-formats`, `reading-stats`, `shouldSend`,
  `webhook-config`). Run under Node-in-Chromium with no DOM.
- **Live** (`runLiveTests`) — drive the real reader closures via `hooks`, emit
  events into a stub sink, assert on the captured envelopes.

---

## 2. The stub sink (no real network in tests)

The dispatcher recognises a reserved URL and pushes to a global instead of
calling `fetch`. Add to `WebhookDispatcher._send` at the very top:

```js
if (endpoint.url === '__sink__' && window.__webhookSink) {
  window.__webhookSink.push(mergeFormat(endpoint, envelope).body);
  this._record(endpoint, envelope, 'sink');
  return;
}
```

A live test then:

```js
window.__webhookSink = { events: [], push(e){ this.events.push(e); } };
saveConfig({ version:1, enabled:true, endpoints:[{
  id:'t', name:'sink', url:'__sink__', method:'POST', enabled:true,
  format:'generic', headers:{}, events:['*'], modes:['read','rsvp','tts'],
  includeLifetime:true, throttleOverrides:{ 'page.turned':0 }, milestoneStep:10,
}]});
// …drive the reader via hooks, then assert on window.__webhookSink.events
```

> Set `throttleOverrides['page.turned']=0` in the test endpoint so paging
> deterministically delivers every turn; assert throttle separately via the pure
> `shouldSend` unit tests (Phase 3) where the clock is injected.

---

## 3. Coverage map (what must be green)

| Area | Style | Asserts |
| --- | --- | --- |
| Event registry | unit | every `EVENT_DEFS` key valid; `eventsForMode` filters; reader-only events excluded from rsvp/tts |
| Stats math | unit | `localDateKey` local not UTC; streak consecutive + breaks on gap; `estimateMinutesRemaining`; Δwords never negative on backward seek |
| Payload | unit | schema/version; derived `wordsRemaining`/`percentComplete`/ETA; `idempotencyKey` stable + bucketed; no `null` in JSON |
| Formats | unit | each of 5 formats returns a body; HA flatten; ntfy title/body strings |
| Config | unit | round-trip; reject non-http; reject empty events; normalize drops unknowns |
| Dispatcher decision | unit | `shouldSend` filter + throttle + mode gate + explicit-event list |
| Queue/retry | live | offline→queue (bounded); flush delivers exactly once; deleted endpoint drops queued item |
| Mode wiring | live | chapter/page/finished fire with correct mode + fields; dedupe (relayout doesn't re-fire); play/pause/voice/rate (tts); wpm (rsvp) |
| Lifetime | live | finishing the sample increments `booksFinished`; today's words accrue; goal crossing fires `goal.reached` once |

---

## 4. Local echo server (manual verification)

A zero-dependency Node sink to watch real deliveries from a browser:

```js
// tools/webhook-echo.mjs  — run: node tools/webhook-echo.mjs
import http from 'node:http';
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');               // so the browser isn't CORS-blocked
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try { const j = JSON.parse(body); console.log('▶', j.event, '|', j.book?.title, '|', j.position?.percentComplete + '%'); }
    catch { console.log('▶ (non-json)', body.slice(0, 200)); }
    res.writeHead(200); res.end('ok');
  });
}).listen(8787, () => console.log('webhook echo on http://localhost:8787/'));
```

Then in Reader add an endpoint at `http://localhost:8787/`, Format **generic**,
Events `*`, and read — events stream to the terminal. (This is also the fastest
way to eyeball the rich payload while building.)

---

## 5. The in-app debug log

`WebhookDispatcher.getLog()` returns the last ~50 deliveries
(`{ t, endpoint, event, status }`). Render it in Settings → Smart Home →
"Recent deliveries" (Phase 2 left a placeholder). Refresh on open and on a
lightweight timer while the tab is visible. `?webhookdebug=1` also mirrors each
send to `console.debug`.

Statuses you'll see: `200`/`204` (ok), `sink` (test), `beacon`/`beacon-fail`,
`http-4xx`/`http-5xx`, `neterr` (network/CORS — queued).

---

## 6. Troubleshooting table (mirror into `docs/WEBHOOKS.md`)

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Nothing arrives, no log entries | Master switch off, or 0 endpoints, or event not in endpoint's list/mode | Check Smart Home toggle; add the event/mode to the endpoint |
| Log shows `neterr` repeatedly | CORS blocked, or endpoint down | Add `Access-Control-Allow-Origin` on the endpoint; use **Test** to confirm |
| `page.turned` floods | throttle override set to 0 | Restore default 3s or raise it |
| Duplicate counts on the hub | hub ignoring `idempotencyKey`, or counting on retries | Dedupe on `idempotencyKey` server-side |
| Streak resets a day early | (should be impossible) UTC vs local bug regressed | Re-check `localDateKey` selftest |
| `lifetime` missing | endpoint `includeLifetime:false` | Enable it for that endpoint |
| Events stop after a mode switch | dispatcher not shared across modes | Ensure `mode-switcher.js` owns ONE dispatcher (Phase 4 §0) |
| `book.finished` never fires | fraction never reaches ≥0.999 (trailing matter) | Confirm the 0.999 threshold + once-guard; some books end before 100% words |

---

## 7. Manual verification checklist (per mode)

1. Configure the local echo endpoint (`*` events).
2. **Reader:** open the sample → `book.opened`; swipe pages → throttled
   `page.turned`; jump chapters via TOC → `chapter.started`; scrub to the end →
   `book.finished`. Highlight a word → `highlight.added`.
3. **RSVP:** play → `reading.resumed` + heartbeats; change WPM → `rsvp.wpm_changed`;
   let auto-training bump → `rsvp.training_levelup`; pause → `reading.paused`.
4. **TTS:** play → `tts.playback_started`; change voice/rate → those events;
   reach the end → `book.finished`.
5. Toggle airplane mode mid-read → events queue → reconnect → queue flushes once
   (watch the echo terminal; no duplicates).
6. Hit your daily goal → `goal.reached` once; confirm it doesn't refire.

---

## Definition of done

- [ ] Full coverage map green under `node test/run-selftest.mjs`.
- [ ] Stub-sink live tests assert per-mode events + fields + dedupe + queue.
- [ ] Echo server + debug log usable; troubleshooting table in `docs/WEBHOOKS.md`.
- [ ] Manual checklist passes for all three modes incl. offline→online.
</content>
