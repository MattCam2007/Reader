# Phase 1 — Stats & Payload Foundation (`01-stats-and-payload-foundation.md`)

**Goal.** Build the four data modules that turn reading facts into the canonical
webhook envelope — with **zero** wiring into the modes yet. Everything here is
unit-testable under Node.

**Unlocks (metric):** a deterministic `buildEventPayload()` that, given a
synthetic book + position, produces a complete `book`/`position`/`pace` envelope
matching [`../../docs/EVENT-CATALOG.md`](../../docs/EVENT-CATALOG.md).

**Net-new files:** `js/core/webhook-events.js`, `js/core/reading-stats.js`,
`js/core/webhook-payload.js`, `js/core/webhook-formats.js`.
**Touches:** `js/test/selftest.js` (tests). Optional: EPUB metadata for author/lang.

---

## Step 1 — Read the baseline

- `js/core/position.js` — `buildPosition` returns `{ href, wordInSec, secWords, ord, words, f }`. This is your position source of truth.
- `js/core/book-session.js` — `BookSession` fields (`title`, `bookId`, `format`, `sections`, `toc`, `isSample`).
- `js/core/events.js` — the `EVENTS` constants will be consumed by the dispatcher later.
- `js/rsvp/stats.js` — the existing `StatsTracker` (words/time/avg). We generalise this idea, not replace it.
- `js/core/safe-storage.js` — `safeSetItem`. Use for all writes.

---

## Step 2 — `js/core/webhook-events.js` (pure data)

The single source of truth for event names, which modes fire them, and default
throttles. **No logic, no imports with side effects.**

```js
// Canonical webhook event identifiers. Keep dot.namespaced and stable —
// dashboards key off these strings (see docs/EVENT-CATALOG.md).
export const EVENTS = {
  BOOK_OPENED: 'book.opened',
  BOOK_FINISHED: 'book.finished',
  CHAPTER_STARTED: 'chapter.started',
  PAGE_TURNED: 'page.turned',
  PROGRESS_MILESTONE: 'progress.milestone',
  READING_PAUSED: 'reading.paused',
  READING_RESUMED: 'reading.resumed',
  SESSION_STARTED: 'session.started',
  SESSION_ENDED: 'session.ended',
  SESSION_HEARTBEAT: 'session.heartbeat',
  BOOKMARK_ADDED: 'bookmark.added',
  HIGHLIGHT_ADDED: 'highlight.added',
  GOAL_REACHED: 'goal.reached',
  RSVP_WPM_CHANGED: 'rsvp.wpm_changed',
  RSVP_TRAINING_LEVELUP: 'rsvp.training_levelup',
  TTS_PLAYBACK_STARTED: 'tts.playback_started',
  TTS_PLAYBACK_PAUSED: 'tts.playback_paused',
  TTS_VOICE_CHANGED: 'tts.voice_changed',
  TTS_RATE_CHANGED: 'tts.rate_changed',
};

// Per-event metadata. `modes` = which reading modes may fire it. `throttleMs` =
// default minimum interval per endpoint (0 = unthrottled). Mirror the table in
// docs/EVENT-CATALOG.md §3 exactly.
export const EVENT_DEFS = {
  [EVENTS.BOOK_OPENED]:        { modes: ['read','rsvp','tts'], throttleMs: 0 },
  [EVENTS.BOOK_FINISHED]:      { modes: ['read','rsvp','tts'], throttleMs: 0 },
  [EVENTS.CHAPTER_STARTED]:    { modes: ['read','rsvp','tts'], throttleMs: 0 },
  [EVENTS.PAGE_TURNED]:        { modes: ['read'],              throttleMs: 3000 },
  [EVENTS.PROGRESS_MILESTONE]: { modes: ['read','rsvp','tts'], throttleMs: 0 },
  [EVENTS.READING_PAUSED]:     { modes: ['read','rsvp','tts'], throttleMs: 2000 },
  [EVENTS.READING_RESUMED]:    { modes: ['read','rsvp','tts'], throttleMs: 2000 },
  [EVENTS.SESSION_STARTED]:    { modes: ['read','rsvp','tts'], throttleMs: 0 },
  [EVENTS.SESSION_ENDED]:      { modes: ['read','rsvp','tts'], throttleMs: 0 },
  [EVENTS.SESSION_HEARTBEAT]:  { modes: ['read','rsvp','tts'], throttleMs: 60000 },
  [EVENTS.BOOKMARK_ADDED]:     { modes: ['read','rsvp','tts'], throttleMs: 0 },
  [EVENTS.HIGHLIGHT_ADDED]:    { modes: ['read'],              throttleMs: 0 },
  [EVENTS.GOAL_REACHED]:       { modes: ['read','rsvp','tts'], throttleMs: 0 },
  [EVENTS.RSVP_WPM_CHANGED]:   { modes: ['rsvp'],              throttleMs: 1000 },
  [EVENTS.RSVP_TRAINING_LEVELUP]: { modes: ['rsvp'],           throttleMs: 0 },
  [EVENTS.TTS_PLAYBACK_STARTED]:  { modes: ['tts'],            throttleMs: 0 },
  [EVENTS.TTS_PLAYBACK_PAUSED]:   { modes: ['tts'],            throttleMs: 0 },
  [EVENTS.TTS_VOICE_CHANGED]:     { modes: ['tts'],            throttleMs: 0 },
  [EVENTS.TTS_RATE_CHANGED]:      { modes: ['tts'],            throttleMs: 1000 },
};

export const ALL_EVENTS = Object.values(EVENTS);

export function eventsForMode(mode) {
  return ALL_EVENTS.filter(e => EVENT_DEFS[e].modes.includes(mode));
}

// Default milestone boundaries (percent). Endpoints may override the step.
export const DEFAULT_MILESTONE_STEP = 10;
```

---

## Step 3 — `js/core/reading-stats.js` (session tracker + lifetime, IO at edges)

Two responsibilities, deliberately separated:

1. **`ReadingStats`** — an in-memory session tracker (one per mode session).
   It mirrors what `js/rsvp/stats.js` does (words + active time) but is
   mode-agnostic and also tracks pages/chapters and idle.
2. **Lifetime aggregation** — pure reducer + `localStorage` load/save.

Pure helpers to export (testable):

```js
// Local calendar date 'YYYY-MM-DD' — NOT toISOString (UTC). See WEBHOOKS.md §4.5.
export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 230 wpm = adult silent-reading default when no live pace is known.
const DEFAULT_WPM = 230;
export function effectiveWpm({ currentWpm, sessionAvgWpm, ttsRate }) {
  if (ttsRate) return Math.max(60, Math.round(150 * ttsRate));
  if (currentWpm) return currentWpm;
  if (sessionAvgWpm) return sessionAvgWpm;
  return DEFAULT_WPM;
}
export function estimateMinutesRemaining(wordsRemaining, pace) {
  const wpm = effectiveWpm(pace);
  return wpm > 0 ? Math.round(wordsRemaining / wpm) : null;
}

// Pure reducer: fold a day's reading into the lifetime object. Bounds the
// per-day map to MAX_DAYS and recomputes the streak from the day set.
export function applyDailyReading(lifetime, { dateKey, words, ms }) { /* … */ }
export function computeStreakDays(dayKeys, todayKey) { /* consecutive run ending today/yesterday */ }
```

`ReadingStats` class shape:

```js
export class ReadingStats {
  constructor({ mode }) {
    this.mode = mode;
    this.sessionId = 'sess_' + Math.random().toString(36).slice(2, 8);
    this.startedAt = Date.now();
    this.wordsRead = 0;
    this.pagesTurned = 0;
    this.chaptersCompleted = 0;
    this.activeMs = 0;
    this.modesUsed = [mode];
    this._lastActiveTick = Date.now();
    this._lastWordOrdinal = null;
    this._idleSince = null;
    this.longestPauseMs = 0;
  }
  // Call on any reading advance. Derives words read from the change in ordinal
  // so it never depends on a mode-specific tick. Accrues active time unless idle.
  observe({ wordOrdinal, page, chapterIndex }, now = Date.now()) { /* … */ }
  markPaused(now = Date.now()) { /* freeze active time, start idle clock */ }
  markResumed(now = Date.now()) { /* … return idleMs */ }
  snapshotSession(now = Date.now()) {
    return {
      id: this.sessionId,
      startedAt: new Date(this.startedAt).toISOString(),
      durationMs: now - this.startedAt,
      activeMs: this.activeMs,
      wordsRead: this.wordsRead,
      pagesTurned: this.pagesTurned,
      chaptersCompleted: this.chaptersCompleted,
      modesUsed: this.modesUsed.slice(),
      longestPauseMs: this.longestPauseMs,
    };
  }
}

// Lifetime IO (try/catch, safeSetItem). Returns DEFAULT_LIFETIME on any error.
export function loadLifetime() { /* JSON.parse(localStorage['stats:lifetime']) */ }
export function saveLifetime(obj) { /* safeSetItem('stats:lifetime', JSON.stringify(obj)) */ }
export function loadBookStats(bookId) { /* 'stats:book:'+bookId */ }
export function saveBookStats(bookId, obj) { /* … */ }
```

> **Important — deriving words read.** `observe()` computes `Δwords =
> max(0, wordOrdinal − _lastWordOrdinal)` and adds it to `wordsRead`. This is the
> one true measure across all three modes (a backward seek contributes 0, not a
> negative). Do **not** sum RSVP chunk counts or TTS sentence lengths separately.

---

## Step 4 — `js/core/webhook-payload.js` (pure)

```js
import { localDateKey, estimateMinutesRemaining } from './reading-stats.js';

// ctx = { mode, source, device, book, position, pace, session, lifetime?, data? }
// Each block is already-shaped plain data assembled by ReadingTelemetry; this
// function adds derived fields, the envelope wrapper, ids, and timestamps.
// `now` and `idFn` are injected so tests are deterministic.
export function buildEventPayload(type, ctx, { now = Date.now(), idFn } = {}) {
  const id = (idFn || defaultIdFn)();
  const ts = new Date(now).toISOString();
  const position = withDerivedPosition(ctx.position, ctx.book);   // wordsRemaining, percentComplete
  const pace = withDerivedPace(ctx.pace, position, now);          // estMinutesRemaining, estFinishAt
  const env = {
    schema: 'reader.webhook/v1',
    event: type,
    id,
    idempotencyKey: makeIdemKey(type, ctx),
    ts,
    tsEpochMs: now,
    source: ctx.source,
    device: ctx.device,
    book: prune(ctx.book),
    position: prune(position),
    pace: prune(pace),
    session: ctx.session,
  };
  if (ctx.lifetime) env.lifetime = ctx.lifetime;
  if (ctx.data && Object.keys(ctx.data).length) env.data = prune(ctx.data);
  return env;
}

// Stable per logical-occurrence; coarse bucket, never a timestamp. See §4.4.
export function makeIdemKey(type, ctx) {
  const b = ctx.book?.id || 'unknown';
  const p = ctx.position || {};
  switch (type) {
    case 'page.turned':        return `${b}:${type}:${p.page ?? p.wordOrdinal}`;
    case 'chapter.started':    return `${b}:${type}:${p.chapterIndex}`;
    case 'progress.milestone': return `${b}:${type}:${ctx.data?.percent}`;
    case 'book.finished':      return `${b}:${type}`;
    default:                   return `${b}:${type}:${ctx.session?.id}:${p.wordOrdinal ?? 0}`;
  }
}

// Omit undefined/null so JSON never carries them (EVENT-CATALOG rule).
function prune(obj) { /* shallow copy dropping null/undefined */ }
```

`withDerivedPosition` fills `wordsRemaining`, `fraction`→`percentComplete`;
`withDerivedPace` calls `estimateMinutesRemaining` and computes `estimatedFinishAt
= new Date(now + minutes*60000).toISOString()`.

---

## Step 5 — `js/core/webhook-formats.js` (pure)

```js
export const FORMATS = ['generic', 'home-assistant', 'ifttt', 'ntfy', 'mqtt-http'];

// Canonical envelope -> { url?, headers?, body }. `url`/`headers` returned only
// when the format overrides the endpoint's own (e.g. ntfy uses header-based
// title). The dispatcher merges these over the endpoint config.
export function formatPayload(format, env) {
  switch (format) {
    case 'home-assistant': return { body: flattenForHA(env) };
    case 'ifttt':          return { body: { value1: env.book?.title, value2: env.event, value3: JSON.stringify(env) } };
    case 'ntfy':           return { headers: { Title: ntfyTitle(env) }, body: ntfyBody(env), raw: true };
    case 'mqtt-http':      return { body: { topic: `reader/${env.source.mode}/${env.event}`, payload: env } };
    case 'generic':
    default:               return { body: env };
  }
}
```

`flattenForHA` lifts the most-used fields to top level so HA templates are short:
`{ event, title, author, chapter, percent, minutes_remaining, current_wpm,
words_today, streak_days, ...env }`. `ntfyTitle/Body` produce human strings, e.g.
`"📖 Finished The Way of Kings"` / `"387,000 words · 12-day streak"`.

---

## Step 6 — Unit tests (`js/test/selftest.js`)

Add imports **after** creating the files, then an assert block. Examples:

```js
import { EVENTS, EVENT_DEFS, eventsForMode } from '../core/webhook-events.js';
import { localDateKey, estimateMinutesRemaining, computeStreakDays } from '../core/reading-stats.js';
import { buildEventPayload, makeIdemKey } from '../core/webhook-payload.js';
import { formatPayload } from '../core/webhook-formats.js';

// --- webhook-events ---
assert('webhooks', 'every EVENT_DEFS key is a known event',
  Object.keys(EVENT_DEFS).every(e => Object.values(EVENTS).includes(e)));
assert('webhooks', 'page.turned is reader-only', !eventsForMode('rsvp').includes(EVENTS.PAGE_TURNED));

// --- reading-stats ---
assert('webhooks', 'localDateKey is YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(localDateKey(new Date(2026,5,15))));
assert('webhooks', 'ETA from wordsRemaining',
  estimateMinutesRemaining(2300, { currentWpm: 230 }) === 10);
assert('webhooks', 'streak counts consecutive days',
  computeStreakDays(['2026-06-13','2026-06-14','2026-06-15'], '2026-06-15') === 3);
assert('webhooks', 'streak breaks on a gap',
  computeStreakDays(['2026-06-10','2026-06-15'], '2026-06-15') === 1);

// --- webhook-payload ---
const env = buildEventPayload(EVENTS.CHAPTER_STARTED, {
  mode:'read', source:{app:'Reader',version:'t',mode:'read'}, device:{},
  book:{ id:'b1', title:'T', totalWords:1000, totalChapters:10 },
  position:{ chapterIndex:3, wordOrdinal:370, fraction:0.37 },
  pace:{ sessionAvgWpm:230 }, session:{ id:'s1' }, data:{ index:3 },
}, { now: 0, idFn: () => 'evt_x' });
assert('webhooks', 'envelope schema/version', env.schema === 'reader.webhook/v1' && env.event === 'chapter.started');
assert('webhooks', 'position derives wordsRemaining', env.position.wordsRemaining === 630);
assert('webhooks', 'position derives percentComplete', env.position.percentComplete === 37);
assert('webhooks', 'pace derives ETA minutes', env.pace.estimatedMinutesRemaining === 3); // 630/230≈2.7→3
assert('webhooks', 'idemKey stable for chapter', makeIdemKey(EVENTS.CHAPTER_STARTED, { book:{id:'b1'}, position:{chapterIndex:3} }) === 'b1:chapter.started:3');
assert('webhooks', 'no null leaks into JSON', JSON.stringify(env).indexOf('null') === -1);

// --- webhook-formats ---
assert('webhooks', 'generic returns envelope', formatPayload('generic', env).body === env);
assert('webhooks', 'HA flattens title', formatPayload('home-assistant', env).body.title === 'T');
```

Run `node test/run-selftest.mjs` → all green before moving on.

---

## Step 7 — (Optional but recommended) author/language metadata

`book.author`/`book.language` need EPUB `dc:creator`/`dc:language`. Check
`js/formats/epub/` for where `metaTitle` is parsed and carry `metaAuthor`/
`metaLanguage` onto the `BookSession` the same way. If you skip this, the fields
are simply omitted — payloads stay valid. Do **not** block Phase 1 on it.

---

## Definition of done

- [ ] Four files created, no DOM/network at import time.
- [ ] All Step 6 assertions green under Node.
- [ ] `JSON.stringify(env)` never contains `null`/`undefined`.
- [ ] Pace, wordsRemaining, percentComplete, streak all derived and correct.
- [ ] Committed on its own branch; suite green.
</content>
