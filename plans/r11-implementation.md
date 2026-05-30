# R11: Mode Switching Implementation

## What Was Done

Merged the paginated reader (`reader.html`) and RSVP speed reader (`index.html`) into a **single entry point** with runtime mode switching.

### Commits (on `feature/ui-overhaul`)

1. `a4395d9` — R0-R9: Extracted RSVP monolith (2,217 lines) into 16 ES modules
2. `ae78f1f` — R11: Mode switching merger (this document)

### Files Created

| File | Purpose |
|------|---------|
| `js/mode-switcher.js` | Orchestrator: detects `?mode=` param, switches modes, transfers book data + position |
| `js/reader/template.js` | Returns reader DOM as HTML string (extracted from old `reader.html` body) |
| `js/rsvp/template.js` | Returns RSVP DOM as HTML string (extracted from old `index.html` body) |

### Files Modified

| File | Change |
|------|--------|
| `js/reader-app.js` | Wrapped all code in `export function init(options)` — no longer runs at import time |
| `js/rsvp-app.js` | Same treatment; also renamed `epubFileInput` → `fileInput`, settings ID → `rsvpSettings` |
| `reader.html` | Rewritten as minimal shell: loads both CSS files, has `<div id="app">` + shared `<input type="file" id="fileInput">`, boots `mode-switcher.js` |
| `index.html` | Now just redirects to `reader.html?mode=rsvp` |

---

## Architecture

```
reader.html (shell)
  ├── <div id="app">        ← mode-specific DOM injected here
  ├── <input id="fileInput"> ← shared file picker
  └── mode-switcher.js
        ├── ?mode=read  → injects readerTemplate() → import('./reader-app.js').init()
        └── ?mode=rsvp  → injects rsvpTemplate()  → import('./rsvp-app.js').init()
```

### Mode Switch Flow

1. `currentHandle.teardown()` — cleans timers, blob URLs, intervals
2. `currentController.abort()` — removes ALL event listeners (every `addEventListener` uses `{ signal }`)
3. `appEl.innerHTML = ''` — destroys mode-specific DOM
4. `clearBodyClasses()` — strips all mode-specific body classes
5. Inject new template HTML into `#app`
6. `await import('./xxx-app.js')` — returns cached module (ES modules only execute once)
7. `mod.init({ signal, onModeSwitch, onBookLoaded })` — creates fresh state in closure
8. If cached book exists: `handle.loadFromBuffer(buffer, fileName)` then `handle.seekFraction(fraction)`

### init() Return Handle

Both app modules return:
```js
{
  teardown(),              // cleanup not covered by signal.abort()
  getPositionFraction(),   // current position as 0-1 float
  getBookId(),             // current book identifier
  isBookLoaded(),          // true if EPUB loaded (not sample text)
  seekFraction(f),         // seek to position (0-1 float)
  loadFromBuffer(buf, fn), // load EPUB from ArrayBuffer
}
```

### Position Transfer

Uses **word fraction** — `currentWordIndex / totalWordCount`. This is approximate because the reader's doc model and RSVP's tokenizer produce slightly different word counts from the same text. Good enough for practical use.

### Book Data Caching

`mode-switcher.js` holds `cachedBook = { buffer, fileName }` in module scope. When either app loads an EPUB, it calls `onBookLoaded({ buffer, fileName, bookId })`. The buffer is cloned via `.slice(0)` to prevent detachment issues.

---

## Key Design Decisions

1. **Dynamic DOM injection, not hidden dual DOM** — Only one mode's elements exist at a time. IDs are unique, `document.getElementById()` works unchanged.

2. **ES module caching is intentional** — `import()` returns the same module on subsequent calls. `init()` creates fresh closures each time, so re-entering a mode works correctly.

3. **Body classes overlap is safe** — Both modes use `body.loading` and `body.error`, but CSS selectors target mode-specific elements (`.rsvp-status` vs `.reader-overlay`) that only exist in one mode at a time.

4. **Shared file input in shell** — `<input id="fileInput">` lives outside `#app` so it persists across mode switches. Both apps reference it by the same ID.

5. **`wireSettings()` listeners lack `{ signal }`** — The reader-app's settings wiring doesn't pass signal to some listeners. This is safe because those elements are destroyed when `#app` is cleared, so listeners get GC'd. Not ideal but not a leak.

6. **RSVP settings `<details>` ID changed** — From `id="settings"` to `id="rsvpSettings"` to avoid conflicts if both templates were ever co-present (they aren't, but defensive).

---

## Known Issues / Debugging Guide

### If mode switching fails silently
- Check browser console for import errors
- `mode-switcher.js` catches teardown errors but logs them as `switcher:teardown`
- Book transfer errors logged as `switcher:transfer`

### If elements are null after mode switch
- Template HTML must be injected BEFORE `init()` runs
- `mode-switcher.js` does `appEl.innerHTML = template()` then `await import()` then `init()` — this ordering is critical

### If event listeners persist after mode switch
- Every `addEventListener` should have `{ signal }` in options
- Check that the signal comes from `options.signal` in init(), not a local AbortController
- `wireSettings()` in reader-app.js is an exception — relies on DOM destruction instead

### If CSS looks wrong
- Both `css/reader.css` and `css/rsvp.css` are loaded in the shell
- RSVP styles use `.rsvp-*` BEM prefix — no collision with `.reader-*`
- Body class `rsvp` is only added in RSVP mode; `chrome-hidden` only in reader mode
- Both CSS files import `tokens.css` — browser deduplicates

### If position transfer is inaccurate
- Fraction-based: `wordOrdinal / totalWords` in RSVP, `resolvedWordIndex / doc.words.length` in reader
- The two tokenizers count words slightly differently (RSVP strips more aggressively)
- Position is set with a `setTimeout(100ms)` delay to let the book render first

### If the old index.html URL stops working
- `index.html` now redirects to `reader.html?mode=rsvp`
- The redirect script tries to preserve existing query params

### If books don't transfer between modes
- Check `cachedBook` is being set (the `onBookLoaded` callback must fire)
- `onBookLoaded` is called inside `loadEpub()` after successful parse
- Buffer is cloned with `.slice(0)` on both cache and transfer

---

## Files Reference (post-R11)

```
reader.html              ← unified entry point (25 lines)
index.html               ← redirect to reader.html?mode=rsvp
js/mode-switcher.js      ← mode orchestrator (~95 lines)
js/reader-app.js         ← paginated reader init (~558 lines, exports init())
js/rsvp-app.js           ← RSVP speed reader init (~464 lines, exports init())
js/reader/template.js    ← reader DOM template
js/rsvp/template.js      ← RSVP DOM template
js/reader/               ← pagination, input, chrome, search, selection, footnotes, chapters, focus-trap
js/rsvp/                 ← tokenizer, timing, state, navigation, playback, display, input, stats, training, chapters, constants
js/core/                 ← constants, events, prefs, state, storage
js/epub/                 ← extractor, images, toc
js/model/                ← doc-model, locator, geometry
js/shared/               ← picker.js
css/reader.css           ← imports tokens.css + component CSS
css/rsvp.css             ← imports tokens.css + picker.css
css/tokens.css           ← unified theme tokens (4 themes)
```
