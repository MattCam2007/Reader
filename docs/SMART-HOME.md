# Smart Home Integration (Webhooks)

Reader can push every meaningful reading moment — opening a book, turning a
page, finishing a chapter, hitting 50%, pausing the speed-reader — to a webhook
URL as a rich JSON payload. It is designed first for **Home Assistant**'s
webhook triggers, but anything that accepts an HTTP POST (Node-RED,
n8n, a home-grown endpoint) works the same way.

Everything is configured in the app: **Settings → Home**.

- [Quick start (Home Assistant)](#quick-start-home-assistant)
- [Delivery formats](#delivery-formats)
- [The payload](#the-payload)
- [Event reference](#event-reference)
- [Home Assistant recipes](#home-assistant-recipes)
- [Reliability: queueing, retry, app close](#reliability-queueing-retry-app-close)
- [Troubleshooting](#troubleshooting)
- [Developer guide: adding a new event](#developer-guide-adding-a-new-event)

---

## Quick start (Home Assistant)

1. In Home Assistant, create an automation with a **Webhook trigger** and give
   it an id, e.g. `reader`. Allow POST (the default) and — if your reader
   doesn't run on the same LAN — turn off "Only accessible from the local
   network".
2. In Reader: **Settings → Home**
   - toggle **Send events to a webhook** on
   - set the **Webhook URL** to `http://homeassistant.local:8123/api/webhook/reader`
     (or your HA base URL + `/api/webhook/<your-id>`)
   - press **Send test event** — you should see *Delivered (HTTP 200)* and the
     automation's trace should show a `test.ping` payload
3. Pick your delivery format (below), toggle the events you care about, and
   start reading.

> **HTTPS reader → HTTP Home Assistant will not work.** Browsers block mixed
> content, so a reader served from `https://` (e.g. GitHub Pages) cannot POST
> to `http://homeassistant.local:8123`. See [Troubleshooting](#troubleshooting).

---

## Delivery formats

Browsers apply cross-origin rules to webhook POSTs, so Reader offers two
formats. Both send the exact same information.

### `JSON` (default — the rich one)

`POST` with `Content-Type: application/json`. Home Assistant exposes the whole
payload as `trigger.json`:

```yaml
{{ trigger.json.event }}                      # "chapter.finished"
{{ trigger.json.book.title }}                 # "Queen of Sorcery"
{{ trigger.json.position.percent }}           # 42.7
{{ trigger.json.position.chapter.label }}     # "Chapter Nine"
{{ trigger.json.session.avgWpm }}             # 312
```

Cross-origin JSON POSTs are **preflighted** by the browser, so Home Assistant
must allow your reader's origin in `configuration.yaml`:

```yaml
http:
  cors_allowed_origins:
    - https://your-user.github.io   # wherever Reader is served from
    - http://localhost:8000         # local dev
```

Restart HA after adding it. If you can't (or don't want to) touch the HA
config, use the form format instead.

### `Form (no CORS)` (works with a stock HA)

`POST` with `Content-Type: application/x-www-form-urlencoded` — a CORS
"simple request" that needs **no preflight and no HA configuration**. The
top-level scalar fields (`event`, `ts`, `epochMs`, `seq`) arrive as plain form
fields; each nested section (`book`, `position`, `session`, …) arrives as a
JSON string in its own field. In Home Assistant that means `trigger.data`:

```yaml
{{ trigger.data.event }}                                # "page.turned"
{{ (trigger.data.book | from_json).title }}             # "Queen of Sorcery"
{{ (trigger.data.position | from_json).percent }}       # 42.7
```

The trade-off: the browser sends it "fire and forget" (`no-cors`), so Reader
cannot see whether HA answered 200 — the test button reports *Sent (no-CORS)*
rather than a confirmed delivery.

---

## The payload

Every event ships the same envelope; only `data` is event-specific. This is
the Cadillac trim — everything the app knows rides along:

```json
{
  "event": "chapter.finished",
  "ts": "2026-07-02T20:14:05.128Z",
  "epochMs": 1782159245128,
  "seq": 17,

  "app": {
    "name": "Reader",
    "mode": "read",                  // "read" | "rsvp" | "tts"
    "language": "en-US",
    "standalone": true               // installed as a PWA?
  },

  "book": {
    "id": "queen-of-sorcery:2f9c11aa",
    "title": "Queen of Sorcery",
    "fileName": "02 - David Eddings - Queen of Sorcery (1982).epub",
    "format": "epub",
    "isSample": false,
    "totalWords": 106253,
    "chapterCount": 39
  },

  "position": {
    "wordOrdinal": 45210,
    "totalWords": 106253,
    "fraction": 0.4255,
    "percent": 42.5,
    "wordsRemaining": 61042,
    "minutesRemaining": 196,         // at the session's measured WPM (or 230)
    "chapter": {
      "index": 11, "count": 39,
      "label": "Chapter Nine",
      "href": "chapter09.xhtml",
      "wordCount": 3120, "wordsInto": 3078, "percent": 98.7
    },
    "page": { "number": 214, "count": 507 }   // paginated reader only, else null
  },

  "session": {                       // this app launch
    "startedAt": "2026-07-02T19:31:02.010Z",
    "durationSec": 2583,
    "pagesTurned": 118,
    "wordsRead": 9834,
    "chaptersCompleted": 3,
    "booksOpened": 1,
    "bookmarksAdded": 2,
    "modesUsed": ["read", "rsvp"],
    "avgWpm": 312                    // null until enough reading is measured
  },

  "settings": {                      // toggleable: "Include settings snapshot"
    "theme": "sepia",
    "general": { "theme": "sepia", "brightness": 0.9, "warmth": 0.2, "...": "..." },
    "reader":  { "font": "serif", "size": 21, "layout": "paginated", "...": "..." },
    "rsvp":    { "wpm": 425, "chunkSize": 2, "...": "..." },
    "tts":     { "rate": 1.25, "...": "..." }
  },

  "device": {                        // toggleable: "Include device info"
    "userAgent": "…", "platform": "Linux armv8l",
    "online": true, "touch": true,
    "screenWidth": 1600, "screenHeight": 2560, "pixelRatio": 2
  },

  "data": { "chapter": { "…": "as position.chapter, for the chapter the event is about" },
            "completed": true }
}
```

Notes:

- `wordsRead` counts *reading* — forward movement up to ~a page at a time.
  Jumps (TOC, bookmarks, the scrub bar) are treated as seeks and not counted.
- `avgWpm` needs ≥ 200 words over ≥ 60 s before it reports; until then
  `minutesRemaining` assumes 230 WPM.
- The `theme` also appears at `settings.theme` for easy templating.

---

## Event reference

Each event can be toggled individually in **Settings → Home → Events**.
`data` fields listed are in addition to the common envelope above.

### Session

| Event | Fires when | `data` |
|---|---|---|
| `session.start` | The first book of this app launch opens (or reading resumes after the tab was hidden long enough to end the previous session) | `resumed` (bool, restore-after-hide only) |
| `session.end` | The page is hidden/closed (`pagehide`) — sent via beacon/keepalive so it survives the app closing | — (the `session` block is the payload) |

### Book

| Event | Fires when | `data` |
|---|---|---|
| `book.opened` | A book finishes loading in any mode. A mode switch re-announces the same book silently — no duplicate event | `resumed` (bool), `resumedAtPercent` |
| `book.started` | The book was opened at ≤ 2% — i.e. actually starting it | — |
| `book.finished` | The reading position crosses 99.5%. Latched per book (fires once); dropping back below 90% re-arms it | — |
| `progress.milestone` | Crossing 10 / 25 / 50 / 75 / 90% — once each per book (persisted latch, highest crossed step per tick) | `milestone` (number) |

### Chapters & pages

| Event | Fires when | `data` |
|---|---|---|
| `chapter.started` | The position enters a different chapter (also once at book open, with `resumed: true` when resuming) | `chapter` (block), `resumed` |
| `chapter.finished` | The position leaves a chapter | `chapter` (the one left), `completed` (bool — true only if ≥ 98% of it was reached moving forward) |
| `page.turned` | A page turn in the paginated reader. Deduped against relayouts (a font change renumbering pages is not a turn) and throttleable in settings | `page`, `pageCount`, `direction` (`forward`/`back`), `chapterLabel` |

Chapter and progress events are derived from the same debounced position saves
all three modes already perform, so they fire in Read, Speed *and* Listen
modes (RSVP/TTS feed a position every ~5 s while playing).

### Playback

| Event | Fires when | `data` |
|---|---|---|
| `playback.started` | RSVP playback starts, or TTS narration starts | RSVP: `playbackMode:"rsvp"`, `wpm`, `chunkSize` · TTS: `playbackMode:"tts"`, `voice`, `rate`, `sentenceIndex`, `sentenceCount` |
| `playback.paused` | RSVP pauses; TTS pauses or reaches the end (`reason:"end"`) | RSVP adds `sessionWords`, `sessionPlaySec`, `sessionAvgWpm` |

### App

| Event | Fires when | `data` |
|---|---|---|
| `mode.switched` | Switching Read / Speed / Listen (boot is not a switch) | `from`, `to` |
| `theme.changed` | The theme actually changes (boot baseline and re-applies don't fire) | `theme`, `previous` |
| `bookmark.added` | A bookmark is placed in any mode | `chapterLabel`, `text` (snippet), `percent`, `color` |
| `test.ping` | The **Send test event** button (bypasses the master toggle so you can test before enabling) | `hello` |

---

## Home Assistant recipes

**Reading light scene when a session starts, restore when it ends:**

```yaml
triggers:
  - trigger: webhook
    webhook_id: reader
    allowed_methods: [POST]
conditions:
  - condition: template
    value_template: "{{ trigger.json.event == 'session.start' }}"
actions:
  - action: scene.turn_on
    target: { entity_id: scene.reading_nook }
```

**Chapter break = stretch break (flash the lights between chapters):**

```yaml
conditions:
  - condition: template
    value_template: >
      {{ trigger.json.event == 'chapter.finished'
         and trigger.json.data.completed }}
actions:
  - action: light.turn_on
    target: { entity_id: light.reading_lamp }
    data: { flash: short }
```

**Celebrate finishing a book:**

```yaml
conditions:
  - condition: template
    value_template: "{{ trigger.json.event == 'book.finished' }}"
actions:
  - action: notify.mobile_app_phone
    data:
      title: "📚 Book finished!"
      message: >
        {{ trigger.json.book.title }} — {{ trigger.json.session.wordsRead }}
        words this session at {{ trigger.json.session.avgWpm or '—' }} WPM.
```

**Track progress as sensors** (template sensors updated by one automation):

```yaml
triggers:
  - trigger: webhook
    webhook_id: reader
    allowed_methods: [POST]
actions:
  - action: input_text.set_value
    target: { entity_id: input_text.reader_book }
    data: { value: "{{ trigger.json.book.title if trigger.json.book else 'none' }}" }
  - action: input_number.set_value
    target: { entity_id: input_number.reader_percent }
    data: { value: "{{ trigger.json.position.percent if trigger.json.position else 0 }}" }
```

Pair `input_number.reader_percent` with a dashboard gauge and you have a live
"how far into the book" card. `position.minutesRemaining` makes a great
"time until lights-out is actually feasible" sensor.

**Warm the lights as the evening's reading gets long:**

```yaml
conditions:
  - condition: template
    value_template: >
      {{ trigger.json.event == 'progress.milestone'
         and trigger.json.data.milestone >= 50 }}
actions:
  - action: light.turn_on
    target: { entity_id: light.reading_lamp }
    data: { color_temp_kelvin: 2400 }
```

---

## Reliability: queueing, retry, app close

- Events queue in memory (bounded to 100) and deliver in order; each gets up
  to 3 attempts with backoff (0 s / 2 s / 8 s). Definitive HTTP 4xx responses
  are not retried.
- On `pagehide` / tab-hidden the queue is flushed with `navigator.sendBeacon`
  (form format — beacon-safe with no preflight) or `fetch(…, keepalive)`
  (JSON format), so `session.end` survives the app closing.
- Anything still undelivered is persisted to `localStorage`
  (`smarthome:outbox`) and re-sent ~4 s after the next launch.
- Webhook failures never affect reading: every hook is wrapped, and event
  emission costs one method call on the reader's hot paths (the heavy payload
  assembly only runs for events that are enabled).

Storage keys used: `smarthome:prefs` (settings), `smarthome:book:<bookId>`
(per-book finished/milestone latches), `smarthome:outbox` (undelivered
events).

---

## Troubleshooting

**Test says *Delivered* but nothing happens in HA** — the automation's
webhook id doesn't match the URL path, or the automation's conditions filter
the `test.ping` event out. Check the automation trace.

**Test fails with `network-error` in JSON format** — almost always CORS: add
your reader origin to `http: cors_allowed_origins` in HA and restart, or
switch to the Form format. Check the browser devtools console — a blocked
preflight is logged there.

**HTTPS reader, HTTP Home Assistant** — the browser refuses (mixed content;
the settings tab warns about this). Options:
- Use your **Nabu Casa** cloud webhook URL (`https://hooks.nabu.casa/…`) —
  works from anywhere, HTTPS, no CORS preflight issues in form format.
- Put HA behind HTTPS (reverse proxy, Let's Encrypt).
- Serve Reader over plain HTTP on your LAN (e.g. `python3 -m http.server`) —
  an http page may POST to http HA freely.

**Events arrive but `trigger.json` is empty** — you're in Form format; use
`trigger.data` (with `| from_json` for the nested sections), or switch the
reader to JSON format.

**No `page.turned` events** — you're in scroll layout (no pages) or the
throttle is set; chapter/milestone events still fire from position saves.

---

## Developer guide: adding a new event

The whole system funnels through `js/core/smarthome.js`. The settings UI, the
gating, the payload envelope and the delivery pipeline are all driven by the
**event catalog**, so a new event is four small steps:

1. **Catalog** — add an entry to `EVENT_CATALOG` in `js/core/smarthome.js`:

   ```js
   { id: 'dictionary.lookup', group: 'app', enabled: true,
     label: 'Word looked up', description: 'A word was looked up in the dictionary' },
   ```

   `group` must be one of `EVENT_GROUPS` (or add a new group there). The
   settings tab renders the toggle automatically, defaulted to `enabled`;
   stored toggle maps from older versions merge the new event in on load.

2. **i18n** — add the label/description strings to `js/i18n/en.js`
   (`'sh.ev.dictionary.lookup'` and `'sh.evd.dictionary.lookup'`). Other
   locales fall back to English until translated.

3. **Emit** — call it from the code that observes the moment:

   ```js
   import { smarthome } from './core/smarthome.js';
   smarthome.emit('dictionary.lookup', { word, found: !!entry });
   ```

   `emit()` is safe to call unconditionally: it no-ops unless the integration
   is enabled *and* the event's toggle is on, it never throws into the caller,
   and the full envelope (book, position, session, settings, device) is
   attached automatically — you only supply the event-specific `data`.

   If the event needs *derivation or state* (like the chapter/milestone
   events), add a notify method on `SmartHomeClient` instead and keep the
   state in the client, so it stays testable with an injected clock/transport.

4. **Document + test** — add a row to the [event reference](#event-reference)
   above, and if you added derivation logic, extend the `core/smarthome`
   block in `js/test/selftest.js` (construct `SmartHomeClient` with
   `{ send, now, storage }` injected and assert on `client._queue`).

Design invariants to keep:

- **Never block reading.** No awaits on the hot path, everything wrapped.
- **Positions drive derivation.** If a moment can be derived from consecutive
  canonical positions, derive it in `positionTick()` rather than wiring a new
  hook into three mode apps.
- **The catalog is the single source of truth** — UI, gating and docs hang
  off it; don't emit an event id that isn't in it.
