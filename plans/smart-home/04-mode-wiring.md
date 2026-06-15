# Phase 4 — Mode Wiring (`04-mode-wiring.md`)

**Goal.** Make the three modes emit their events through `ReadingTelemetry`. This
is the only phase that edits the mode apps, and every edit is **one line at a
point the mode already runs**. No reading logic changes.

**Unlocks (metric):** opening, paging, changing chapters, and finishing the
sample book each deliver the right event with the right `mode`, verified live.

**Touches:** `js/mode-switcher.js`, `js/reader-app.js`, `js/rsvp-app.js`,
`js/tts-app.js`. **No net-new files.**

---

## Step 0 — Wire the app-level dispatcher in `mode-switcher.js`

The dispatcher and `sourceMeta` are created **once** and shared across mode
switches, so throttle state and the offline queue persist within a session.

```js
// mode-switcher.js — module scope
import { WebhookDispatcher } from './core/webhook-dispatcher.js';
import { getInstanceId } from './core/reading-stats.js';   // random, stored, stable

const webhookController = new AbortController();
const dispatcher = new WebhookDispatcher({ signal: webhookController.signal });
const sourceMeta = { app: 'Reader', version: APP_VERSION, instanceId: getInstanceId() };
```

Pass them into every `mod.init({...})` call (all three branches):

```js
currentHandle = mod.init({
  signal,
  onModeSwitch: (mode, info) => switchMode(mode, info),
  onBookLoaded,
  webhooks: { dispatcher, sourceMeta },   // ← add this
});
```

> `APP_VERSION` can be a constant in `constants.js` (e.g. derived from a date
> string). If you don't have one, hard-code `'2026.6'` and note it for later.

Each app, at the top of `init()`:

```js
import { createTelemetry } from './core/reading-telemetry.js';
// …
const wh = options.webhooks;
const telemetry = wh ? createTelemetry({
  modeAdapter: { mode: '<read|rsvp|tts>', snapshot: buildSnapshot },
  dispatcher: wh.dispatcher,
  sourceMeta: wh.sourceMeta,
}) : { emit(){}, markPaused(){}, markResumed(){}, endSession(){} };  // null-object: zero config = no-op
```

The **null-object fallback** means every `telemetry.emit(...)` below is safe even
when webhooks aren't wired (tests, future refactors). This honours
[`WEBHOOKS.md` §4.1](../../docs/WEBHOOKS.md).

---

## Step 1 — Reader (`js/reader-app.js`)

### 1a. `buildSnapshot()` — the mode adapter
Add near the other canonical-position helpers (after `getCanonicalPosition`):

```js
function buildSnapshot() {
  const pos = state.doc.words.length ? getCanonicalPosition() : null;
  const chapterIndex = state.windowed ? state.curChap
    : (chrome ? chrome.currentChapterIndex?.() ?? 0 : 0);
  const chapterTitle = state.windowed
    ? (state.sectionLabels?.[state.curChap] || '')
    : (chrome ? chrome.currentChapterLabel() : '');
  return {
    book: bookSnapshot(),                         // shared helper, see Step 4
    position: pos ? {
      chapterIndex, chapterTitle,
      chapterHref: pos.href,
      wordOrdinal: pos.ord, totalWords: pos.words, fraction: pos.f,
      page: state.windowed ? undefined : state.page + 1,
      totalPages: state.windowed ? undefined : state.total,
      pageInChapter: state.windowed ? state.page + 1 : undefined,
      pagesInChapter: state.windowed ? state.total : undefined,
    } : null,
    pace: { sessionAvgWpm: telemetry.stats.sessionAvgWpm?.() },
  };
}
```

### 1b. Emit points
| Event | Where | One-liner |
| --- | --- | --- |
| `book.opened` | `loadFromSession`, right after `clearOverlay()` succeeds | `telemetry.emit('book.opened', { resumedAtPercent: Math.round((getCanonicalPosition()?.f||0)*100) });` |
| `page.turned` | `updateProgressFn()` — the funnel every turn hits | guard with a `_lastPage` compare (below) |
| `chapter.started` | `updateProgressFn()` | guard with a `_lastChap` compare |
| `book.finished` | `updateProgressFn()` when `getCanonicalPosition().f >= 0.999` (once) | `if (!state._finishedEmitted) { state._finishedEmitted = true; telemetry.emit('book.finished', {}); }` |
| `highlight.added` | `selection.onHighlight` callback / `highlights.createFromSelection` | `telemetry.emit('highlight.added', { color });` |
| `bookmark.added` | quick-bm add + panel add paths | `telemetry.emit('bookmark.added', { color: ctx.color||'', text: ctx.text });` |

Page/chapter guard inside `updateProgressFn` (after the existing body):

```js
const snapPage = state.windowed ? `${state.curChap}:${state.page}` : state.page;
if (snapPage !== state._lastEmitPage) {
  const dir = (state._lastEmitPageNum ?? -1) <= state.page ? 'next' : 'prev';
  telemetry.emit('page.turned', { from: state._lastEmitPageNum ?? null, to: state.page, direction: dir });
  state._lastEmitPage = snapPage; state._lastEmitPageNum = state.page;
}
if (state.curChap !== state._lastEmitChap) {
  telemetry.emit('chapter.started', { index: state.curChap, fromChapter: state._lastEmitChap ?? null });
  state._lastEmitChap = state.curChap;
}
```

> **Why `updateProgressFn`?** It's already the single function every navigation
> path calls after a page/chapter change ([`reader-app.js`](../../js/reader-app.js)
> wires it into `PaginationEngine`). Emitting here covers swipes, taps, TOC jumps,
> search hits, and bookmark navigation with one edit. The dedupe guards stop a
> relayout (which also calls it) from re-firing.

### 1c. paused/resumed + session
At the end of `init`, add a small visibility/idle watcher (shared helper —
Step 4) and emit `reading.paused`/`reading.resumed`. In `teardown()`, call
`telemetry.endSession('teardown')`.

`session.started` fires once from the façade on first `emit` (or call
`telemetry.emit('session.started', { entryMode:'read', resumed:false })` right
after `book.opened`).

---

## Step 2 — RSVP (`js/rsvp-app.js`)

RSVP already has an `EventBus` with exactly the hooks we need. Add listeners in
the **Bus wiring** block (near the existing `bus.on('playStart', …)`).

### 2a. `buildSnapshot()`
```js
function buildSnapshot() {
  const pos = state.totalWords ? getCanonicalPosition() : null;
  let chapterIndex = 0, chapterTitle = '';
  for (let i = state.chapters.length - 1; i >= 0; i--) {
    if (state.chapters[i].tokenIdx <= state.currentIdx) { chapterIndex = i; chapterTitle = state.chapters[i].title; break; }
  }
  return {
    book: bookSnapshot(),
    position: pos ? { chapterIndex, chapterTitle, chapterHref: pos.href,
      wordOrdinal: pos.ord, totalWords: pos.words, fraction: pos.f } : null,
    pace: { currentWpm: prefs.data.wpm, sessionAvgWpm: stats.avgWpm?.() },
  };
}
```

### 2b. Emit points (all in the bus-wiring block)
```js
bus.on('playStart', () => { telemetry.markResumed(); telemetry.emit('reading.resumed', {}); });
bus.on('playStop',  () => { telemetry.markPaused();  telemetry.emit('reading.paused', { reason:'manual' }); });

// wordsRead already fires per chunk. Use it to advance stats + a chapter/heartbeat check.
bus.on('wordsRead', (count) => {
  maybeEmitChapterChange();     // compares current chapter index to state._lastEmitChap
  telemetry.maybeHeartbeat();   // façade throttles to 60s; emits session.heartbeat
  maybeEmitMilestone();         // crosses a milestoneStep boundary → progress.milestone
});

bus.on('wpmChanged', (val) => {
  telemetry.emit('rsvp.wpm_changed', { from: state._lastEmitWpm ?? null, to: val,
    reason: training.lastChangeWasTraining ? 'training' : 'manual' });
  state._lastEmitWpm = val;
});
```

`book.opened` → in `loadFromSession` after `if (onBookLoaded) onBookLoaded(...)`.
`book.finished` → in `playback` end-of-stream (where it stops at the last token)
or in the `wordsRead` handler when `pos.f >= 0.999` (once). Training level-up →
inside the existing `training.onWordsRead` success branch in the `wordsRead`
handler, emit `rsvp.training_levelup`. `bookmark.added` → in the
`getRsvpBookmarkContext` add path.

> The chapter/milestone/heartbeat checks are tiny pure helpers in the app that
> compare against `state._lastEmit*` fields — same dedupe pattern as Reader.

---

## Step 3 — TTS (`js/tts-app.js`)

### 3a. `buildSnapshot()`
```js
function buildSnapshot() {
  const pos = (sentences.length && totalWords) ? getCanonicalPosition() : null;
  const sent = sentences[currentSentenceIdx] || sentences[0];
  let chapterIndex = 0, chapterTitle = '';
  // reuse the headingToc walk from getTtsBookmarkContext to find the chapter label
  // (factor it into a helper currentChapter() returning { index, title }).
  const ch = currentChapter();
  if (ch) { chapterIndex = ch.index; chapterTitle = ch.title; }
  return {
    book: bookSnapshot(),
    position: pos ? { chapterIndex, chapterTitle, chapterHref: pos.href,
      wordOrdinal: pos.ord, totalWords: pos.words, fraction: pos.f,
      sentenceIndex: currentSentenceIdx, totalSentences: sentences.length } : null,
    pace: { ttsRate: prefs.data.rate },
  };
}
```

### 3b. Emit points
| Event | Where |
| --- | --- |
| `book.opened` | `loadFromSession` after `if (onBookLoaded) onBookLoaded(...)` |
| `tts.playback_started` + `reading.resumed` | inside `play()` after `setPlaying(true)` |
| `tts.playback_paused` + `reading.paused` | inside `pause()` after `setPlaying(false)` |
| `chapter.started` / `progress.milestone` / heartbeat | in the engine `onSentenceStart(index)` callback — compare chapter index to `_lastEmitChap`, call `telemetry.maybeHeartbeat()` |
| `book.finished` | engine `onEnd()` if `currentSentenceIdx >= sentences.length - 1` (once) |
| `tts.voice_changed` | in the voice-list click handler after `engine.setVoice(voice)` → `telemetry.emit('tts.voice_changed', { voice: voice.name, lang: voice.lang, localService: voice.localService })` |
| `tts.rate_changed` | in the `ttsRateSeg` click handler after `engine.setRate(rate)` |
| `bookmark.added` | TTS bookmark add path |
| `session.ended` | `teardown()` → `telemetry.endSession('teardown')` |

> The engine fires `onSentenceStart` for every sentence — do **not** emit a raw
> event there. Only emit `chapter.started`/milestone on a *change*, and let the
> façade throttle the heartbeat. This keeps a fast voice from flooding.

---

## Step 4 — Shared helpers to add (avoid copy-paste drift)

Two tiny helpers, defined once and reused by all three `buildSnapshot()`s.
Put `bookSnapshot()` in each app (it reads that app's `session`/`bookId`), but
keep the **field set identical** — copy this exactly:

```js
function bookSnapshot() {
  const s = currentSession;     // the BookSession the mode loaded (capture it in loadFromSession)
  if (!s) return { id: state.bookId || bookId, title: '', totalWords: totalWordsForMode(), totalChapters: 0 };
  return {
    id: s.bookId, title: s.title || s.bookId,
    author: s.author || undefined, language: s.language || undefined,
    format: s.format || 'epub', fileName: s.fileName || undefined,
    totalWords: totalWordsForMode(), totalChapters: (s.sections||[]).length,
    isSample: !!s.isSample,
  };
}
```

Capture `currentSession` in each `loadFromSession(session, pos)` (`currentSession
= session;`). `totalWordsForMode()` returns `state.doc.wsToToken.length` (reader),
`state.totalWords` (rsvp), or `totalWords` (tts).

For paused/resumed via visibility + idle, add this once per app near init:

```js
let _idleTimer = null;
function bumpActivity() {
  telemetry.markResumed();
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => telemetry.emit('reading.paused', { reason:'idle' }), 120000);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) telemetry.emit('reading.paused', { reason:'blur' });
  else bumpActivity();
}, { signal });
window.addEventListener('pagehide', () => telemetry.endSession('unload'), { signal });  // sendBeacon path
```

(For Reader/RSVP, also call `bumpActivity()` on a page turn / word advance. For
TTS, playback start IS the activity signal — no idle timer while speaking.)

---

## Step 5 — Tests

In `runLiveTests` (Reader runs with a real layout):

```js
// Install a sink BEFORE the events are emitted (see 06-testing-and-debugging.md).
const sink = window.__webhookSink = { events: [], push(e){ this.events.push(e); } };
// drive the live reader closures via hooks:
hooks.seekToToken(hooks.state.doc.sections[2].wordStart);   // forces chapter.started
await raf();
assert('webhooks', 'chapter.started fired with index',
  sink.events.some(e => e.event === 'chapter.started' && e.position.chapterIndex === 2));
assert('webhooks', 'reader events carry mode=read',
  sink.events.every(e => e.source.mode === 'read'));
assert('webhooks', 'page.turned has from/to/direction',
  sink.events.filter(e=>e.event==='page.turned').every(e => 'direction' in e.data));
```

The sink is wired by configuring a single endpoint whose `url` the test
dispatcher recognises as `__sink__` (the dispatcher, in test mode, pushes to
`window.__webhookSink` instead of `fetch`). See
[`06-testing-and-debugging.md`](06-testing-and-debugging.md) §2.

---

## Definition of done

- [ ] Each mode creates `telemetry`; null-object when webhooks absent.
- [ ] `book.opened`, `page.turned`/`chapter.started` (reader), play/pause +
      voice/rate (tts), wpm (rsvp), `book.finished`, `bookmark.added` all fire
      at the listed points, deduped.
- [ ] Every payload's `source.mode` matches the emitting mode.
- [ ] No mode's reading behaviour changed (existing selftests still green).
- [ ] Live event assertions green.
</content>
