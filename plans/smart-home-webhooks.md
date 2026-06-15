# Smart-Home Reading Webhooks — Master Plan (`plans/smart-home-webhooks.md`)

> **What we are building.** A configurable webhook system that fires *rich,
> dashboard-grade* JSON events as you read — new page, new chapter, new book,
> end of book, and many more — so a smart-home hub (Home Assistant, Node-RED,
> IFTTT, ntfy, MQTT-over-HTTP, or any plain HTTP endpoint) can light up
> dashboards with your live reading stats and what you're reading.
>
> Every reading mode (Reader / RSVP / TTS) fires its own event set through one
> shared pipeline, and every payload carries the full picture: book metadata,
> exact position, live pace, this-session stats, and all-time/lifetime stats.

This is the **master plan**: the vision, the architecture, the data model, and
the rationale. The *how-to-build-it* lives in the build sheets under
[`smart-home/`](smart-home/), and the *field reference* for the payloads lives
in [`../docs/EVENT-CATALOG.md`](../docs/EVENT-CATALOG.md) and
[`../docs/WEBHOOKS.md`](../docs/WEBHOOKS.md).

**Start here, then read [`smart-home/00-INDEX-AND-PROCEDURE.md`](smart-home/00-INDEX-AND-PROCEDURE.md).**

---

## 1. Why this fits the app (and why it's easy)

Reader is a **client-side, no-build, vanilla-ES-module** app (see
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)). It already computes
everything a great reading dashboard needs — it just throws most of it away
after rendering:

| We already have… | …in | Webhooks turn it into |
| --- | --- | --- |
| A **canonical position** (section href + word ordinal + fraction) | `js/core/position.js` (`buildPosition`) | `position.*` payload fields, identical across modes |
| A shared, parsed **BookSession** (title, format, sections, toc) | `js/core/book-session.js` | `book.*` payload fields |
| **Live pace** (RSVP wpm, TTS rate, session words/time) | `js/rsvp/stats.js`, mode apps | `pace.*` + `session.*` fields |
| A working **EventBus** | `js/core/events.js` | The in-app fan-out the dispatcher subscribes to |
| **Mode lifecycle** with clean teardown | `js/mode-switcher.js` (AbortController) | Deterministic session start/end events |

The whole feature is **additive**: a new `js/core/` subsystem plus a handful of
one-line emit calls at points each mode already runs. No mode's core logic
changes. No new runtime dependency. Offline still works.

---

## 2. The shape of the system

```
                       ┌─────────────────────────────────────────────┐
  Reading modes        │             js/core (new subsystem)          │
  emit semantic        │                                              │
  events ───────────►  │  ReadingTelemetry  (per-mode façade)         │
                       │     • emit(eventType, modeCtx)               │
  reader-app.js  ──┐   │     • gathers book + position + pace         │
  rsvp-app.js   ───┼─► │            │                                 │
  tts-app.js    ──┘    │            ▼                                 │
                       │  ReadingStats  (session + lifetime, stored)  │
                       │            │                                 │
                       │            ▼                                 │
                       │  buildEventPayload()  (pure, testable)       │
                       │            │                                 │
                       │            ▼                                 │
                       │  WebhookDispatcher                           │
                       │     • per-endpoint event/mode filter         │
                       │     • per-event throttle                     │
                       │     • format adapter (HA / IFTTT / ntfy / …) │
                       │     • offline queue + retry (persisted)      │
                       │            │                                 │
                       └────────────┼─────────────────────────────────┘
                                    ▼
              fetch() / navigator.sendBeacon()  ──►  your hub / endpoint
```

**Six new modules** (all under `js/core/`, all documented in
[`../docs/WEBHOOKS.md`](../docs/WEBHOOKS.md)):

| Module | Responsibility | Pure? |
| --- | --- | --- |
| `js/core/webhook-events.js` | Event-type constants + per-mode matrix | ✅ data only |
| `js/core/reading-stats.js` | Session tracker + lifetime/streak aggregation in `localStorage` | mostly (storage I/O isolated) |
| `js/core/webhook-payload.js` | `buildEventPayload(type, ctx)` → the canonical envelope | ✅ pure |
| `js/core/webhook-formats.js` | Canonical → Home Assistant / IFTTT / ntfy / generic shapes | ✅ pure |
| `js/core/webhook-config.js` | Load/validate/save endpoint config from `localStorage` | mostly |
| `js/core/webhook-dispatcher.js` | Runtime: subscribe, filter, throttle, queue, retry, send | ❌ (network) |
| `js/core/reading-telemetry.js` | Thin per-mode façade the apps call | ❌ (glue) |

Plus a **Settings → Smart Home** tab (`js/settings/settings-screen.js`) to
manage endpoints, pick events, and fire a test event.

---

## 3. The event model (per mode)

Each mode fires the **shared lifecycle/navigation events** plus its own
**mode-specific** events. Full payload field reference is in
[`../docs/EVENT-CATALOG.md`](../docs/EVENT-CATALOG.md); this is the catalogue.

### Shared — every mode
| Event | Fires when |
| --- | --- |
| `book.opened` | A book finishes loading / laying out in a mode |
| `book.finished` | Reading position first reaches the last chapter's end / 100% |
| `chapter.started` | The current chapter index changes |
| `progress.milestone` | Whole-book progress crosses a 5%/10%/25% boundary (configurable) |
| `reading.paused` / `reading.resumed` | Active reading stops/starts (play/pause, blur, idle) |
| `session.started` / `session.ended` | A reading session begins / ends (mode init / teardown / unload) |
| `session.heartbeat` | Periodic "still reading" ping (configurable interval) — powers "Now reading" cards |
| `bookmark.added` | A bookmark is created |
| `goal.reached` | Daily reading goal (words or minutes) is met |

### Reader mode — adds
| Event | Fires when |
| --- | --- |
| `page.turned` | The visible page changes (paginated or windowed) |
| `highlight.added` | A highlight/annotation is committed |

### RSVP mode — adds
| Event | Fires when |
| --- | --- |
| `rsvp.wpm_changed` | WPM changes (manual or auto-training) |
| `rsvp.training_levelup` | Auto-training raises the WPM ceiling |

### TTS mode — adds
| Event | Fires when |
| --- | --- |
| `tts.playback_started` / `tts.playback_paused` | Speech starts/stops |
| `tts.voice_changed` / `tts.rate_changed` | Voice or rate preference changes |

> **Why per-mode sets and not one firehose?** A dashboard that shows "pages read
> tonight" only makes sense in Reader; "current WPM" only in RSVP. Scoping the
> events to the mode keeps each integration honest and keeps payloads cheap.

---

## 4. The rich payload (the "the works")

Every event ships a single canonical envelope (schema `reader.webhook/v1`). The
five blocks that make dashboards great:

- **`book`** — id, title, author, language, format, total words, total chapters.
- **`position`** — chapter index/title, page/total pages (reader), sentence
  index (tts), word ordinal, fraction, **percentComplete**, words remaining.
- **`pace`** — currentWpm (rsvp), sessionAvgWpm, ttsRate,
  **estimatedMinutesRemaining**, **estimatedFinishAt**.
- **`session`** — id, startedAt, durationMs, **activeMs**, wordsRead,
  pagesTurned, chaptersCompleted, modesUsed.
- **`lifetime`** *(opt-in per endpoint)* — wordsReadAllTime, activeMsAllTime,
  booksOpened, **booksFinished**, **currentStreakDays**, longestStreakDays,
  booksInProgress, and **today**'s words/minutes/goal.

Plus `event`, `id`, `idempotencyKey`, `ts` (ISO + epoch), `source` (app,
version, mode), `device` (locale, theme, isPWA, online), and an event-specific
`data` block (e.g. `page.turned.data = { from, to, direction }`).

This is deliberately **more than the basics**: a single `chapter.started` event
is enough to render a "Now reading: *Mistborn* — Chapter 14 (37% · ~2h11m left ·
12-day streak)" card without the hub doing any math.

---

## 5. Delivery formats (presets, not just raw JSON)

`webhook-formats.js` adapts the canonical envelope to whatever the endpoint
speaks, chosen per endpoint:

- **`generic`** — the raw canonical envelope (Node-RED, custom servers).
- **`home-assistant`** — POST to a HA webhook trigger; flattens key fields to
  top-level so HA templates stay short. Ships an example HA automation + Lovelace
  card in [`smart-home/05-presets-and-dashboards.md`](smart-home/05-presets-and-dashboards.md).
- **`ifttt`** — Maker `value1/value2/value3` + a JSON `value3`.
- **`ntfy`** — a human-readable title/body push ("Finished *The Way of Kings* 🎉").
- **`mqtt-http`** — a flat topic/payload pair for an MQTT HTTP bridge.

---

## 6. Hard constraints & guardrails (the short list)

These are expanded in [`../docs/WEBHOOKS.md`](../docs/WEBHOOKS.md) §"Best
practices, reminders & learnings". The build sheets enforce them.

1. **Never block reading.** Emitting an event must be fire-and-forget and must
   never throw into a mode's hot path (page turn, RSVP tick). Wrap every emit in
   the dispatcher's own try/catch; a bad endpoint can't freeze the reader.
2. **No new dependency, offline keeps working.** Sends go through `fetch`/
   `sendBeacon`; failures queue to `localStorage` and retry. The app is fully
   usable with zero endpoints configured (the default).
3. **Throttle the chatty events.** `page.turned` and `session.heartbeat` are
   rate-limited per endpoint (default: page ≤ 1/3s, heartbeat = 60s) so a fast
   reader or RSVP at 800 wpm doesn't DoS a hub.
4. **Word counts stay shared.** Stats read the **same** canonical position and
   `EXTRACTABLE_BLOCK_TYPES` word stream every mode uses
   ([`BEST-PRACTICES.md` §1.4](../docs/BEST-PRACTICES.md)). Never invent a second
   word count.
5. **Privacy is local-first & opt-in.** No endpoints by default; config lives
   only in `localStorage`; `lifetime` block is opt-in per endpoint; a global
   "pause all webhooks" switch exists. Document exactly what each event sends.
6. **Idempotency.** Every event carries an `idempotencyKey` so a retried send
   (offline queue) doesn't double-count on the hub.

---

## 7. The measurable contract

A dashboard owner should be able to build, from these events alone, **without
any computation on the hub side**:

- a live "Now reading" card (title, chapter, % complete, ETA, streak),
- a "pages/words read today" gauge that matches the app's own stats screen,
- a "books finished this year" counter,
- a reading-time heatmap (from `session.heartbeat` / `session.ended`).

Each build sheet states which of these it unlocks and ships a copy-paste
example proving it.

---

## 8. Build order (one phase per branch/PR)

| # | Sheet | Builds | Depends on |
| --- | --- | --- | --- |
| 1 | [`smart-home/01-stats-and-payload-foundation.md`](smart-home/01-stats-and-payload-foundation.md) | `webhook-events`, `reading-stats`, `webhook-payload`, `webhook-formats` (+ unit tests) | baseline |
| 2 | [`smart-home/02-config-and-settings-ui.md`](smart-home/02-config-and-settings-ui.md) | `webhook-config` + Settings → Smart Home tab + test-fire | Phase 1 |
| 3 | [`smart-home/03-dispatcher-queue-retry.md`](smart-home/03-dispatcher-queue-retry.md) | `webhook-dispatcher`, `reading-telemetry`, offline queue, retry | Phases 1–2 |
| 4 | [`smart-home/04-mode-wiring.md`](smart-home/04-mode-wiring.md) | The emit calls in `reader-app.js`, `rsvp-app.js`, `tts-app.js`, `mode-switcher.js` | Phase 3 |
| 5 | [`smart-home/05-presets-and-dashboards.md`](smart-home/05-presets-and-dashboards.md) | HA/IFTTT/ntfy presets + example dashboards | Phase 4 |
| 6 | [`smart-home/06-testing-and-debugging.md`](smart-home/06-testing-and-debugging.md) | Selftest assertions, the debug log, troubleshooting | all |

**Do not start phase N+1 until phase N's `node test/run-selftest.mjs` is green.**

---

## 9. What success looks like

After Phase 5, a reader opens *The Way of Kings* in Reader mode. Their Home
Assistant dashboard immediately shows a "Now reading" card. As they turn pages
the ETA ticks down; entering Chapter 5 flips a smart bulb to a "focus" scene;
finishing the book pushes an ntfy celebration and increments a "books finished
2026" counter — all driven by JSON the app already had in hand.
</content>
