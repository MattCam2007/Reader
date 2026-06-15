# Webhook Event Catalog (`docs/EVENT-CATALOG.md`)

The **contract** between Reader and your dashboards. Every webhook event is one
JSON envelope, schema `reader.webhook/v1`. This file is the field-by-field
reference; the *why/how* is in [`WEBHOOKS.md`](WEBHOOKS.md), the build plan in
[`../plans/smart-home-webhooks.md`](../plans/smart-home-webhooks.md).

> Implementers: the payload builder is `js/core/webhook-payload.js`
> (`buildEventPayload`). **This file and that function must agree field-for-field.**
> When you add a field, update both, plus the privacy list in `WEBHOOKS.md`.

---

## 1. The envelope (every event)

```jsonc
{
  "schema": "reader.webhook/v1",
  "event": "chapter.started",            // see §3 for the full list
  "id": "evt_8f3a1c20",                   // unique per emit
  "idempotencyKey": "BOOKID:chapter.started:14", // stable per logical occurrence
  "ts": "2026-06-15T03:40:47.123Z",       // ISO-8601 UTC
  "tsEpochMs": 1750000847123,             // epoch milliseconds (for time-series DBs)

  "source": {
    "app": "Reader",
    "version": "2026.6",                  // app version / build
    "instanceId": "inst_5b2",             // random per browser profile, stable across sessions
    "mode": "read"                        // "read" | "rsvp" | "tts"
  },

  "device": {
    "locale": "en",
    "theme": "dark",
    "isPWA": true,                        // running as an installed PWA
    "online": true,
    "platform": "Linux"                   // best-effort UA platform
  },

  "book":     { /* §2.1 */ },
  "position": { /* §2.2 */ },
  "pace":     { /* §2.3 */ },
  "session":  { /* §2.4 */ },
  "lifetime": { /* §2.5 — OPT-IN per endpoint; omitted otherwise */ },
  "data":     { /* §3 — event-specific extras */ }
}
```

**Rules**

- Fields that are unknown are **omitted**, never `null`/`undefined` in the JSON.
  (E.g. `book.author` is absent if the EPUB had no author; `position.page` is
  absent in RSVP/TTS.)
- `idempotencyKey` is stable for a logical occurrence so a retried/queued send
  is dedupable on the hub. For chatty events it includes a coarse bucket (page
  number, chapter index, milestone percent) — never a raw timestamp.
- All times are UTC ISO + epoch ms. Per-day stats use the reader's **local**
  date (see §2.5).

---

## 2. Shared blocks

### 2.1 `book`
| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | The app's `bookId` (stable across sessions/modes) |
| `title` | string | From metadata, else filename |
| `author` | string? | EPUB `dc:creator` if present |
| `language` | string? | EPUB `dc:language` if present |
| `format` | string | `"epub"` \| `"pdf"` \| `"sample"` |
| `fileName` | string? | Original file name |
| `totalWords` | number | Mode-agnostic total (the shared word stream) |
| `totalChapters` | number | Section count |
| `isSample` | boolean | The built-in Pride & Prejudice sample |

### 2.2 `position`
| Field | Type | Modes | Notes |
| --- | --- | --- | --- |
| `chapterIndex` | number | all | 0-based |
| `chapterTitle` | string? | all | TOC/heading label |
| `chapterHref` | string? | all | Stable spine href — the cross-mode anchor |
| `wordOrdinal` | number | all | Global word ordinal (the canonical `ord`) |
| `totalWords` | number | all | Mirrors `book.totalWords` |
| `wordsRemaining` | number | all | `totalWords − wordOrdinal` |
| `fraction` | number | all | 0..1 (`pos.f`) |
| `percentComplete` | number | all | `round(fraction * 100)` |
| `chapterPercentComplete` | number | all | Progress within the current chapter |
| `page` | number? | read | 1-based whole-book page (windowed = estimated) |
| `totalPages` | number? | read | Whole-book page count (may be approximate) |
| `pageInChapter` | number? | read | 1-based page within chapter |
| `pagesInChapter` | number? | read | Pages in the current chapter |
| `sentenceIndex` | number? | tts | Current sentence index |
| `totalSentences` | number? | tts | Sentence count |

### 2.3 `pace`
| Field | Type | Modes | Notes |
| --- | --- | --- | --- |
| `currentWpm` | number? | rsvp | The configured/active WPM |
| `sessionAvgWpm` | number? | all | Words read ÷ active minutes this session |
| `ttsRate` | number? | tts | Speech rate multiplier (1 = normal) |
| `estimatedMinutesRemaining` | number? | all | `wordsRemaining ÷ effectiveWpm` (see §2.6) |
| `estimatedFinishAt` | string? | all | ISO time = now + minutes remaining |

### 2.4 `session` (in-memory, resets each mode session)
| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Random per session |
| `startedAt` | string | ISO |
| `durationMs` | number | Wall-clock since session start |
| `activeMs` | number | Time *actually reading* (excludes idle/paused) |
| `wordsRead` | number | Words advanced this session |
| `pagesTurned` | number | Reader only (0 elsewhere) |
| `chaptersCompleted` | number | Chapters fully passed this session |
| `modesUsed` | string[] | e.g. `["read","rsvp"]` if the reader switched modes |
| `longestPauseMs` | number | Longest idle gap |

### 2.5 `lifetime` *(opt-in per endpoint — heavier; off by default)*
| Field | Type | Notes |
| --- | --- | --- |
| `wordsReadAllTime` | number | |
| `activeMsAllTime` | number | |
| `booksOpened` | number | Distinct bookIds ever opened |
| `booksFinished` | number | Reached `book.finished` |
| `booksInProgress` | number | Opened, not finished, has progress |
| `currentStreakDays` | number | Consecutive days with any reading (local date) |
| `longestStreakDays` | number | |
| `lastReadAt` | string | ISO |
| `today` | object | `{ wordsRead, activeMs, goalWords, goalMinutes, goalMet }` |

> **Learning baked in:** streak/“today” use the reader's **local** calendar date
> (`toISOString().slice(0,10)` is UTC — convert first). A UTC day boundary breaks
> streaks for anyone west of GMT reading in the evening. See `reading-stats.js`.

### 2.6 Pace estimation (so dashboards don't have to)
`effectiveWpm` = `currentWpm` (RSVP) → else `sessionAvgWpm` → else a 230 wpm
default (≈ adult silent reading). For TTS, `effectiveWpm ≈ 150 × ttsRate`.
`estimatedMinutesRemaining = round(wordsRemaining / effectiveWpm)`.

---

## 3. The events and their `data`

Mode column: ● fires, — n/a. Throttle = minimum interval enforced per endpoint.

| Event | read | rsvp | tts | Throttle | `data` |
| --- | :-: | :-: | :-: | --- | --- |
| `book.opened` | ● | ● | ● | — | `{ resumedAtPercent }` |
| `book.finished` | ● | ● | ● | once/book/session | `{ activeMsThisBook, sessionsObserved }` |
| `chapter.started` | ● | ● | ● | — | `{ index, title, fromChapter }` |
| `page.turned` | ● | — | — | 3 s | `{ from, to, direction }` |
| `progress.milestone` | ● | ● | ● | per-bucket | `{ percent }` (5/10/25 step, configurable) |
| `reading.paused` | ● | ● | ● | 2 s | `{ reason }` (`"manual"`/`"blur"`/`"idle"`/`"mode-switch"`) |
| `reading.resumed` | ● | ● | ● | 2 s | `{ idleMs }` |
| `session.started` | ● | ● | ● | — | `{ entryMode, resumed }` |
| `session.ended` | ● | ● | ● | — | `{ reason, totalActiveMs }` |
| `session.heartbeat` | ● | ● | ● | 60 s | `{ activeMsSinceLast }` |
| `bookmark.added` | ● | ● | ● | — | `{ color, text }` |
| `highlight.added` | ● | — | — | — | `{ color, text }` |
| `goal.reached` | ● | ● | ● | once/day | `{ goalWords, goalMinutes, wordsToday, minutesToday }` |
| `rsvp.wpm_changed` | — | ● | — | 1 s | `{ from, to, reason }` (`"manual"`/`"training"`) |
| `rsvp.training_levelup` | — | ● | — | — | `{ from, to, ceiling }` |
| `tts.playback_started` | — | — | ● | — | `{ voice, rate }` |
| `tts.playback_paused` | — | — | ● | — | `{ reason }` |
| `tts.voice_changed` | — | — | ● | — | `{ voice, lang, localService }` |
| `tts.rate_changed` | — | — | ● | 1 s | `{ from, to }` |

> The throttle column is the **default**; each value is overridable per endpoint
> in config, and the canonical source is `EVENT_DEFS` in `js/core/webhook-events.js`.

---

## 4. Worked example — `chapter.started` (Reader)

```jsonc
{
  "schema": "reader.webhook/v1",
  "event": "chapter.started",
  "id": "evt_8f3a1c20",
  "idempotencyKey": "the-way-of-kings:chapter.started:14",
  "ts": "2026-06-15T03:40:47.123Z",
  "tsEpochMs": 1750000847123,
  "source": { "app": "Reader", "version": "2026.6", "instanceId": "inst_5b2", "mode": "read" },
  "device": { "locale": "en", "theme": "dark", "isPWA": true, "online": true, "platform": "Linux" },
  "book": {
    "id": "the-way-of-kings:9f2a", "title": "The Way of Kings", "author": "Brandon Sanderson",
    "language": "en", "format": "epub", "totalWords": 387000, "totalChapters": 75, "isSample": false
  },
  "position": {
    "chapterIndex": 14, "chapterTitle": "Chapter 5: The Shattered Plains", "chapterHref": "ch05.xhtml",
    "wordOrdinal": 143190, "totalWords": 387000, "wordsRemaining": 243810,
    "fraction": 0.37, "percentComplete": 37, "chapterPercentComplete": 0,
    "page": 312, "totalPages": 842, "pageInChapter": 1, "pagesInChapter": 23
  },
  "pace": {
    "sessionAvgWpm": 268, "estimatedMinutesRemaining": 131,
    "estimatedFinishAt": "2026-06-15T05:51:47.123Z"
  },
  "session": {
    "id": "sess_a91", "startedAt": "2026-06-15T03:10:00.000Z", "durationMs": 1847123,
    "activeMs": 1790000, "wordsRead": 7995, "pagesTurned": 41, "chaptersCompleted": 2,
    "modesUsed": ["read"], "longestPauseMs": 42000
  },
  "data": { "index": 14, "title": "Chapter 5: The Shattered Plains", "fromChapter": 13 }
}
```

A hub can render, with **zero math**: *“Now reading: The Way of Kings — Chapter 5
(37% · ~2h11m left)”*.
</content>
