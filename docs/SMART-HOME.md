# Smart Home / MQTT Integration — Reference

**Status:** Reference for the feature planned in
[`plans/smart-home-mqtt.md`](../plans/smart-home-mqtt.md). This is the living
contract: the **event names, payload schema, and topic layout** here are what
dashboards and automations depend on. Keep it in sync with the shipped code.

> **The one hard constraint:** browsers can only reach MQTT over **WebSockets**
> (`ws://` / `wss://`). The broker must expose a WebSocket listener (Mosquitto:
> `listener 9001` + `protocol websockets`). On an **HTTPS** page you must use
> `wss://` or the browser blocks the connection (mixed content). The default UI
> port is **9001**, not 1883.

---

## 1. What gets published, and why

The app is a **publisher only**. As you read, it publishes:

- **Lifecycle events** — discrete things that happened (`book.opened`,
  `chapter.changed`, `book.finished`, …). Transient by default.
- **Retained state snapshots** — the *current* book, position, and stats. Retained
  so a dashboard that connects later (or restarts) immediately sees current values
  without waiting for the next event.
- **Online/offline status** — a retained "birth" message (`online`) on connect and
  a **Last Will & Testament** (`offline`) the broker publishes if the app vanishes.

This split is deliberate: **events drive automations** ("flash a light when I
finish a book"), **retained state drives dashboards** ("show what I'm reading
now").

---

## 2. Topic layout

All topics derive from a configurable `baseTopic` (default `reader`) and a stable,
randomly-generated, persisted `deviceId` (so multiple devices don't collide).

```
<baseTopic>/<deviceId>/status                 # "online" / "offline"  (retained, LWT)
<baseTopic>/<deviceId>/event/<event-name>     # one topic per event   (transient)
<baseTopic>/<deviceId>/state/book             # current book          (retained)
<baseTopic>/<deviceId>/state/position         # current position      (retained)
<baseTopic>/<deviceId>/state/stats            # current session stats (retained)
```

Examples:
```
reader/dev-a1b2c3d4/status
reader/dev-a1b2c3d4/event/book.opened
reader/dev-a1b2c3d4/event/reader.page.turned
reader/dev-a1b2c3d4/event/chapter.changed
reader/dev-a1b2c3d4/state/position
```

Subscribe to everything with `mosquitto_sub -t 'reader/#' -v`.

---

## 3. Payload schema (the envelope)

**Schema version:** `1` (field `schema`). Bump on breaking changes.

Every `event/*` message is JSON with this envelope. Fields are `null` when not
applicable to the current mode/book (always null-check in dashboards).

```jsonc
{
  "schema": 1,
  "event": "reader.page.turned",
  "ts": "2026-06-14T20:04:55.123Z",   // ISO 8601, UTC
  "mode": "read",                      // "read" | "rsvp" | "tts"
  "device": { "id": "dev-a1b2c3d4", "name": "Reader" },
  "book": {
    "id": "pride-and-prejudice:9fa2",
    "title": "Pride and Prejudice",
    "author": "Jane Austen",           // null if unknown
    "format": "epub",                  // "epub" | "pdf" | "cbz" | "cbr" | "sample"
    "totalWords": 122189,
    "totalChapters": 61
  },
  "position": {
    "fraction": 0.3421,                // 0..1 through the book
    "percent": 34.2,                   // fraction * 100, 1dp
    "chapterIndex": 20,
    "chapterTitle": "Chapter 21",
    "page": 122,                       // paginated Reader only; null elsewhere
    "totalPages": 356,                 // null until measured / not paginated
    "wordOrdinal": 41812               // canonical whitespace-word index
  },
  "stats": {
    "sessionWordsRead": 3210,
    "sessionMs": 642000,
    "sessionWpm": 300,
    "wordsRemaining": 78977,
    "etaMinutes": 263                  // null if WPM not yet known
  }
}
```

Per-event bodies may add a few extra fields at the top level (e.g.
`rsvp.wpm.changed` adds `wpm` and `previousWpm`). Those extras are listed in §5.

### Retained `state/*` payloads (compact)
- `state/book`: `{ schema, ts, book{...} }`
- `state/position`: `{ schema, ts, mode, position{...} }`
- `state/stats`: `{ schema, ts, mode, stats{...} }`

---

## 4. Event catalog

Events are **dot-namespaced**. **Canonical (cross-mode)** events fire from more than
one mode; **mode-prefixed** events are specific to one reading mode. Every event is
individually toggleable in the Smart tab (`smart:prefs.events`).

### 4.1 Canonical (any mode)
| Event | When |
|---|---|
| `book.opened` | A book session finishes loading / a different book is opened |
| `book.closed` | Book unloaded (optional; fire on dispose) |
| `book.finished` | Reader reaches the end of the book (last page/word/sentence) |
| `chapter.changed` | The current chapter label changes |
| `reading.started` | Active reading begins (RSVP/TTS play; Reader first page turn of a session) |
| `reading.paused` | Active reading pauses |
| `reading.resumed` | Active reading resumes after a pause |
| `progress.updated` | Throttled periodic progress tick (default ≥ 5 s apart) |
| `mode.changed` | User switches Reader ↔ RSVP ↔ TTS |
| `bookmark.added` | A bookmark is saved |

### 4.2 Reader (paginated) — `mode: "read"`
| Event | When | Extra fields |
|---|---|---|
| `reader.page.turned` | Any page turn | `page`, `totalPages`, `pageWords` (approx words on page) |
| `reader.chapter.entered` | First page of a new chapter | `chapterIndex`, `chapterTitle` |
| `reader.book.finished` | Last page reached | — |

### 4.3 RSVP (speed reader) — `mode: "rsvp"`
| Event | When | Extra fields |
|---|---|---|
| `rsvp.play.started` | Playback starts/resumes | `wpm` |
| `rsvp.play.paused` | Playback pauses | — |
| `rsvp.wpm.changed` | WPM changes | `wpm`, `previousWpm` |
| `rsvp.words.read` | Throttled batch while playing | `wordsInBatch`, `sessionWordsRead` |
| `rsvp.chapter.changed` | Crosses a chapter boundary | `chapterTitle` |
| `rsvp.training.levelUp` | Training mode bumps the speed | `wpm`, `previousWpm` |
| `rsvp.book.finished` | Last word displayed | — |

### 4.4 TTS (text-to-speech) — `mode: "tts"`
| Event | When | Extra fields |
|---|---|---|
| `tts.play.started` | Speech starts/resumes | `voice`, `rate` |
| `tts.paused` | Speech pauses | — |
| `tts.sentence.advanced` | Throttled, as sentences advance | `sentenceIndex` |
| `tts.chapter.changed` | Crosses a chapter boundary | `chapterTitle` |
| `tts.voice.changed` | Voice or rate changes | `voice`, `rate` |
| `tts.book.finished` | Last sentence spoken | — |

---

## 5. Per-mode event mapping (bus event → canonical event)

This is the authoritative wiring table the implementation follows. "Bus event" =
the event already (or newly) emitted on the mode's `EventBus` (`js/core/events.js`).

### Reader (`js/reader-app.js`, `js/reader/*`)
| Source signal | Where (file:hint) | Canonical event |
|---|---|---|
| Book load complete | `loadFromSession()` `reader-app.js:840` | `book.opened` |
| Page turn / progress | `updateProgressFn` `reader-app.js:170` (add `bus.emit('page.turned', {...})`) | `reader.page.turned` + throttled `progress.updated` |
| Chapter label change | compare `chrome.currentChapterLabel()` `chrome.js:244` to last seen | `chapter.changed` / `reader.chapter.entered` |
| Last page reached | pagination at `state.page === state.total-1` | `book.finished` + `reader.book.finished` |
| Bookmark saved | bookmarks panel save handler | `bookmark.added` |

### RSVP (`js/rsvp-app.js`, `js/rsvp/playback.js`)
| Source signal (already emitted) | Location | Canonical event |
|---|---|---|
| `playStart` | `playback.js:20,88,130` | `reading.started` + `rsvp.play.started` |
| `playStop` | `playback.js:69` | `reading.paused` + `rsvp.play.paused` |
| `wordsRead` | `playback.js:59` | accumulate stats; throttled `rsvp.words.read` + `progress.updated` |
| `wpmChanged` | `rsvp-app.js:206`, `input.js:38` | `rsvp.wpm.changed` |
| training bump | `js/rsvp/training.js` (add emit) | `rsvp.training.levelUp` |
| `currentIdx >= total` | `playback.js` advance | `book.finished` + `rsvp.book.finished` |
| chapter crossing | `rsvp-app.js:135` chapter loop | `chapter.changed` + `rsvp.chapter.changed` |

### TTS (`js/tts-app.js`, `js/tts/engine.js`)
| Source signal | Location | Canonical event |
|---|---|---|
| play start/resume | engine play | `reading.started` + `tts.play.started` |
| pause | engine pause | `reading.paused` + `tts.paused` |
| sentence advance | `engine.js` onboundary/next | throttled `progress.updated` + `tts.sentence.advanced` |
| voice/rate change | tts settings apply | `tts.voice.changed` |
| chapter crossing | sentence→chapter map | `chapter.changed` + `tts.chapter.changed` |
| last sentence | engine end | `book.finished` + `tts.book.finished` |

---

## 6. Home Assistant MQTT Discovery (optional, `discovery.js`)

When `haDiscovery` is enabled, publish **retained** config topics so Home Assistant
auto-creates entities — no manual YAML. Publish once on connect.

Discovery topic pattern: `homeassistant/<component>/<node>/<object>/config`.
Group entities under one device via the shared `device` block.

Example — "current book" sensor:
```jsonc
// topic: homeassistant/sensor/reader_dev-a1b2c3d4/book/config   (retained)
{
  "name": "Current Book",
  "unique_id": "reader_dev-a1b2c3d4_book",
  "state_topic": "reader/dev-a1b2c3d4/state/book",
  "value_template": "{{ value_json.book.title }}",
  "json_attributes_topic": "reader/dev-a1b2c3d4/state/book",
  "json_attributes_template": "{{ value_json.book | tojson }}",
  "availability_topic": "reader/dev-a1b2c3d4/status",
  "payload_available": "online",
  "payload_not_available": "offline",
  "icon": "mdi:book-open-page-variant",
  "device": {
    "identifiers": ["reader_dev-a1b2c3d4"],
    "name": "Reader",
    "manufacturer": "Reader PWA",
    "model": "Smart Reader"
  }
}
```

Suggested discovery entities (all reading `state/*` with `value_template`):
- **Current Book** (title) + attributes (author, format, totals).
- **Progress %** — `value_json.position.percent`, `unit_of_measurement: "%"`.
- **Current Chapter** — `value_json.position.chapterTitle`.
- **Reading Speed (WPM)** — `value_json.stats.sessionWpm`, `unit: "wpm"`.
- **Session Time** — derive minutes from `stats.sessionMs`.
- **ETA to Finish (min)** — `value_json.stats.etaMinutes`.
- **Reading** (binary_sensor) — on while `reading.started`/off on `reading.paused`
  (use an MQTT binary_sensor on the status of play, or a template from events).

> To **remove** discovery entities, publish an empty retained payload to the same
> config topic. Do this if the user disables discovery.

---

## 7. Dashboards — recipes

### Grafana (via MQTT datasource / Telegraf → InfluxDB)
- Ingest `event/*` into InfluxDB (Telegraf MQTT consumer, JSON parser). Tag by
  `mode` and `book.title`.
- Panels: **words read per day** (sum of `rsvp.words.read.wordsInBatch` /
  page-turn deltas), **reading time per book**, **WPM over time** (from
  `state/stats`), **books finished** (count of `book.finished`).

### Node-RED
- `mqtt in` on `reader/#` → `json` → `switch` on `msg.payload.event`.
- Automations: on `book.finished` → push a notification / change a light; on
  `reading.started` → set a "Do Not Disturb" scene; on `progress.updated` → update
  a dashboard gauge.

### Home Assistant (without discovery)
```yaml
mqtt:
  sensor:
    - name: "Reading Progress"
      state_topic: "reader/dev-a1b2c3d4/state/position"
      value_template: "{{ value_json.position.percent }}"
      unit_of_measurement: "%"
      json_attributes_topic: "reader/dev-a1b2c3d4/state/position"
```

---

## 8. Quick test recipe

```bash
# 1. Broker with a WS listener (dev)
cat > mosquitto.conf <<'EOF'
listener 1883
listener 9001
protocol websockets
allow_anonymous true
EOF
mosquitto -c mosquitto.conf -v

# 2. Watch all reader traffic
mosquitto_sub -h localhost -t 'reader/#' -v

# 3. Serve the app over localhost (ws:// allowed on localhost)
python3 -m http.server   # http://localhost:8000/reader.html
```
Then enable Smart Home in settings → host `localhost`, port `9001`, path `/mqtt`,
TLS off → Test. Load a book, turn pages, switch modes, reach the end, close the tab
(LWT). Use **MQTT Explorer** to inspect retained `state/*` topics as a tree.

---

## 9. Top debugging gotchas (full table in the plan)

1. **Pointed at port 1883** → browsers can't speak TCP MQTT. Use the **WS** port.
2. **`ws://` on an HTTPS page** → mixed-content block. Use **`wss://`**.
3. **Duplicate clientId** → connect/disconnect flap loop. Keep `clientId` unique.
4. **No `offline` ever** → that's the LWT; it fires only on *ungraceful* drop —
   kill the tab to test.
5. **Dashboard empty after restart** → read **retained `state/*`**, not events.

---

## 10. Privacy

This feature is **opt-in, off by default**. When enabled it publishes what you're
reading (title/author), your position, and timing to the configured broker. Use a
trusted broker, prefer `wss://`, and a dedicated least-privilege MQTT account.
Credentials are stored unencrypted in the browser's localStorage — inherent to a
static client app.
</content>
