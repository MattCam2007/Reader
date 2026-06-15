# Phase 5 — Presets & Dashboards (`05-presets-and-dashboards.md`)

**Goal.** Finish the format adapters in `webhook-formats.js` and ship
copy-paste recipes that prove a real dashboard works end-to-end. This is where
"amazing dashboards with my reading stats" becomes concrete.

**Unlocks (metric):** a Home Assistant "Now reading" card, an ntfy phone push on
`book.finished`, and an IFTTT applet — each driven only by the events from
Phase 4, with no math on the hub side.

**Touches:** `js/core/webhook-formats.js` (flesh out the adapters), `README.md`
(feature blurb + docs row). All examples also land in this sheet.

---

## Step 1 — Finish `webhook-formats.js`

### Home Assistant (`home-assistant`)
HA webhook triggers expose the POST body as `trigger.json`. Flatten the
hot fields to the top level so templates stay short:

```js
function flattenForHA(env) {
  const p = env.position || {}, pace = env.pace || {}, life = env.lifetime || {}, b = env.book || {};
  return {
    event: env.event,
    mode: env.source.mode,
    title: b.title, author: b.author, format: b.format,
    chapter_index: p.chapterIndex, chapter: p.chapterTitle,
    percent: p.percentComplete, words_remaining: p.wordsRemaining,
    page: p.page, total_pages: p.totalPages,
    current_wpm: pace.currentWpm, avg_wpm: pace.sessionAvgWpm,
    minutes_remaining: pace.estimatedMinutesRemaining, finish_at: pace.estimatedFinishAt,
    words_today: life.today?.wordsRead, streak_days: life.currentStreakDays,
    books_finished: life.booksFinished,
    raw: env,                          // full envelope still available as trigger.json.raw
  };
}
```

### ntfy (`ntfy`)
Human-readable push. ntfy reads the title from the `Title` header and the body
as plain text (`raw: true` tells the dispatcher to send text, not JSON):

```js
function ntfyTitle(env) {
  const b = env.book || {};
  switch (env.event) {
    case 'book.finished': return `🎉 Finished ${b.title}`;
    case 'chapter.started': return `📖 ${b.title}`;
    case 'goal.reached': return `✅ Reading goal met`;
    default: return `📚 ${b.title || 'Reading'}`;
  }
}
function ntfyBody(env) {
  const p = env.position || {}, pace = env.pace || {}, life = env.lifetime || {};
  if (env.event === 'book.finished') return `${(env.book?.totalWords||0).toLocaleString()} words read.`;
  if (env.event === 'goal.reached') return `${life.today?.wordsRead?.toLocaleString()} words today · ${life.currentStreakDays}-day streak`;
  const eta = pace.estimatedMinutesRemaining != null ? ` · ~${pace.estimatedMinutesRemaining}m left` : '';
  return `${p.chapterTitle || 'Chapter ' + ((p.chapterIndex||0)+1)} · ${p.percentComplete||0}%${eta}`;
}
```

### IFTTT (`ifttt`) and MQTT-HTTP (`mqtt-http`)
As stubbed in Phase 1 §5. For MQTT-HTTP, the body is `{ topic, payload }`; a
user's bridge maps it to their broker. Keep topics stable:
`reader/<mode>/<event>`.

---

## Step 2 — Home Assistant recipe (ships in README/docs)

**1. Create a webhook trigger automation:**

```yaml
# configuration.yaml (or via the Automations UI → trigger: Webhook)
automation:
  - alias: "Reader — update Now Reading"
    trigger:
      - platform: webhook
        webhook_id: reader            # endpoint URL: https://<ha>/api/webhook/reader
        allowed_methods: [POST]
        local_only: true
    action:
      - service: input_text.set_value
        target: { entity_id: input_text.now_reading_title }
        data: { value: "{{ trigger.json.title }}" }
      - service: input_number.set_value
        target: { entity_id: input_number.reading_percent }
        data: { value: "{{ trigger.json.percent | int(0) }}" }
      - choose:
          - conditions: "{{ trigger.json.event == 'chapter.started' }}"
            sequence:
              - service: scene.turn_on
                target: { entity_id: scene.reading_focus }
          - conditions: "{{ trigger.json.event == 'book.finished' }}"
            sequence:
              - service: notify.mobile_app
                data:
                  title: "Finished a book 🎉"
                  message: "{{ trigger.json.title }} — {{ trigger.json.raw.book.total_words }} words"
```

**2. Helpers:** `input_text.now_reading_title`, `input_number.reading_percent`,
`input_text.now_reading_chapter`, plus a `template` sensor for ETA:

```yaml
template:
  - sensor:
      - name: "Reading ETA"
        state: "{{ states('input_number.reading_minutes_remaining') | int(0) }}"
        unit_of_measurement: "min"
```

**3. Lovelace "Now Reading" card:**

```yaml
type: vertical-stack
cards:
  - type: markdown
    content: >
      ## 📖 {{ states('input_text.now_reading_title') }}
      **{{ states('input_text.now_reading_chapter') }}** ·
      {{ states('input_number.reading_percent') }}% ·
      ~{{ states('sensor.reading_eta') }} min left
  - type: gauge
    entity: input_number.reading_percent
    min: 0
    max: 100
    name: Progress
```

**In Reader:** add an endpoint — Name "Home Assistant", URL
`https://<your-ha>/api/webhook/reader`, Format **home-assistant**, Events:
`book.opened, chapter.started, page.turned, progress.milestone, book.finished`,
`includeLifetime` on (for the streak/today fields), throttle `page.turned` to 5s.

> **CORS note:** HA's webhook endpoint accepts cross-origin POSTs; if you proxy
> it, ensure the proxy returns `Access-Control-Allow-Origin`. The Reader **Test**
> button will tell you immediately if it's blocked
> ([`WEBHOOKS.md` §4.9](../../docs/WEBHOOKS.md)).

---

## Step 3 — ntfy phone-push recipe

1. Install ntfy, pick a topic, e.g. `https://ntfy.sh/my-reading-12345`.
2. In Reader: add endpoint — Format **ntfy**, URL = the topic URL, Events:
   `book.finished, goal.reached` (low-volume, celebratory). No headers needed
   for a public topic; for a private one add `Authorization: Bearer <token>`.
3. Finish a book → 🎉 push. Hit your daily goal → ✅ push.

---

## Step 4 — Node-RED / generic recipe

Format **generic** posts the full canonical envelope. A Node-RED `http in` node
at `/reader` → `switch` on `msg.payload.event` → branch per event. The whole
[`EVENT-CATALOG.md`](../../docs/EVENT-CATALOG.md) is your field map. Great for a
Grafana/InfluxDB time-series: write `tsEpochMs`, `position.percentComplete`,
`pace.sessionAvgWpm`, `session.activeMs` to build reading-time and pace charts.

---

## Step 5 — README + docs

- Add a **Smart Home / Webhooks** section to `README.md`: one paragraph + a link
  to `docs/WEBHOOKS.md` and `docs/EVENT-CATALOG.md`, and a row in the docs table.
- Confirm the recipes above are mirrored (or linked) from `docs/WEBHOOKS.md` so a
  user setting this up doesn't need to read the plan.

---

## Definition of done

- [ ] All five formats produce valid bodies (unit-tested in Phase 1, extended here).
- [ ] HA recipe verified against a real/HA-demo instance (card updates live).
- [ ] ntfy `book.finished`/`goal.reached` pushes verified on a phone.
- [ ] README + docs updated; recipes copy-paste runnable.
</content>
