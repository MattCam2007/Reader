# Module Reference

Complete documentation for every JavaScript module in the codebase. Modules are grouped by directory. For data flow between modules, see [DATA-FLOWS.md](DATA-FLOWS.md). For state structures, see [STATE.md](STATE.md).

---

## Top-Level App Modules

### `js/mode-switcher.js`

The application orchestrator. Loaded directly by `reader.html`. Manages mode lifecycle, book caching, and cross-mode position transfer.

**Key responsibilities:**
- Parse `?mode=` URL parameter and call `switchMode()` on boot
- On mode switch: tear down current mode, abort its signal, clear DOM, set up new mode
- Cache the loaded book as an `ArrayBuffer` slice so it can be handed to the next mode
- Update `?mode=` in the URL (without reload) on every switch

**Module-level state:**
```js
let currentMode     // 'read' | 'rsvp' | 'tts' | null
let currentHandle   // Return value from last init()
let currentController // AbortController for current mode's lifecycle
let cachedBook      // { buffer: ArrayBuffer, fileName: string } | null
```

**`switchMode(targetMode, posInfo?)`** — async  
Tears down current mode, sets up new mode. If `posInfo` is provided and a book is cached, loads the book into the new mode and seeks to `posInfo.pos` (the canonical position) via `applyPosition()`.

**`onBookLoaded({ buffer, fileName, bookId })`**  
Callback passed to each mode's `init()`. Called when a book finishes loading. Stores a slice of the buffer in `cachedBook` so mode switches can re-use it.

---

### `js/reader-app.js`

Entry point for the paginated reader mode. Orchestrates all reader sub-modules.

**Exports:** `init({ signal, onModeSwitch, onBookLoaded })`

**Returns:**
```js
{
  teardown(): void
  getPosition(): CanonicalPosition | null   // current position (see js/core/position.js)
  applyPosition(pos: CanonicalPosition): void
  loadFromBuffer(buf: ArrayBuffer, fileName: string): Promise<void>
  getBookId(): string | null
  isBookLoaded(): boolean
}
```

**What `init()` does:**
1. Instantiates `PrefsManager`, `ReaderState`, and all reader sub-modules
2. Wires preference change events to DOM updates and repagination
3. Sets up the open-file flow (file picker, drag-and-drop, URL `?src=` param)
4. Loads sample text if no book is specified
5. After book load: calls `buildDocModel`, then `paginationEngine.paginate()`, then `storageManager.restorePos()`

---

### `js/rsvp-app.js`

Entry point for the RSVP speed reader mode.

**Exports:** `init({ signal, onModeSwitch, onBookLoaded })`

**Returns:** Same interface as `reader-app.js`

**What `init()` does:**
1. Instantiates `RsvpState`, `PrefsManager` (rsvp scope), `PlaybackEngine`, `RsvpDisplay`, `RsvpInput`, `StatsTracker`, `TrainingManager`
2. Loads sample text or EPUB via URL param
3. Extracts plain text from EPUB (not rich HTML — RSVP needs raw word tokens)
4. Calls `tokenize()` to build the token array
5. Sets up input handlers and wires the playback engine to the display

---

### `js/tts-app.js`

Entry point for the text-to-speech mode.

**Exports:** `init({ signal, onModeSwitch, onBookLoaded })`

**Returns:** Same interface as reader-app and rsvp-app

**What `init()` does:**
1. Checks for `SpeechSynthesis` API availability
2. Instantiates `TtsEngine`, `TtsHighlighter`, `PrefsManager` (tts scope)
3. Loads and renders book content (rich HTML, same as reader mode)
4. Segments content into sentences and wraps them in `<span class="tts-sent">` elements
5. Sets up voice/rate pickers and playback controls
6. Restores saved position from the shared `book:pos:{bookId}` canonical position

**Mode loading.** All three entry points expose `loadFromSession(session, pos)`
on their handle. `loadEpub(file)` builds a `BookSession` (parse + extract once)
then calls `loadFromSession`; the mode-switcher hands the cached session straight
to `loadFromSession` on a mode switch (no re-parse). See `core/book-session.js`.

### `js/base-reader-app.js`

Shared app-shell helpers composed by all three modes (Phase 5):

| Export | Purpose |
|--------|---------|
| `applyTheme(name)` | Body theme class + browser-chrome `theme-color` meta |
| `applyThemeClass` / `setMetaThemeColor` | The two halves, separately |
| `applyOsThemeFallback(generalPrefs, onApply)` | First-run `prefers-color-scheme: light` |
| `savePosition(bookId, getPos)` / `loadPosition(bookId)` | Canonical `book:pos:` plumbing |

Done as composition rather than a base class: the modes' closure/AbortController
lifecycles are position-critical, so the genuinely-shared pieces are factored out
while each mode keeps its own (DOM-specific) panel wiring.

---

## `js/core/` — Shared Infrastructure

### `js/core/constants.js`

Single source of truth for all app-wide constants and default values. No classes or logic — pure exports.

**Font stacks:**
```js
FONT_SERIF    // Georgia, "Iowan Old Style", Palatino Linotype, Cambria, serif
FONT_SANS     // system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial
FONT_DYSLEXIC // "OpenDyslexic", "Comic Sans MS", cursive
FONT_MONO     // ui-monospace, "SF Mono", Menlo, Consolas, Liberation Mono
FONT_MAP      // { serif, sans, dyslexic, mono } → stack string
```

**Layout:**
```js
COLUMN_GAP              // 40 (px between columns)
MIN_SIZE / MAX_SIZE     // 14 / 30 (font size bounds)
```

**Theme colors** (for `<meta name="theme-color">`):
```js
THEME_COLORS  // { dark, sepia, light, oled, terminal, nebula, forest, ember, nord }
ALL_THEME_NAMES  // Array of all theme names
```

**Tap/swipe thresholds:**
```js
SWIPE_THRESHOLD_MAX_PX        // 80
SWIPE_THRESHOLD_VP_FRACTION   // 0.18
TAP_ZONE_LEFT / TAP_ZONE_RIGHT // 0.3 / 0.7 (fraction of viewport width)
SYNTHETIC_CLICK_GUARD_MS      // 600
TAP_TIMEOUT_MS                // 400
```

**Timing:**
```js
SAVE_DEBOUNCE_MS    // 500
RESIZE_DEBOUNCE_MS  // 150
SELECTION_DEBOUNCE_MS // 200
```

**EPUB extraction selectors:**
```js
BLOCK_SEL   // "h1,h2,...,p,div,blockquote,li,pre,dd,dt,figure,figcaption,table,img"
SKIP_SEL    // "script,style,nav,header,footer,aside,form"
INLINE_TAGS // Set of tag names treated as inline (b, strong, i, em, a, span, ...)
SAFE_ATTRS  // Per-tag allowlist of safe HTML attributes
EXTRACTABLE_BLOCK_TYPES    // every block type the extractor emits — the single
                           // enumeration all three modes' word counting derives from
EXTRACTABLE_BLOCK_SELECTOR // ".blk-p, .blk-h1, ..." derived from the above (TTS)
REFINE_HIGH_MATCH_THRESHOLD // 0.8 — position text-snap high-confidence tier
```

**Default preferences:**
```js
DEFAULT_PREFS  // { v:1, theme:'dark', font:'serif', size:19, weight:'regular',
               //   images:true, notePopovers:true, lineHeight:1.62,
               //   margin:'normal', paraSpacing:'indent', align:'justify',
               //   hyphens:true, selection:true, brightness:1, warmth:0,
               //   pageAnim:'slide', layout:'paginated', columns:'auto' }
```

**Settings wiring (`SETTINGS` array):**  
Declarative array that maps segmented-button IDs to preference keys and controls whether a change triggers repagination.

---

### `js/core/events.js`

Minimal pub/sub event bus. Used as a base class for `PrefsManager` and as a standalone event channel.

**Class: `EventBus`**

```js
on(event: string, fn: Function): () => void
  // Subscribe to an event. Returns an unsubscribe function.

off(event: string, fn: Function): void
  // Unsubscribe a specific listener.

emit(event: string, ...args): void
  // Fire all listeners for this event, then all wildcard ('*') listeners.
  // Wildcard listeners receive (eventName, ...args).
```

**Wildcard support:** A listener registered as `bus.on('*', fn)` receives every event — useful for debugging.

---

### `js/core/prefs.js`

Manages user preferences for one scope (general, reader, rsvp, or tts). Extends `EventBus` so callers can subscribe to individual key changes.

**Class: `PrefsManager extends EventBus`**

**Constructor options:**
```js
{
  storageKey: string   // localStorage key, e.g. 'reader:prefs'
  defaults: object     // Default values (from constants.js)
  version: number      // Schema version, written as data.v
}
```

**Methods:**
```js
load(): void
  // Read from localStorage. Merges saved values over defaults.
  // Clamps size to [MIN_SIZE, MAX_SIZE].

save(): void
  // Write current data to localStorage as JSON.

set(key: string, value: any): void
  // Update a preference. If the value changed, emits both:
  //   emit(key, newValue, oldValue)
  //   emit('change', key, newValue, oldValue)

get(key: string): any
  // Return the current value of a preference key.

applyAll(): void
  // Emit every key with its current value — used on init to trigger
  // all listeners and apply the saved state to the DOM.
```

---

### `js/core/state.js`

`ReaderState` — the state container for the paginated reader. A plain object wrapper with no logic.

**Class: `ReaderState`**

```js
{
  page: number           // Current page index (0-based)
  total: number          // Total page count
  stride: number         // Width of one page including gap (px)
  bookId: string         // Identifier for the loaded book
  docModelBuilt: boolean // Whether buildDocModel() has been called
  isScrollMode: boolean  // true when layout='scroll'
  sectionBlockStart: []  // sectionIndex → first block index in that section

  doc: {
    words: Array<{
      node: Text,        // DOM text node containing this word
      start: number,     // Start offset within node.nodeValue
      end: number,       // End offset within node.nodeValue
      block: number,     // Index into doc.blocks[]
      section: number    // Index into doc.sections[]
    }>,
    blocks: Array<{
      el: Element,       // The .blk DOM element
      type: string,      // Tag name (lowercase): 'p', 'h2', etc.
      section: number,   // Index into doc.sections[]
      wordStart: number, // First word index for this block
      wordEnd: number    // One past last word index
    }>,
    sections: Array<{
      href: string,      // EPUB spine href (data-href from .chap element)
      el: Element,       // The .chap DOM element
      wordStart: number, // First word index
      wordEnd: number    // One past last word index
    }>,
    text: string,        // Full concatenated text (words joined by spaces)
    wordCharStart: []    // charOffset for each word in doc.text
  }
}
```

---

### `js/core/page-cache.js`

Persistence layer for per-book page counts (windowed mode only). Pure module — no DOM access.

**Exports:**
```js
PAGE_KEY_PREFIX   // 'book:pages:'

loadPageCache(bookId)
  // Read { v, sig, counts } from localStorage. Returns null on miss, version
  // mismatch, parse error, or missing bookId. Shape: { v:1, sig:string, counts:number[] }

savePageCache(bookId, sig, counts)
  // Write { v:1, sig, counts } to localStorage. Silently ignores errors (quota, etc.).
```

Stored entry shape:
```js
{ v: 1, sig: string, counts: number[] }
// sig  — layout signature (see PageCounter.computeSignature)
// counts[i] — exact page count for section i under that layout
```

---

### `js/core/position.js`

The shared, mode-independent position layer. See [STATE.md → Canonical Position System](STATE.md#canonical-position-system) for the full design.

- `deriveBookId(urlId, metaTitle, fileName)` — one book identifier used by every mode.
- `buildPosition(sections, totalWords, globalOrd)` → canonical position object.
- `resolvePosition(pos, sections, totalWords)` → global word ordinal for this mode.
- `loadStoredPosition(bookId)` / `saveStoredPosition(bookId, pos)` — read/write `book:pos:{bookId}`.

### `js/core/book-session.js`

The mode-agnostic book pipeline, built **once** and shared by all modes.

- **`BookSession.fromBuffer(buffer, fileName, urlId, onProgress)`** — `async`.
  Detects the file format via `formats/registry.selectAdapter()`, calls
  `adapter.parse()` to produce the canonical IR (`ParsedBook`), derives
  `bookId`/`title`, and wraps the result. Returns a `BookSession`
  `{ sections, toc, bookId, fileName, title, buffer, format, capabilities }`.
  Throws a friendly "can't open .X files yet" error for unregistered formats.
- **`BookSession.fromSample(sections, bookId, title)`** — wraps an in-memory
  sections array (the built-in sample) as a session (`format:'sample'`,
  `FULL_CAPABILITIES`).
- **`session.dispose()`** — revokes the owned image blob URLs. The mode-switcher
  calls this only when a genuinely new book replaces the cached session; a mode
  switch reuses the same object, so blobs survive.
- **`splitWords(text)` / `countWords(text)`** — the single whitespace-word
  tokenisation rule shared by RSVP (`sectionsToText`) and TTS (`segmentContent`)
  so per-section word counts (the cross-mode position anchor) can't drift.

### `js/core/sw-register.js`

`registerServiceWorker()` — registers `sw.js` and shows a "reload to update"
toast when a new build is deployed. Used by `reader.html` and `library.html`.

### `js/core/storage.js`

Thin debounced wrapper that persists the Reader's canonical position via `js/core/position.js`.

**Class: `StorageManager`**

**Constructor:** `new StorageManager(state: ReaderState)`

**`savePos(getPosFn: () => CanonicalPosition | null)`** — debounced (500ms); writes `book:pos:{bookId}`.
**`flushPos(getPosFn)`** — immediate write (used on teardown).
**`restorePos(applyPosFn: (pos: CanonicalPosition) => void)`** — reads `book:pos:{bookId}` and applies it.

---

### `js/core/bookmarks.js`

Manages bookmarks for a single book. Backed by `localStorage`.

**Class: `BookmarkManager`**

**Key:** `reader:bookmarks:{bookId}`

**Bookmark object shape:**
```js
{
  id: string,         // UUID
  fraction: number,   // 0–1 position
  loc: LocatorObject, // Word-level locator { s, b, w }
  note: string,       // Optional user note
  createdAt: string   // ISO timestamp
}
```

**Methods:**
```js
load(bookId: string): void        // Load bookmarks for a specific book
save(): void                      // Persist current bookmarks
add(loc, fraction, note?): void   // Add a new bookmark
remove(id: string): void          // Remove by ID
getAll(): Bookmark[]              // Return all bookmarks
```

---

### `js/core/src-url.js`

**`validateBookSrcUrl(raw)`** → resolved absolute URL string, or `null`.
Guard for the `?src=` URL all three shells pass to `fetch()`: http(s) only, no
embedded credentials. Same-origin relative library paths resolve naturally.

---

### `js/core/archive-guard.js`

Decompression guards for archive formats (CBZ/CBR): per-entry (50 MB) and
total (500 MB) uncompressed caps via **`checkArchiveEntry(name, size, totals)`**
(throws a user-facing "file too large" error), **`isUnsafeArchivePath(name)`**
(`..` traversal), and **`withTimeout(promise, ms, message)`** around the CBR
WASM extraction.

---

### `js/core/safe-storage.js`

**`safeSetItem(key, value)`** — quota-aware `localStorage.setItem`: logs once
per session and, on quota error, prunes the `book:pos:*` entry with the oldest
`la` (last-accessed) timestamp via **`pruneLeastRecentPosition(excludeKey)`**
and retries. Owns `POS_KEY_PREFIX` (re-exported by `position.js`). Pruning is
strictly by recency, never by key name.

---

## `js/formats/` — Format Abstraction Layer

### `js/formats/types.js`

JSDoc `@typedef` declarations for the canonical IR: `Block`, `Section`, `TocEntry`,
`Capabilities`, `ParsedBook`, `FormatAdapter`. No runtime code — import for editor
and DevTools type information only. See also [`docs/ADDING-A-FORMAT.md`](ADDING-A-FORMAT.md).

---

### `js/formats/capabilities.js`

```js
CAPABILITY_KEYS          // ['reflow','richText','textStream','images','toc','search','pageFidelity']
makeCapabilities(overrides) → Capabilities  // all unspecified keys default false
FULL_CAPABILITIES        // all true
NO_CAPABILITIES          // all false
```

---

### `js/formats/detect.js`

Low-level byte-detection helpers (no adapter knowledge).

```js
magicBytes(buffer, n=64) → Uint8Array   // first n bytes of an ArrayBuffer
startsWith(bytes, sig)   → boolean       // bytes starts with sig array
ZIP_MAGIC                                // [0x50,0x4b,0x03,0x04] ('PK\x03\x04')
```

---

### `js/formats/registry.js`

The adapter registry. A leaf module — imports only `detect.js`.

```js
registerAdapter(adapter)                  // add to registry; sorted by priority
listAdapters() → FormatAdapter[]          // all registered adapters
getAdapterById(id) → FormatAdapter|null
selectAdapter(buffer, fileName, mime?) → FormatAdapter|null  // detect → first match
acceptString() → string                   // for <input accept="…">
supportedLabels() → string[]              // human names for error messages
```

---

### `js/formats/index.js`

Adapter barrel. Importing this module registers all format adapters (side-effect
imports). `book-session.js` and `mode-switcher.js` both import this. Currently
registers the EPUB and PDF adapters.

---

## `js/formats/epub/` — EPUB Format Adapter

### `js/formats/epub/epub-adapter.js`

The `FormatAdapter` for EPUB. Self-registers on import.

- **`epubAdapter.detect(bytes, fileName, mime)`** — ZIP magic + `.epub` extension/MIME.
- **`epubAdapter.loadLibs()`** — verifies `ePub` global (epub.js loaded via CDN).
- **`epubAdapter.parse(buffer, fileName, opts)`** → `ParsedBook` — runs the full
  EPUB pipeline: `ePub(buffer)` → `extractSections` → `resolveImageUrls` →
  `flattenToc`/`buildSyntheticToc` → returns `{ sections, toc, title, metaTitle,
  blobUrls, cover }`. All EPUB-specific logic is here; book-session knows none of it.
- **`epubAdapter.capabilities`** — `{ reflow:true, richText:true, textStream:true,
  images:true, toc:true, search:true, pageFidelity:false }`.

---

### `js/formats/epub/extractor.js`

Extracts readable content from EPUB spine items.

**`extractSections(epub, onProgress)`** → `Promise<{ sections, allImgUrls }>`  
Iterates the EPUB spine. For each item: loads the XHTML document, calls
`blocksFromDoc()` to produce `Block[]`, collects image URLs for later resolution.

**`blocksFromDoc(docOrEl, imgUrls, opts)`** → `Block[]`  
Walks the document with `BLOCK_SEL` / `SKIP_SEL` selectors. Produces `Block` objects
with `type`, `text`, `id`, `frag` (when `RICH_INLINE=true`), and `isTocHeading`.

**`sanitizeInline(srcNode)`** → `DocumentFragment`  
Recursively sanitises inline HTML, keeping only `INLINE_TAGS` with `SAFE_ATTRS`.

**`extractPlainText(epub, onProgress)`** → `Promise<{ text, chapters }>`  
Plain-text extraction path (legacy; RSVP now derives text from `session.sections`).

---

### `js/formats/epub/images.js`

Resolves image resources and detects book covers.

**`resolveImageUrls(imgEntries, book)`** → `Promise<string[]>` (created blob URLs)  
For each image entry, loads the image from the EPUB ZIP archive and creates a
`blob:` URL baked onto the block's `<img>` frag node.

**`findCoverImage(book)`** → `Promise<string | null>`  
4-strategy fallback: EPUB3 manifest `cover-image` property → EPUB2 `<meta name="cover">` → manifest key `cover` → filename fallback.

---

### `js/formats/epub/toc.js`

Builds and renders the Table of Contents.

**`flattenToc(nodes, depth, acc)`** → `TocEntry[]`  
Recursively flattens epub.js navigation items.

**`buildSyntheticToc(sections)`** → `TocEntry[]`  
Synthesises a TOC from `isTocHeading` blocks when the EPUB has no navigation doc.

**`buildTOC(epubToc, headingToc, tocListEl, sectionEls, goToPageFn, closePanelsFn, resolveHrefFn)`**  
Renders the TOC drawer DOM. Consumed directly by `reader-app.js` and `tts-app.js`.

**`resolveHref(href, content, sectionEls)`** → `Element | null`  
Maps a TOC href to a DOM element in the rendered content (attached or detached).

> **Note:** `buildTOC` and `resolveHref` operate on the rendered DOM and the neutral
> `toc[]` array — they are not inherently EPUB-specific. They live here for now
> (proximity to the adapter that produces the TOC entries). A future cleanup can
> promote them to `js/shared/`.

---

## `js/formats/pdf/` — PDF Format Adapter (Phase 1)

### `js/formats/pdf/pdf-adapter.js`

The `FormatAdapter` for PDF. Self-registers on import. PDFs have no semantic block
structure — only positioned text runs on fixed pages — so the adapter reconstructs
readable prose:

- **`pdfAdapter.detect(bytes, fileName, mime)`** — `%PDF` magic bytes / `.pdf`
  extension / `application/pdf` MIME.
- **`pdfAdapter.loadLibs()`** — lazy `import()`s pdf.js (ESM) from a CDN on first
  use and points `GlobalWorkerOptions.workerSrc` at the matching worker. A reader
  who only opens EPUBs never downloads it.
- **`pdfAdapter.parse(buffer, fileName, opts)`** → `ParsedBook`:
  1. **Pass 1** — for each page, group text items into lines by Y, join runs with
     gap-aware spacing; learn the body left-margin (most common line start) and the
     median line gap.
  2. **Pass 2** — merge lines into paragraphs. A new paragraph starts on a first-line
     indent (margin + threshold) **or** an enlarged vertical gap (~1.6× median) —
     covering PDFs that indent and PDFs that only add spacing. Trailing-hyphen words
     are de-hyphenated; pure-digit page-number lines are dropped.
  3. **Headings** — lines like `Chapter 12` / `— prologue —` (decoration-stripped,
     short, no prose punctuation) start a new `Section` and become an `h2`
     `isTocHeading` block; the TOC is synthesised from them. This makes windowing,
     the chapter chrome and the TOC drawer work exactly as for EPUB.
- **`pdfAdapter.capabilities`** — `{ reflow:true, richText:false, textStream:true,
  images:false, toc:true, search:true, pageFidelity:false }`.

Validated against the Babylon 5 *Passing of the Techno-Mages* PDFs in `books/`
(232–251 pages each): ~18–22 sections, ~3000–4300 paragraphs, 111k–119k words, full
chapter TOC. See [`docs/ADDING-A-FORMAT.md`](ADDING-A-FORMAT.md) for the adapter
contract this implements.

---

## `js/model/` — Document Model and Geometry

### `js/model/doc-model.js`

Builds a word-level index of the rendered DOM. Called once after the book is rendered into `.chap`/`.blk` elements.

**`buildDocModel(state: ReaderState, content: Element)`** → `void`

Mutates `state.doc` and `state.sectionBlockStart` in place.

**Algorithm:**
1. Query all `.chap` elements in `content` → one section entry per chapter
2. For each chapter, query all `.blk` elements → one block entry per block
3. For each block, use `TreeWalker` (text nodes only) to find every whitespace-delimited word
4. Record each word as `{ node, start, end, block, section }`
5. Build `doc.text` by joining all word strings with spaces
6. Build `doc.wordCharStart[]` mapping each word index to its character offset in `doc.text`

After `buildDocModel()`, the parallel arrays are the spine of all position, search, and TTS operations:
- `doc.words[i]` → the raw text node slice for word `i`
- `doc.blocks[i]` → the `.blk` element and word range for block `i`
- `doc.sections[i]` → the `.chap` element and word range for section `i`

---

### `js/model/locator.js`

Encodes and decodes portable reading positions. A locator is a compact object `{ s, b, w }` (section, block-within-section, word-within-block) that remains valid across layout changes (font resizes, window resizes, screen rotation).

**`toLocator(state, globalWordIndex)`** → `{ s, b, w } | null`  
Given a global word index, returns a locator:
- `s` — section (chapter) index
- `b` — block index within that section
- `w` — word index within that block

**`resolveLocator(state, loc)`** → `number` (global word index, or -1 on failure)  
Reverse operation. Clamps all indices to valid ranges — a locator always resolves even if the book structure changed slightly.

**`exportTokens(state)`** → `Token[]`  
Utility: exports all words as `{ text, kind }` tokens with `kind: 'break'` between blocks. Used when transferring content to RSVP mode.

---

### `js/model/geometry.js`

Maps between pages and word indices, and vice versa, using the column layout geometry.

**`getPageForWord(state, wordIndex)`** → `number`  
Given a word index, determine which page that word appears on:
1. Get the word's DOM text node
2. Get its parent `.blk` element's `offsetLeft`
3. Divide by `state.stride` (column width + gap) to get page index

**`getFirstWordOnPage(state, pageIndex)`** → `number`  
Binary search through `doc.words[]` to find the first word on a given page. Used after a page turn to update the current locator.

**`getFractionForPage(state, pageIndex)`** → `number` (0–1)  
`pageIndex / (state.total - 1)`

**`getWordForFraction(state, fraction)`** → `number`  
For scroll mode: maps a 0–1 scroll fraction to the nearest word index.

---

## `js/reader/` — Paginated Reader Sub-Modules

### `js/reader/page-counter.js`

Whole-book page-number engine for windowed mode. Measures each chapter's page count
once in an offscreen host during idle time, then caches the result by layout signature
so subsequent opens are instant (no measuring pass needed).

**Class: `PageCounter`**

**Constructor:** `new PageCounter(state, els, prefs)`

**`computeSignature()`** → `string`  
Builds a `|`-joined string from every layout input that affects page count: content
width/height, font, size, weight, line-height, margin, paragraph spacing, alignment,
hyphens, images, and resolved column count. Used to validate cached counts.

**`begin(onUpdate)`**  
Called from `finalizeLayout` once windowed. Resets `state.pageCounts`, records the
current chapter's exact count, then either adopts a matching cache entry (instant,
no measuring) or schedules the idle pass. `onUpdate` is called after each chapter
measurement so the UI label stays current.

**`recordCurrent()`**  
Captures `state.total` (the live chapter's exact page count) into `state.pageCounts[curChap]`.
Safe on the hot path — no DOM reads.

**`overall(curChap, pageInChap)`** → `{ page, total, approx }`  
Pure arithmetic over `state.pageCounts`. Unknown chapters are estimated via a
self-calibrating words/page ratio derived from already-measured chapters (fallback: 300 wpp).
`approx` is `true` while any chapter is still unmeasured; the `~` disappears once
the cache is complete.

**`invalidate(onUpdate?)`**  
Cancel any in-flight pass, clear counts, and `begin()` again with a fresh signature.
Called from `relayout()` when the signature changes (resize, font, column change).

**`destroy()`**  
Cancel the pass and remove the offscreen host. Called on teardown and on windowed→scroll switch.

---

### `js/reader/pagination.js`

The layout engine for the paginated reader.

**`columnLayout(vpW, prefs)`** → `{ cols, stride }`  
Exported pure helper: resolves the column count (1 or 2) and page stride (px) from
the viewport width and prefs. Shared by `PaginationEngine.setupColumns()` and
`PageCounter._measureChapter()` so both paths use the identical column rule.

**Class: `PaginationEngine`**

**`paginate()`**  
Calculates the number of pages and column stride:
1. Measures `content.scrollWidth` after CSS multi-column layout is applied
2. `total = scrollWidth / (viewportWidth + COLUMN_GAP)`
3. `stride = viewportWidth + COLUMN_GAP`
4. Stores both in `state`

**`paginateQuick(currentWordIndex)`**  
Re-runs pagination (e.g., after resize) while preserving the current reading word.

**`goToPage(n)`**  
Sets `content.style.transform = translateX(- n * stride)` to scroll the column layout to page `n`.

**`goToWord(wordIndex)`**  
Calls `getPageForWord()` then `goToPage()`.

**DOM detach optimization:**  
Before pagination calculations, the content element is temporarily detached from the DOM and re-attached after measurement, to avoid triggering multiple reflows.

---

### `js/reader/chrome.js`

Keeps the UI chrome (topbar, bottombar) in sync with reader state.

**Class: `ChromeManager`**

**`update()`**  
Called after every page turn. Updates:
- Chapter title in topbar (from `chapters` index)
- Page number display (e.g., "12 / 48")
- Progress bar position and `aria-valuenow`
- Word count display

**`setLoading(bool)`** / **`setError(msg)`**  
Toggle loading/error body classes and update the status message element.

---

### `js/reader/input.js`

Handles all user input for the reader: touch gestures, tap zones, and keyboard shortcuts.

**Class: `InputHandler`**

**Touch handling:**
- `touchstart` → record start coordinates
- `touchend` → if `|deltaX| > threshold` and `|deltaX| > |deltaY|` → horizontal swipe → page turn
- If `deltaX < threshold` → classify as a tap based on x-position relative to viewport width:
  - x < `TAP_ZONE_LEFT` → previous page
  - x > `TAP_ZONE_RIGHT` → next page
  - otherwise → toggle chrome visibility

**Keyboard handling:**

| Key | Action |
|-----|--------|
| `ArrowRight`, `Space`, `PageDown` | Next page |
| `ArrowLeft`, `PageUp` | Previous page |
| `Home` | First page |
| `End` | Last page |
| `Escape` | Close open panel |

**Synthetic click guard:**  
After a touch swipe, a `SYNTHETIC_CLICK_GUARD_MS` (600ms) window suppresses click events to prevent ghost taps.

---

### `js/reader/search.js`

Full-text search with CSS Highlight API integration.

**Class: `SearchManager`**

**`search(query)`**  
1. Converts `query` to lowercase
2. Searches `state.doc.text` (the concatenated word string) for all occurrences
3. Maps each match back to word indices using `doc.wordCharStart[]`
4. For each matching word, creates a `Range` spanning the word in the DOM
5. If `CSS.highlights` is available, registers all ranges as a named highlight (`reader-search`)
6. Builds a results list with context snippets (surrounding words)
7. Returns `{ hits: Range[], snippets: string[] }`

**`clearSearch()`**  
Removes all highlights and clears the results panel.

**`navigateToHit(index)`**  
Calls `goToWord()` with the word index of the selected hit.

---

### `js/reader/selection.js`

Floating toolbar that appears when the user selects text.

**Class: `SelectionManager`**

**Event flow:**
1. `selectionchange` event on `document` (debounced 200ms)
2. If selection is non-empty and within `.content`, show toolbar positioned near selection
3. Toolbar buttons: Copy (`navigator.clipboard.writeText`) and Dictionary lookup (opens OS dictionary or a web lookup)

**`hide()`**  
Called on page turn, tap, or when selection is cleared.

---

### `js/reader/footnotes.js`

Handles footnote and endnote references.

**Class: `FootnoteManager`**

Footnote references in EPUB are `<a>` elements with `epub:type="noteref"` or similar attributes. On tap:
1. Resolve the target href within the loaded book content
2. Find the target element in the rendered DOM
3. Show a popover near the tap point with the footnote content
4. Tapping outside or pressing `Escape` dismisses the popover

---

### `js/reader/chapters.js`

Builds a chapter index from the rendered DOM for the chrome manager.

**`buildChapterIndex(content)`** → `Array<{ title: string, wordStart: number }>`

Queries all `.chap` elements and, within each, looks for the first heading element. Returns a sorted array mapping chapter word positions to display titles. Used by `ChromeManager.update()` to show the current chapter name.

---

### `js/reader/focus-trap.js`

Accessibility utility that traps keyboard focus within an open modal or drawer.

**`trapFocus(container: Element, signal: AbortSignal)`**  
Adds a `keydown` listener that intercepts Tab and Shift+Tab. Focuses the first/last focusable descendant when the user tries to tab out. Automatically removes itself when the signal is aborted.

---

### `js/reader/template.js`

**`readerTemplate()`** → `string`  
Returns the HTML string for the reader shell — topbar, content area, bottombar, search panel, TOC drawer, bookmarks panel, selection toolbar. Inserted into `#app` by mode-switcher before `reader-app.js` init.

---

## `js/rsvp/` — RSVP Speed Reader Sub-Modules

### `js/rsvp/state.js`

State container for the RSVP mode.

**Class: `RsvpState`**

```js
{
  currentIdx: number          // Current token index in tokens[]
  playState: string           // 'playing' | 'paused' | 'loading' | 'error' | 'countdown'
  rampRemaining: number       // Ease-in words left (starts at RAMP_WORDS on resume)

  tokens: Token[]             // All tokens (words + paragraph break markers)
  paragraphs: number[][]      // Array of [startIdx, endIdx] per paragraph
  wordTokenIndices: number[]  // Indices in tokens[] that are word tokens (not breaks)
  tokenToWordOrdinal: number[]// Maps token index → word ordinal (for WPM calc)
  sentenceStarts: number[]    // Token indices that start a new sentence

  chapters: Array<{
    title: string,
    tokenIdx: number          // Token index where this chapter begins
  }>
}
```

---

### `js/rsvp/constants.js`

RSVP-specific tuning parameters.

```js
RAMP_WORDS           // 5 (number of words in ease-in ramp)
RAMP_FACTOR          // 0.5 (speed multiplier at start of ramp)
COUNTDOWN_MS         // 3000 (total countdown duration)
MIN_WPM / MAX_WPM    // 100 / 800
DEFAULT_WPM          // 300
PAUSE_PUNCT          // Characters that trigger a pause (. ! ? , ; :)
LONG_PAUSE_PUNCT     // Characters that trigger a longer pause (. ! ?)
PUNCT_MULT           // Duration multiplier for short-pause punctuation
LONG_PUNCT_MULT      // Duration multiplier for long-pause punctuation
PARA_MULT            // Duration multiplier for paragraph breaks
MAX_CHUNK            // 3 (maximum words per display chunk)
```

---

### `js/rsvp/tokenizer.js`

Converts flat text (or `exportTokens()` output from the reader) into the RSVP token array.

**`tokenize(sections)`** → `{ tokens, paragraphs, wordTokenIndices, tokenToWordOrdinal, sentenceStarts, chapters }`

For each section (chapter):
1. Split text by `\n\n` to identify paragraph boundaries → insert `{ kind: 'break' }` tokens
2. Split paragraph text into words (whitespace split)
3. For each word: compute ORP index (see below), record sentence start flag
4. Push `{ kind: 'word', text, orpIdx, isSentenceStart }` tokens

**Sentence detection:**  
A token starts a new sentence if the *previous* token's text ends with `.`, `!`, or `?` (with optional quotes/parens). Handles abbreviations by checking token length > 1 character.

**ORP index (`orpIndex(word)`):**  
The Optimal Reading Position is roughly 30–35% into the word. For a 5-letter word, that's index 1 (0-based). The function returns the 0-based character index within the word where the eye should land for fastest recognition.

---

### `js/rsvp/playback.js`

The timer loop that drives RSVP playback.

**Class: `PlaybackEngine`**

**`play()`**  
Sets state to `'playing'`. Starts the timer loop.

**`pause()`**  
Clears the timer. Rewinds by `REWIND_WORDS` (5) words to prevent disorientation on resume.

**`_tick()`** (internal)  
Called on each timer fire:
1. Collect the next chunk of word tokens (1, 2, or 3 based on chunk-size preference)
2. Emit `renderChunk` event with the collected tokens
3. Calculate display duration using `timing.js`
4. Schedule next tick via `setTimeout`
5. Advance `state.currentIdx`

**Countdown:**  
On resume after pause, shows a 3–2–1 countdown. Emits `countdown` events for the display to render.

**`seekTo(tokenIdx)`**  
Jump to a specific token index. If currently playing, restarts the tick loop from the new position.

---

### `js/rsvp/display.js`

Renders the current word(s) into the RSVP display area.

**Class: `RsvpDisplay`**

**`renderChunk(tokens)`**  
For each token in the chunk:
1. Split the word text at the ORP index
2. Render: `<span class="pre">` + `<span class="orp">` (the ORP character) + `<span class="post">`
3. The ORP character is aligned with a visual guide marker

**`updateContext(tokens)`**  
Renders the context line (current sentence) with the active word bolded.

**`updateEta(state, wpm)`**  
Calculates and displays estimated time remaining: `wordsLeft / wpm` in minutes and seconds.

**`showCountdown(n)`**  
Renders the countdown number (3, 2, 1) in the display area.

---

### `js/rsvp/input.js`

All input handling for RSVP mode.

**Class: `RsvpInput`**

**Touch:**
- Tap on word display → play/pause
- Swipe left/right (horizontal, small delta) → step word forward/back
- Swipe up/down → adjust WPM (+/- 25)

**Keyboard:**

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `ArrowLeft` | Step one word back |
| `ArrowRight` | Step one word forward |
| `ArrowUp` | Step one paragraph back |
| `ArrowDown` | Step one paragraph forward |
| `+` / `=` | WPM + 25 |
| `-` | WPM - 25 |
| `F` | Toggle fullscreen |

**Fullscreen:**  
Toggles `document.fullscreenElement`. In fullscreen, controls auto-hide after 3 seconds of inactivity.

---

### `js/rsvp/stats.js`

Tracks session statistics.

**Class: `StatsTracker`**

Tracks:
- `wordsRead` — incremented each tick
- `playMs` — accumulated play time (not counting pauses)
- `avgWpm` — rolling average

**`onTick(wordCount, ms)`**  
Called by the playback engine on each tick.

**`getStats()`** → `{ wordsRead, playMs, avgWpm }`

---

### `js/rsvp/training.js`

Automatically increments WPM to push reading speed upward.

**Class: `TrainingManager`**

**`onWordsRead(count)`**  
Called by the playback engine. When `count` reaches the training interval (e.g., every 500 words), increments WPM by the training step (e.g., 10 WPM).

**Configuration** (from RSVP prefs):
- `trainingEnabled: boolean`
- `trainingInterval: number` (words between increments)
- `trainingStep: number` (WPM per increment)

---

### `js/rsvp/template.js`

**`rsvpTemplate()`** → `string`  
Returns the HTML shell for RSVP mode — the ORP display area, context line, controls bar, WPM picker, chapter dropdown, TOC drawer, bookmarks panel.

---

## `js/tts/` — Text-to-Speech Sub-Modules

### `js/tts/engine.js`

Wrapper around the Web `SpeechSynthesis` API.

**Class: `TtsEngine`**

**`speak(sentence: string, onBoundary, onEnd)`**  
Creates a `SpeechSynthesisUtterance`, sets the selected voice and rate, and calls `speechSynthesis.speak()`. Registers:
- `boundary` event → calls `onBoundary({ charIndex, charLength })` for word highlighting
- `end` event → calls `onEnd()` to advance to the next sentence

**`pause()` / `resume()`**  
Wraps `speechSynthesis.pause()` / `speechSynthesis.resume()`.

**`cancel()`**  
Calls `speechSynthesis.cancel()` and clears the queue.

**`getVoices()`** → `SpeechSynthesisVoice[]`  
Returns available voices. Waits for `voiceschanged` event on first call if the list isn't yet populated.

**Voice selection:**  
Saves/restores voice by `voice.name` in TTS prefs. Falls back to the first available voice if the saved voice isn't found.

---

### `js/tts/highlighter.js`

Highlights the active text element during TTS playback.

**Class: `TtsHighlighter`**

**`highlightSentence(sentenceEl)`**  
Adds `.tts-active` class to the sentence element. Scrolls it into view.

**`highlightWord(sentenceEl, charIndex, charLength)`**  
Within the active sentence, wraps the character range `[charIndex, charIndex+charLength]` in a `<mark>` element. Handles text nodes split across multiple DOM nodes by walking the sentence's text nodes.

**`clearHighlight()`**  
Removes all `.tts-active` classes and `<mark>` wrappers.

---

### `js/tts/constants.js`

```js
DEFAULT_RATE      // 1.0 (speech rate)
MIN_RATE          // 0.75
MAX_RATE          // 2.0
HIGHLIGHT_MODES   // ['word', 'sentence', 'paragraph']
DEFAULT_HIGHLIGHT // 'sentence'
```

---

### `js/tts/sentences.js`

**`sentenceIndexForOrdinal(sentences, ord)`** → index of the last sentence
whose `wordOffset <= ord` (binary search). Floor semantics are deliberate: a
mid-sentence ordinal re-reads the containing sentence on return to TTS rather
than skipping ahead.

---

### `js/tts/template.js`

**`ttsTemplate()`** → `string`  
Returns the HTML shell for TTS mode — the reading surface, playback controls bar, voice/rate picker, chapter nav, TOC drawer.

---

## `js/bookmarks/panel.js`

Renders and manages the bookmarks panel UI.

**`renderBookmarks(bookmarks, onJump, onDelete)`** → `HTMLElement`  
Builds the bookmark list. Each entry shows the bookmark position (chapter + fraction), optional note, and a delete button.

**`addBookmarkForm(onAdd)`** → `HTMLElement`  
Form for adding a new bookmark with an optional note field.

---

## `js/settings/settings-screen.js`

The modal settings UI. Manages the full settings sheet across all modes.

**`openSettingsScreen(prefs, mode)`**  
Builds and shows the settings modal with tabs for the relevant mode's preferences.

**`closeSettingsScreen()`**  
Closes and removes the settings modal. Called by mode-switcher before mode switches.

**Internally, the screen handles:**
- Typography settings (font, size, line height, margins — reader only)
- Comfort controls (brightness, warmth — reader only)
- Layout settings (paginated/scroll, columns)
- RSVP settings (WPM, chunk size, training)
- TTS settings (voice, rate, highlight mode)
- Theme selection (all modes)

**Live preview:**  
Every control change immediately calls `prefs.set()`, which fires the EventBus and updates the live document — no "Apply" button needed.

---

## `js/shared/render.js`

Shared book rendering, used by the Reader and TTS (it was byte-identical in both).

- **`renderSections(content, sections, { sectionEls, onHeading })`** — clears
  `content` and builds the `.chap` / `.blk` DOM tree from extracted sections.
  Clones each block frag (the session's `sections` are shared across modes, so
  the template must not be consumed). Calls `onHeading({ label, el, depth })` for
  each h1/h2. Does **not** annotate (callers run that in their own perf span).
- **`annotateInlineText(root)`** — wraps quoted speech and punctuation in
  `.inline-speech` / `.inline-punct` spans for per-theme colouring, preserving
  the rendered text exactly (word positions depend on it).

## `js/shared/search.js`

Shared full-text search, used by all three modes (it was copy-pasted into each).

- **`findHits(text, query, maxHits)`** — case-insensitive match offsets.
- **`indexForOffset(charStart, charOff)`** — **binary search** over the sorted
  char-start array (the fix for the old O(hits × words) linear scan).
- **`renderSearchResults(resultsEl, { text, charStart, query, onPick, onHits })`**
  — renders result buttons; `onPick(itemIndex, charOff)` fires on click. Reader
  maps the index → word → locator, RSVP → word ordinal, TTS → sentence index.

## `js/library/`

The bookshelf (`library.html`), folded into the module system (Phase 7).

- **`library.js`** — folder navigation, search, the detail sheet, and theme
  cycling. Reading progress is read from the canonical `book:pos:{bookId}` key
  (`POS_KEY_PREFIX`); theme apply + meta colour reuse `base-reader-app`.
- **`data.js`** — `SAMPLE` library data, used until `data/library.json` exists.

Layout styles live in `css/library.css`; theme tokens come from the shared
`css/tokens.css`.

## `js/shared/picker.js`

A reusable scroll-snap value picker component.

**`createPicker({ values, initialValue, onChange, label })`** → `HTMLElement`

Creates a horizontally scrollable list of `values` with scroll-snap behavior. The center item is the selected value. Scrolling snaps to the nearest item and calls `onChange(newValue)`.

Used for:
- WPM picker in RSVP (100, 125, 150, ... 800)
- Speech rate picker in TTS (0.75×, 1×, 1.25×, ...)

---

## `js/test/selftest.js`

Self-test suite. Activated by `?selftest=1` URL parameter.

Runs unit tests for:
- `buildDocModel` — constructs a minimal DOM and verifies word/block/section arrays
- `toLocator` / `resolveLocator` — roundtrip tests with edge cases (first word, last word, empty sections)
- Geometry — page calculation with various stride values
- EPUB extraction — parses a minimal EPUB-like HTML fragment
- `EventBus` — on/off/emit/wildcard semantics
- `PrefsManager` — defaults, load/save, clamping
- Chapter index builder — verifies heading extraction

Results are rendered as a fixed overlay in the top-right corner with green/red pass/fail indicators and failure details.
