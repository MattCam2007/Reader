# Architecture

This document describes the overall system design of Reader: how the codebase is structured, how modules relate to one another, how the app boots, and what design principles guide the implementation.

---

## Overview

Reader is a client-side EPUB reading application written in vanilla ES6+ JavaScript and CSS. There is no build step, no bundler, and no server — the browser loads ES modules directly. The entire application runs in the user's browser and stores all state in `localStorage`.

**Three reading modes share a single entry point:**
- **Reader** — paginated multi-column layout with full typography controls
- **RSVP** — word-by-word speed reading (Rapid Serial Visual Presentation)
- **TTS** — text-to-speech with word/sentence highlighting

A thin orchestrator (`mode-switcher.js`) manages which mode is active, handles teardown between switches, and transfers the loaded book and reading position when the user changes modes.

---

## Design Principles

**No build step.** ES modules are loaded directly by the browser via `<script type="module">`. This eliminates toolchain complexity and makes every file directly readable and debuggable in DevTools.

**No global state.** Each mode's state lives in a class instance scoped to that mode's `init()` call. The mode switcher holds only the current handle and a cached `ArrayBuffer` of the loaded book.

**Lifecycle via AbortController.** Every mode receives an `AbortSignal` on init. When the user switches modes, the controller is aborted, which cascades cleanly through event listeners, fetch calls, and timers that are wired to that signal.

**Word-level position encoding.** Reading position is stored not as a page number or scroll fraction, but as a structured locator `{section, block, word}`. This survives font changes, screen rotation, window resizing, and repagination.

**Modular CSS.** A single `tokens.css` file defines all design tokens (colors, spacing, fonts) for all four themes. Mode-specific stylesheets import the shared component files they need.

---

## Directory Structure

```
Reader/
│
├── reader.html                  Entry point — loads mode-switcher.js, registers SW
├── index.html                   Redirect → reader.html?mode=rsvp
├── library.html                 Bookshelf UI (shell; loads js/library/* + shared CSS)
├── sw.js                        Service worker — versioned cache, offline, CDN precache
├── manifest.json                PWA manifest (icons, display, theme color)
├── icon.svg                     App icon (source)
├── icon-192.png                 PWA icon 192×192
├── icon-512.png                 PWA icon 512×512
│
├── js/
│   ├── mode-switcher.js         Mode orchestrator — boot, switch, teardown, session cache
│   ├── base-reader-app.js       Shared shell helpers — theme, OS fallback, position storage
│   ├── reader-app.js            Paginated reader — exports init()
│   ├── rsvp-app.js              RSVP speed reader — exports init()
│   ├── tts-app.js               Text-to-speech reader — exports init()
│   │
│   ├── core/                    Shared infrastructure
│   │   ├── constants.js         All app-wide constants, defaults, settings schema
│   │   ├── book-session.js      BookSession — parse/extract a book ONCE, shared by all modes
│   │   ├── events.js            EventBus (pub/sub, wildcard support)
│   │   ├── prefs.js             PrefsManager — load/save/get/set with EventBus
│   │   ├── state.js             ReaderState — paginated reader's state container
│   │   ├── position.js          Canonical cross-mode position (build/resolve/store)
│   │   ├── bookmarks.js         BookmarkManager — localStorage-backed bookmarks
│   │   ├── sw-register.js       Service-worker registration + update toast
│   │   └── storage.js           StorageManager — position save/restore
│   │
│   ├── epub/                    EPUB processing pipeline
│   │   ├── extractor.js         Extract rich/plain text blocks from EPUB spine
│   │   ├── images.js            Resolve image blob URLs; detect cover image
│   │   └── toc.js               Flatten EPUB navigation; render TOC; resolve hrefs
│   │
│   ├── model/                   Document model and geometry
│   │   ├── doc-model.js         Build word/block/section index from rendered DOM
│   │   ├── locator.js           Encode/decode portable position (section+block+word)
│   │   └── geometry.js          Page↔word mapping via column geometry; binary search
│   │
│   ├── reader/                  Paginated reader sub-modules
│   │   ├── pagination.js        Column layout engine; page navigation; DOM detach
│   │   ├── chrome.js            Topbar/bottombar state sync (title, chapter, page #)
│   │   ├── input.js             Touch swipes, tap zones, keyboard shortcuts
│   │   ├── search.js            Full-text search; CSS Highlight API integration
│   │   ├── selection.js         Text selection floating toolbar
│   │   ├── footnotes.js         Footnote/endnote popover handling
│   │   ├── chapters.js          Chapter index builder from DOM headings
│   │   ├── focus-trap.js        Modal focus trapping for accessibility
│   │   └── template.js          HTML template for the reader shell
│   │
│   ├── rsvp/                    RSVP speed reader sub-modules
│   │   ├── state.js             RsvpState — playback state machine
│   │   ├── constants.js         RSVP-specific tuning parameters
│   │   ├── tokenizer.js         Text→token pipeline; sentence detection; ORP index
│   │   ├── timing.js            Per-word display duration (length, punctuation, ramp)
│   │   ├── playback.js          PlaybackEngine — timer loop, chunks, countdown
│   │   ├── display.js           Word rendering; ORP alignment; context line; ETA
│   │   ├── input.js             Touch/keyboard/fullscreen input for RSVP
│   │   ├── navigation.js        Step by word/sentence/paragraph; rewind
│   │   ├── stats.js             Session statistics tracker (WPM, time, words)
│   │   ├── training.js          Auto WPM ramp manager
│   │   ├── chapters.js          Chapter dropdown population and navigation
│   │   └── template.js          HTML template for the RSVP shell
│   │
│   ├── tts/                     Text-to-speech sub-modules
│   │   ├── engine.js            SpeechSynthesis API wrapper; sentence queue
│   │   ├── constants.js         TTS defaults (rate, voice, highlight mode)
│   │   ├── highlighter.js       Word/sentence/paragraph highlight during playback
│   │   └── template.js          HTML template for the TTS shell
│   │
│   ├── bookmarks/
│   │   └── panel.js             Bookmark list UI — render, add, delete
│   │
│   ├── settings/
│   │   └── settings-screen.js   Modal settings UI with tabbed controls (200+ lines)
│   │
│   ├── shared/
│   │   ├── render.js            Build .chap/.blk DOM + inline annotation (Reader + TTS)
│   │   ├── search.js            Full-text hit-finding + binary-search resolution (all modes)
│   │   └── picker.js            Scroll-snap horizontal picker (WPM, speed values)
│   │
│   ├── library/
│   │   ├── library.js          Bookshelf logic (folders, search, detail sheet, theme)
│   │   └── data.js             Sample library data (until data/library.json exists)
│   │
│   └── test/
│       └── selftest.js          Self-test suite with visual pass/fail reporter
│
├── css/
│   ├── tokens.css               Design tokens — 4 themes, spacing, fonts, radii
│   ├── reader.css               Reader mode: imports tokens + component stylesheets
│   ├── rsvp.css                 RSVP mode: imports tokens + component stylesheets
│   ├── tts.css                  TTS mode: imports tokens + component stylesheets
│   └── components/
│       ├── chrome.css           Topbar, bottombar, toolbar, progress slider
│       ├── content.css          Reading surface, typography, tables, footnotes
│       ├── controls.css         Segmented buttons, range sliders
│       ├── drawers.css          TOC drawer, settings sheet, search panel
│       ├── overlay.css          Loading/error states, coach hints, comfort overlay
│       ├── picker.css           Scroll-snap picker component
│       ├── selection.css        Selection toolbar, search result highlights
│       └── settings-screen.css  Settings modal styling
│
├── fixtures/
│   └── sample.js               Pride & Prejudice sample (25 paragraphs, exported as array)
│
├── plans/                      Implementation plans and investigation notes
│   ├── rsvp-features.md
│   ├── production-readiness.md
│   ├── tts-mode.md
│   └── ...
│
└── docs/                       Developer documentation (this directory)
```

---

## Module Dependency Graph

The dependency flow is strictly layered. Higher layers import from lower layers; lower layers never import from higher ones.

```
                    ┌─────────────────┐
                    │   reader.html   │  (entry point, loads mode-switcher.js)
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ mode-switcher   │  (orchestrator)
                    └──┬──────┬───┬──┘
                       │      │   │
            ┌──────────▼─┐ ┌──▼──────┐ ┌──▼──────┐
            │ reader-app │ │rsvp-app │ │ tts-app │   (mode entry points)
            └──────┬─────┘ └────┬────┘ └────┬────┘
                   │            │            │
        ┌──────────▼────────────▼────────────▼──────────────┐
        │                   EPUB Processing                  │
        │          epub/extractor  epub/images  epub/toc     │
        └──────────────────────────┬─────────────────────────┘
                                   │
        ┌──────────────────────────▼─────────────────────────┐
        │                  Document Model                     │
        │         model/doc-model  model/locator  model/geo  │
        └──────────────────────────┬─────────────────────────┘
                                   │
        ┌──────────────────────────▼─────────────────────────┐
        │                  Core Infrastructure                │
        │    core/constants  core/events  core/prefs          │
        │    core/state  core/storage  core/bookmarks         │
        └────────────────────────────────────────────────────┘

Mode-specific sub-modules (reader/, rsvp/, tts/) import only from core/ and model/.
shared/ and bookmarks/ and settings/ are imported by mode apps directly.
```

---

## Entry Point and Boot Sequence

### `reader.html`

The HTML file is 25 lines. It sets up the page shell (meta tags, theme-color, CSS link, `<div id="app">`) and loads `mode-switcher.js` as a module:

```html
<script type="module" src="js/mode-switcher.js"></script>
```

There is no framework, no virtual DOM, and no hydration. The DOM is built by template functions called from within each mode's initialization.

### `mode-switcher.js` — Boot Sequence

1. Parse `?mode=` URL parameter (defaults to `read`)
2. Call `switchMode(initialMode)`:
   a. Clear any previous body classes
   b. Create a new `AbortController`
   c. Inject the mode's HTML template into `#app`
   d. Dynamically import the mode's app module (`reader-app.js`, `rsvp-app.js`, or `tts-app.js`)
   e. Call `mod.init({ signal, onModeSwitch, onBookLoaded })`
   f. Store the returned handle (`{ teardown, getPosition, applyPosition, loadFromBuffer, getBookId, isBookLoaded }`)
3. If switching from an already-loaded book, call `loadFromBuffer()` then `applyPosition()` on the new handle

### Mode `init()` Return Handle

Every mode's `init()` returns an object with this interface:

```js
{
  teardown()                            // Stop timers, remove listeners, clean DOM
  getPosition(): CanonicalPosition|null // Current position (js/core/position.js)
  applyPosition(pos: CanonicalPosition) // Seek to a canonical position
  loadFromBuffer(buf: ArrayBuffer,      // Load a book from an in-memory buffer
                 fileName: string)
  getBookId(): string | null            // Returns current book's ID
  isBookLoaded(): boolean               // Whether a book is currently loaded
}
```

---

## Mode Orchestration

`mode-switcher.js` is the only file that knows about all three modes. It handles:

**Switching modes:**
1. Call `currentHandle.teardown()` — the current mode cleans up its timers and DOM listeners
2. Call `currentController.abort()` — any pending fetches or async work using this signal is cancelled
3. Clear all mode-specific body classes from `document.body`
4. Clear `#app` innerHTML
5. Update the URL (`?mode=`) without a page reload via `history.replaceState`
6. Set up the new mode (inject template, dynamic import, call init)

**Book transfer:**
When switching modes while a book is loaded, the switcher:
1. Captures `posInfo.pos` (the canonical position) from the current mode before teardown
2. Holds a cached `ArrayBuffer` slice of the book (`cachedBook`)
3. After the new mode initializes, calls `loadFromBuffer()` then `applyPosition()` on the new handle
4. The `requestAnimationFrame` + `setTimeout(fn, 100)` delay allows the new mode's book render to complete before seeking

---

## EPUB Processing Pipeline

EPUB files are ZIP archives containing XHTML documents. The parse + extract +
image-resolve pipeline is **mode-agnostic and runs exactly once per book**,
owned by `core/book-session.js`:

> **`BookSession`** — `BookSession.fromBuffer(buffer, fileName, urlId)` runs
> `ePub()`, flattens the TOC, extracts sections, and resolves image blob URLs
> (baking the resolved `src` onto the template block frags), then destroys the
> epub.js book object. The resulting session — `{ sections, toc, bookId, title,
> blobUrls }` — is cached by `mode-switcher.js`. On a **mode switch** the *same*
> session object is handed to the next mode's `loadFromSession(session, pos)`,
> which renders without re-parsing. Switching Reader → RSVP → TTS now parses the
> EPUB once, not three times. The session owns the image blob URLs and disposes
> them only when a genuinely new book loads (so `renderBook` clones the shared
> frags rather than consuming them).

The pipeline inside a session:

```
File / URL
    │
    ▼
epub.js (CDN)              Parses EPUB metadata, spine order, navigation
    │
    ▼
epub/extractor.js          For each spine item:
                           - Loads the XHTML document
                           - Walks the DOM with BLOCK_SEL / SKIP_SEL rules
                           - Extracts either rich HTML (Reader/TTS) or plain text (RSVP)
                           - Returns an array of section objects: [{html, href, title}]
    │
    ├──▶ epub/images.js    Resolves relative image src attributes to blob: URLs
    │                      Detects and loads the book cover image
    │
    └──▶ epub/toc.js       Reads epub.js navigation to get TOC entries
                           Flattens nested TOC into a flat list with depth info
                           Builds the TOC drawer HTML
                           Resolves TOC href → spine section index
```

---

## Rendered DOM Structure

After extraction, the content is rendered into the reading surface with this hierarchy:

```html
<div class="content">
  <div class="chap" data-href="chapter1.xhtml">   ← one per EPUB spine item
    <p class="blk">...</p>                         ← one per extracted block
    <h2 class="blk">...</h2>
    <p class="blk">...</p>
    ...
  </div>
  <div class="chap" data-href="chapter2.xhtml">
    ...
  </div>
</div>
```

The document model (`model/doc-model.js`) indexes every word in every `.blk` within every `.chap`, producing three parallel arrays: `words[]`, `blocks[]`, `sections[]`. These arrays are the backbone of position encoding, search, geometry calculations, and TTS highlighting.

---

## Preferences System

Preferences are split by scope:

| Scope | Storage Key | Contents |
|-------|-------------|----------|
| General | `general:prefs` | Theme |
| Reader | `reader:prefs` | Font, size, margins, alignment, layout, etc. |
| RSVP | `rsvp:prefs` | WPM, chunk size, font, training settings |
| TTS | `tts:prefs` | Voice, rate, highlight mode |

Each scope is managed by a `PrefsManager` instance. `PrefsManager` extends `EventBus`, so modules can subscribe to individual key changes:

```js
prefs.on('theme', (newVal) => applyTheme(newVal));
prefs.on('font', (newVal) => applyFont(newVal));
```

Changes are written to `localStorage` immediately on `prefs.set()`.

---

## CSS Loading

Each mode has its own root CSS file that uses `@import` to pull in the token system and the specific component stylesheets it needs:

- `reader.css` — imports tokens + chrome, content, controls, drawers, overlay, picker, selection, settings-screen
- `rsvp.css` — imports tokens + chrome, controls, overlay, picker, drawers
- `tts.css` — imports tokens + chrome, content, controls, drawers, overlay

`reader.html` always loads `reader.css` by default. When mode-switcher changes modes, it updates the `<link>` element's `href` to the appropriate CSS file (or the CSS is already embedded per mode template).

---

## PWA Configuration

`manifest.json` configures Reader as an installable Progressive Web App:

```json
{
  "name": "Reader",
  "short_name": "Reader",
  "start_url": "/Reader/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#04030a",
  "theme_color": "#0d3a8a"
}
```

When installed via Chrome's "Add to Home Screen" or desktop install flow, the app opens without browser UI in its own window. All state is stored in the origin's `localStorage`, so installed and browser versions share the same data.

### Service Worker (`sw.js`)

`sw.js` (registered by `core/sw-register.js` from both `reader.html` and
`library.html`) gives the app offline support and instant repeat loads:

- **Versioned cache.** The cache name is `reader-<commit-hash>` (the deploy
  workflow stamps `__COMMIT_HASH__` into `sw.js`). On `activate` every other
  cache is deleted, so a new deploy refetches each asset exactly once.
- **Precache.** The app shell (HTML, the three top-level CSS files, icons,
  manifest, `mode-switcher.js`) plus the two CDN libraries (`jszip`, `epub.js`)
  are precached on `install` with `cache:'reload'`.
- **Runtime.** Same-origin assets and the CDN libs are cache-first (misses fetch
  with `cache:'reload'` so a fresh deploy bypasses any stale HTTP cache);
  navigations fall back to the cached HTML shell for offline; `?src=` books are
  network-first with a cache fallback.
- **Updates.** `skipWaiting` + `clients.claim`; a new build shows a "reload to
  update" toast wired to `postMessage('SKIP_WAITING')`.

Because the service worker versions assets, the CDN libraries load **deferred**
(no longer render-blocking) and the deploy workflow no longer rewrites every JS
import path with a `?v=hash` query — see `docs/PERFORMANCE.md`.

---

## Self-Test Suite

Running `reader.html?selftest=1` activates the self-test suite (`js/test/selftest.js`). It exercises:

- `buildDocModel` — word/block/section indexing, incl. the render-token ↔
  whitespace-word bridge
- `toLocator` / `resolveLocator` — position encoding roundtrips
- `buildPosition` / `resolvePosition` — canonical cross-mode position math
- Geometry calculations — page-to-word mapping
- EPUB extraction — block parsing
- `book-session` — shared `splitWords` / `countWords` word counting
- `shared/search` — `findHits` + binary-search `indexForOffset` hit resolution
- `shared/render` — `renderSections` tree-building + `annotateInlineText`
- `EventBus` — pub/sub semantics
- `PrefsManager` — load/save/get/set
- Chapter index builder

Results appear as a visual overlay with per-assertion pass/fail details. The suite runs in ~40 assertions and leaves no side effects on localStorage.

---

## Browser Requirements

**Required:**
- ES modules (`<script type="module">`)
- CSS custom properties (`var(--token)`)
- CSS multi-column layout (`column-count`, `column-gap`)
- `AbortController` / `AbortSignal`
- `localStorage`

**Optional (graceful degradation):**
- CSS Highlight API — search highlighting (falls back to no highlight)
- Fullscreen API — RSVP fullscreen mode
- `navigator.clipboard` — selection copy button
- `SpeechSynthesis` — TTS mode (mode unavailable if absent)
- `requestIdleCallback` — used where available for non-critical work

**Tested browsers:**
- Chrome / Edge 90+
- Firefox 90+
- Safari 15+
- Mobile Safari iOS 15+
- Chrome for Android
