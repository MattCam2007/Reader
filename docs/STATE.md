# State & Storage

This document covers everything about how state is managed in Reader: in-memory data structures, the preference system, localStorage persistence, the position locator system, and the EventBus pattern.

---

## Overview

Reader has no global state store. State is owned by the module that manages it and shared via explicit references or the EventBus. There are four categories of state:

| Category | Owner | Lifetime | Persistence |
|----------|-------|----------|-------------|
| **Preferences** | `PrefsManager` instances | App session | `localStorage` |
| **Reader layout state** | `ReaderState` | Book session | `localStorage` (position) |
| **RSVP playback state** | `RsvpState` | Book session | `localStorage` (position) |
| **Mode orchestration** | `mode-switcher.js` variables | App session | URL params |

---

## PrefsManager

`js/core/prefs.js` — extends `EventBus`

Each reading mode creates its own `PrefsManager` instance with a distinct `storageKey` and defaults. The general (app-wide) prefs are a fourth instance.

### Four preference scopes

| Scope | Storage key | Managed by |
|-------|-------------|------------|
| General | `general:prefs` | mode-switcher or shared init |
| Reader | `reader:prefs` | `reader-app.js` |
| RSVP | `rsvp:prefs` | `rsvp-app.js` |
| TTS | `tts:prefs` | `tts-app.js` |

### Reader prefs schema

```js
{
  v: 1,                    // schema version
  theme: 'dark',           // 'dark' | 'light' | 'sepia' | 'oled'
  font: 'serif',           // 'serif' | 'sans' | 'dyslexic' | 'mono'
  size: 19,                // integer, clamped to [14, 30]
  weight: 'regular',       // 'regular' | 'medium' | 'bold'
  images: true,            // show images
  notePopovers: true,      // show footnote popovers
  lineHeight: 1.62,        // CSS line-height value
  margin: 'normal',        // 'narrow' | 'normal' | 'wide'
  paraSpacing: 'indent',   // 'indent' | 'space' | 'both' | 'none'
  align: 'justify',        // 'justify' | 'left'
  hyphens: true,           // CSS hyphens
  selection: true,         // show text selection toolbar
  brightness: 1,           // 0.3–1.0 (dimming overlay opacity)
  warmth: 0,               // 0–0.5 (amber warmth overlay opacity)
  pageAnim: 'slide',       // 'slide' | 'none'
  layout: 'paginated',     // 'paginated' | 'scroll'
  columns: 'auto',         // 'auto' | '1' | '2'
}
```

### RSVP prefs schema

```js
{
  v: 1,
  theme: 'dark',
  font: 'sans',
  wpm: 300,                // words per minute, [100, 800]
  chunkSize: 1,            // words per display chunk: 1, 2, or 3
  trainingEnabled: false,  // auto-increment WPM
  trainingInterval: 500,   // words between WPM increments
  trainingStep: 10,        // WPM added per increment
}
```

### TTS prefs schema

```js
{
  v: 1,
  theme: 'dark',
  voiceName: '',           // SpeechSynthesisVoice.name (empty = default)
  rate: 1.0,               // speech rate, [0.75, 2.0]
  highlightMode: 'sentence', // 'word' | 'sentence' | 'paragraph'
}
```

### How preferences propagate

1. Settings screen (or any code) calls `prefs.set('font', 'sans')`
2. `PrefsManager.set()` updates `this.data.font`, persists to `localStorage`, and fires:
   - `emit('font', 'sans', 'serif')` — key-specific event
   - `emit('change', 'font', 'sans', 'serif')` — generic change event
3. Subscribers registered with `prefs.on('font', fn)` run immediately
4. In reader mode, this triggers a CSS variable update and repagination

On app init, `prefs.applyAll()` fires every key's current value, causing all subscribers to run and apply the saved state to the DOM without special initialization code.

---

## EventBus

`js/core/events.js`

Used as a base class for `PrefsManager` and as a standalone message channel between modules.

### API

```js
const bus = new EventBus()

// Subscribe — returns unsubscribe function
const unsub = bus.on('myEvent', (a, b) => { ... })

// Unsubscribe explicitly
bus.off('myEvent', handler)

// Or use the returned function
unsub()

// Emit
bus.emit('myEvent', arg1, arg2)

// Wildcard listener — receives ALL events
bus.on('*', (eventName, ...args) => { ... })
```

### Wildcard events

Any listener registered for `'*'` receives every event. The handler signature changes: `fn(eventName, ...args)`. Useful for:
- Debugging: log all pref changes
- Cross-cutting concerns: analytics, undo history

### Memory management

Since mode switching aborts the `AbortSignal`, event listeners should be registered with `signal.addEventListener('abort', () => bus.off(...))` or use the unsubscribe function returned by `bus.on()`. In practice, mode-owned buses (like `PrefsManager`) are garbage collected with the mode handle.

---

## ReaderState

`js/core/state.js` — plain object container, no logic.

The complete shape:

```js
class ReaderState {
  constructor() {
    this.page = 0;
    this.total = 1;
    this.stride = 1;
    this.bookId = "sample";
    this.docModelBuilt = false;
    this.sectionEls = new Map();   // href -> .chap element
    this.headingToc = [];
    this.chapterIndex = [];
    this.sectionBlockStart = [];

    // Windowed rendering (default for paginated layout): only one .chap is
    // attached to the DOM at a time. The global doc-model is still built once at
    // load (all chapters attached), so search/bookmarks/position work globally.
    this.windowed = false;
    this.chapWindows = [];   // [{ el, marker }] for every chapter, in order
    this.curChap = 0;        // index of the currently-attached chapter
    this.sectionLabels = []; // per-section heading label, for windowed progress

    // Whole-book page counts (windowed mode only). PageCounter fills these lazily
    // during idle time. undefined = not yet measured; complete = all filled.
    // Cached in localStorage keyed by pageCountSig; loaded instantly on re-open
    // with the same layout (same font/size/viewport/etc). Off the hot path.
    this.pageCounts = [];          // exact pages per section (undefined = unmeasured)
    this.pageCountsComplete = false;
    this.pageCountSig = "";        // layout signature pageCounts belong to

    this.doc = {
      words: [],
      blocks: [],
      sections: [],
      text: '',
      wordCharStart: [],
      // render-token ↔ whitespace-word bridge (cross-mode count-exactness)
      tokenToWs: [],   // render-token index -> whitespace-word ordinal
      wsToToken: [],   // whitespace-word ordinal -> first render-token index
    };
  }

  get isScrollMode() { return this._prefs && this._prefs.data.layout === "scroll"; }
}
```

> **Windowed rendering.** In paginated layout, books at/above `WINDOW_MIN_WORDS`
> render only the current chapter; the rest live detached in comment-marker
> placeholders (`chapWindows`). `curChap` is the attached chapter; navigation
> (`seekToToken`, TOC/footnote/bookmark jumps, boundary page turns) attaches the
> target chapter on demand. Because the doc-model is built once with every
> chapter attached, the word→node references survive detachment, so `doc.text`
> search, bookmarks and canonical position all resolve against the global model.
> Scroll layout and small/single-chapter books render whole (`windowed = false`).

**`words[]`** — the most granular level. Each entry is:
```js
{
  node: Text,      // The DOM Text node containing this word
  start: number,   // character offset within node.nodeValue where word begins
  end: number,     // character offset where word ends (exclusive)
  block: number,   // index into blocks[]
  section: number, // index into sections[]
}
```

**`blocks[]`** — each `.blk` element:
```js
{
  el: Element,       // the .blk DOM element
  type: string,      // 'p', 'h1', 'h2', 'blockquote', etc.
  section: number,   // index into sections[]
  wordStart: number, // first word index for this block
  wordEnd: number,   // one past last word (exclusive)
}
```

**`sections[]`** — each `.chap` element (EPUB spine item):
```js
{
  href: string,      // EPUB href (e.g. 'OEBPS/chapter01.xhtml')
  el: Element,       // the .chap DOM element
  wordStart: number, // first word index
  wordEnd: number,   // one past last word
}
```

**`sectionBlockStart[]`** — parallel to `sections[]`:
```js
sectionBlockStart[si] // index of the first block in section si
```

This allows `resolveLocator` to convert a section-relative block index `b` to a global block index: `globalBlockIdx = sectionBlockStart[si] + b`.

---

## RsvpState

`js/rsvp/state.js`

```js
class RsvpState {
  constructor() {
    this.currentIdx = 0;
    this.playState = 'paused'; // 'playing' | 'paused' | 'loading' | 'error' | 'countdown'
    this.rampRemaining = 0;

    // Set after tokenize():
    this.tokens = [];
    this.paragraphs = [];
    this.wordTokenIndices = [];
    this.tokenToWordOrdinal = [];
    this.sentenceStarts = [];
    this.chapters = [];
  }
}
```

**`tokens[]`** — flat array of all tokens in reading order:
```js
// Word token:
{ kind: 'word', text: 'Elizabeth', orpIdx: 2, isSentenceStart: true }

// Paragraph break token:
{ kind: 'break' }
```

**`wordTokenIndices[]`** — the indices within `tokens[]` that are word tokens. Used for word-skipping navigation that needs to ignore break tokens.

**`tokenToWordOrdinal[]`** — maps any token index to the count of words read up to (and including) that token. Used for WPM and training calculations.

**`sentenceStarts[]`** — sorted array of token indices where a new sentence begins. Used by `stepSentence()` for navigation.

**`paragraphs[]`** — `[[startTokenIdx, endTokenIdx], ...]` — one range per paragraph. Used by `stepParagraph()`.

**`chapters[]`** — `[{ title: string, tokenIdx: number }]` — sorted by tokenIdx. Maps the chapter dropdown selection to a token index to seek to.

---

## Canonical Position System

`js/core/position.js` defines a single, **mode-independent** position representation shared by Reader, RSVP, and TTS. It replaced the old approach where each mode persisted a scalar fraction in its own unit (Reader/RSVP measured words, TTS measured sentences) and cross-mode transfer rounded through a whole-book fraction — which drifted by a page or more on every mode switch.

All three modes derive their content from the same EPUB extraction and can each compute an exact **global word ordinal**. That ordinal is the shared currency, anchored to the section's stable spine **href** (not its index).

### Why it survives everything

| Change | How it survives |
|--------|-----------------|
| Switching Reader ↔ RSVP ↔ TTS | All modes build/resolve the same canonical object |
| A cover page prepended in some modes but not others | Anchored on `href`, not section index — a 0-word cover never shifts the anchor |
| Re-pagination, font / column / theme changes | Position is a word ordinal, not a page number |
| One mode tokenising words slightly differently | Reconciled via the within-section word fraction; any residual error is bounded to a single chapter |

### Canonical position format

```js
{
  v: 1,             // schema version
  href: string,     // stable spine href of the section the position is in
  wordInSec: number,// word ordinal within that section (primary precision)
  secWords: number, // that section's word count as the SAVING mode counted it
  ord: number,      // global word ordinal (fallback)
  words: number,    // total words as the saving mode counted them (fallback denominator)
  f: number,        // global progress fraction [0,1] (progress bar + ultimate fallback)
}
```

### Core functions

- `deriveBookId(urlId, metaTitle, fileName)` — one identifier used by **every** mode (`?id=` → metadata title → filename), so the shared storage key matches across modes and sessions.
- `buildPosition(sections, totalWords, globalOrd)` — build the object from a `[{ href, wordStart, wordCount }]` section table and the current global word ordinal.
- `resolvePosition(pos, sections, totalWords)` → global word ordinal in *this* mode, falling through three levels: (1) match section by `href` and reconcile the within-section offset; (2) scale the global ordinal by the ratio of word counts; (3) the fraction (this also reads the legacy `{ f }` format).

### How each mode plugs in

| Mode | Section table source | Global ordinal source |
|------|----------------------|-----------------------|
| Reader | `state.doc.sections` (`href`, `wordStart`, `wordEnd`) | `wordAtPageStart(page)` / scroll locator |
| RSVP | `state.chapters` (`href`, `wordOffset`) | `state.wordOrdinalAt(currentIdx)` |
| TTS | section table built in `segmentContent()` from `.chap[data-href]` | `sentences[currentSentenceIdx].wordOffset` |

Each mode's handle exposes `getPosition()` and `applyPosition(pos)`; the mode switcher passes the canonical object directly between modes.

---

## localStorage Schema

All keys are namespaced by scope and book ID to prevent collisions.

### Position storage (all modes)

```
book:pos:{bookId}      → { "v": 1, "href": "chapter03.xhtml", "wordInSec": 412,
                           "secWords": 1840, "ord": 9573, "words": 51230, "f": 0.187 }
```

A single shared key, written and read by Reader, RSVP, and TTS alike. `bookId` comes from `deriveBookId()` — `?id=` URL parameter, else metadata title, else filename (sans `.epub`).

### Preferences

```
general:prefs          → { "theme": "sepia" }
reader:prefs           → { "v": 1, "font": "sans", "size": 21, ... }
rsvp:prefs             → { "v": 1, "wpm": 350, "chunkSize": 2, ... }
tts:prefs              → { "v": 1, "rate": 1.25, "highlightMode": "word", ... }
```

### Bookmarks

```
reader:bookmarks:{bookId}   → [
  {
    "id": "bm_...",
    "fraction": 0.312,                          // used only for sorting
    "position": { "v": 1, "href": "...", ... }, // canonical position (cover-proof)
    "chapterLabel": "Chapter 5",
    "text": "Great passage about Bingley",
    "note": "",
    "createdAt": 1717250520000
  },
  ...
]
```

Each mode now stores the canonical `position` in its bookmarks, so bookmarks are cover-proof and portable across modes.

### Full key listing

| Key pattern | Contents | Created by |
|-------------|----------|------------|
| `book:pos:{id}` | Canonical position object | `StorageManager` / each app's `savePosition()` |
| `book:pages:{id}` | Per-section page counts + layout signature | `PageCounter` (windowed mode) |
| `reader:bookmarks:{id}` | Bookmark array | `BookmarkManager` |
| `general:prefs` | General prefs | `PrefsManager.save()` |
| `reader:prefs` | Reader prefs | `PrefsManager.save()` |
| `rsvp:prefs` | RSVP prefs | `PrefsManager.save()` |
| `tts:prefs` | TTS prefs | `PrefsManager.save()` |

> **Note:** The Reader still uses the structural `{ s, b, w }` locator (`js/model/locator.js`) internally to preserve position across live re-pagination and for search-result jumps. It is no longer persisted — the canonical position above is the only stored position.

---

## Mode Orchestration State

`mode-switcher.js` maintains four module-level variables:

```js
let currentMode       // 'read' | 'rsvp' | 'tts' | null
let currentHandle     // { teardown, getPosition, applyPosition, loadFromBuffer, getBookId, isBookLoaded }
let currentController // AbortController — aborted on mode switch
let cachedBook        // { buffer: ArrayBuffer, fileName: string } | null
```

`cachedBook` is the mechanism for mode transfer. It holds a slice of the most recently loaded book's `ArrayBuffer`. When switching modes, `mode-switcher.js` passes `cachedBook.buffer.slice(0)` to the new mode's `loadFromBuffer()` — creating a fresh copy each time so the new mode can parse it independently. The outgoing mode's canonical position (`{ pos }` from `getPosition()`) rides along and is handed to the new mode's `applyPosition()` once it finishes rendering.

---

## AbortSignal Lifecycle

Every mode's `init()` receives `{ signal }` — an `AbortSignal` from the mode switcher's `AbortController`.

Modules use this signal to:
- Cancel in-progress `fetch()` calls: `fetch(url, { signal })`
- Remove event listeners conditionally:
  ```js
  signal.addEventListener('abort', () => {
    window.removeEventListener('keydown', handler)
    bus.off('event', listener)
  })
  ```
- Guard async continuations:
  ```js
  await someAsyncOp()
  if (signal.aborted) return   // mode was switched mid-operation
  doNextThing()
  ```

When the user switches modes, `currentController.abort()` fires. Any pending work in the previous mode's modules sees `signal.aborted === true` and stops cleanly, preventing stale callbacks from interfering with the new mode.
