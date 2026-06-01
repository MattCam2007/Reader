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
    this.stride = 0;
    this.bookId = null;
    this.docModelBuilt = false;
    this.isScrollMode = false;
    this.sectionBlockStart = [];

    this.doc = {
      words: [],
      blocks: [],
      sections: [],
      text: '',
      wordCharStart: [],
    };
  }
}
```

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

## Position Locator System

The locator is a compact, schema-stable encoding of reading position that survives:
- Font changes (different line breaks → different page numbers)
- Window resizing and rotation
- Column count changes
- Theme changes

### Locator format

```js
{
  s: number,   // section (chapter) index
  b: number,   // block index within the section
  w: number,   // word index within the block
}
```

All three values are 0-based and bounded by the book's content. If the book structure changes slightly (e.g., a block is split), `resolveLocator` clamps each component to the valid range, so it always returns a valid word index rather than failing.

### When locators are created

- **On page turn** (debounced 500ms): `toLocator(state, getFirstWordOnPage(state, state.page))`
- **On scroll** (scroll mode, debounced 500ms): same, using the first visible word
- **On bookmark creation**: locator of the first word on the current page

### When locators are resolved

- **On book load**: `resolveLocator(state, savedLocator)` → word index → `goToWord(wi)`
- **On bookmark jump**: same process

### Fraction fallback

If no locator is saved (first visit) or resolution fails (book structure changed substantially), a simple fraction is used:

- **Save**: `f = page / (total - 1)` or `scrollTop / (scrollHeight - clientHeight)`
- **Restore**: `goToPage(Math.round(f * (total - 1)))`

---

## localStorage Schema

All keys are namespaced by scope and book ID to prevent collisions.

### Position storage (Reader)

```
reader:pos:{bookId}    → { "f": 0.423 }
reader:loc:{bookId}    → { "s": 3, "b": 12, "w": 7 }
```

`bookId` is derived from the book's metadata (author + title slug) or the `?id=` URL parameter. Falls back to the filename.

### Position storage (TTS)

```
tts:pos:{bookId}       → { "sentenceIdx": 148 }
```

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
    "id": "a1b2c3d4-...",
    "fraction": 0.312,
    "loc": { "s": 2, "b": 5, "w": 0 },
    "note": "Great passage about Bingley",
    "createdAt": "2025-06-01T14:22:00.000Z"
  },
  ...
]
```

### Full key listing

| Key pattern | Contents | Created by |
|-------------|----------|------------|
| `reader:pos:{id}` | Page fraction `{ f }` | `StorageManager.savePos()` |
| `reader:loc:{id}` | Word locator `{ s, b, w }` | `StorageManager.savePos()` |
| `reader:bookmarks:{id}` | Bookmark array | `BookmarkManager.save()` |
| `tts:pos:{id}` | Sentence index | `tts-app.js` |
| `general:prefs` | General prefs | `PrefsManager.save()` |
| `reader:prefs` | Reader prefs | `PrefsManager.save()` |
| `rsvp:prefs` | RSVP prefs | `PrefsManager.save()` |
| `tts:prefs` | TTS prefs | `PrefsManager.save()` |

---

## Mode Orchestration State

`mode-switcher.js` maintains four module-level variables:

```js
let currentMode       // 'read' | 'rsvp' | 'tts' | null
let currentHandle     // { teardown, seekFraction, loadFromBuffer, getBookId, isBookLoaded }
let currentController // AbortController — aborted on mode switch
let cachedBook        // { buffer: ArrayBuffer, fileName: string } | null
```

`cachedBook` is the mechanism for mode transfer. It holds a slice of the most recently loaded book's `ArrayBuffer`. When switching modes, `mode-switcher.js` passes `cachedBook.buffer.slice(0)` to the new mode's `loadFromBuffer()` — creating a fresh copy each time so the new mode can parse it independently.

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
