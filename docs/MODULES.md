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
MARGINS                 // { narrow, normal, wide } → CSS value
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

### `js/core/position.js`

The shared, mode-independent position layer. See [STATE.md → Canonical Position System](STATE.md#canonical-position-system) for the full design.

- `deriveBookId(urlId, metaTitle, fileName)` — one book identifier used by every mode.
- `buildPosition(sections, totalWords, globalOrd)` → canonical position object.
- `resolvePosition(pos, sections, totalWords)` → global word ordinal for this mode.
- `loadStoredPosition(bookId)` / `saveStoredPosition(bookId, pos)` — read/write `book:pos:{bookId}`.

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

## `js/epub/` — EPUB Processing

### `js/epub/extractor.js`

Extracts readable content from EPUB spine items. Handles two extraction modes: **rich** (preserves HTML structure for reader/TTS) and **plain** (raw text for RSVP tokenization).

**`extractSections(epub, signal)`** → `Promise<Section[]>`  
Main entry point. Iterates the EPUB spine. For each item:
1. Loads the XHTML document
2. Calls `extractSection(doc, href)` for rich content
3. Returns array of section objects

**`extractSection(doc, href)`** → `{ html: string, href: string, title: string }`  
Walks the document with `BLOCK_SEL` / `SKIP_SEL` selectors. For each block element:
- Checks if it has meaningful text content (non-whitespace)
- If `RICH_INLINE` is true, serializes inner HTML with `SAFE_ATTRS` attribute filtering
- Otherwise, extracts `textContent`

**`extractPlainText(epub, signal)`** → `Promise<PlainSection[]>`  
Used by RSVP mode. Extracts raw text without HTML structure:
- Returns `[{ text: string, title: string, href: string }]`
- Paragraph breaks are represented as `\n\n`

**Block selection logic:**
- `BLOCK_SEL` matches structural elements: headings, paragraphs, divs, lists, tables, figures
- `SKIP_SEL` excludes navigation, scripts, headers/footers
- Blocks with only whitespace or purely navigational content are dropped

---

### `js/epub/images.js`

Resolves image resources and detects book covers.

**`resolveImages(sections, epub)`** → `void` (mutates sections)  
For each section's HTML, replaces relative `src` attributes on `<img>` elements with `blob:` URLs. The blob URLs are created from the EPUB's resource archive and persist for the session.

**`detectCover(epub)`** → `Promise<string | null>`  
Attempts to find the book's cover image:
1. Checks the EPUB OPF manifest for `properties="cover-image"`
2. Falls back to items named `cover.*`
3. Returns a blob URL, or `null` if no cover found

---

### `js/epub/toc.js`

Builds and renders the Table of Contents.

**`extractToc(epub)`** → `Promise<TocEntry[]>`  
Reads `epub.navigation.toc` entries. Returns a flat array:
```js
[{
  label: string,   // Display text
  href: string,    // Target href
  depth: number    // Nesting depth (0 = top level)
}]
```

**`renderToc(entries, onNavigate)`** → `HTMLElement`  
Builds the TOC list DOM. Each entry gets a depth class for indentation. Clicking an entry calls `onNavigate(href)`.

**`resolveHref(href, sections)`** → `number`  
Maps a TOC entry href to a section index in the extracted sections array. Handles both exact matches and matches ignoring fragment identifiers (`#anchor`).

**`flattenToc(navItems, depth)`** → `TocEntry[]`  
Recursively flattens nested navigation items into the flat array format.

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

### `js/reader/pagination.js`

The layout engine for the paginated reader.

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

### `js/rsvp/timing.js`

Calculates the display duration for each word.

**`durationMultiplier(token)`** → `number`  
Returns a multiplier relative to a baseline of `60000 / wpm`:
- Base: `1.0`
- Length bonus: `+0.02 * max(0, word.length - 5)` (longer words show slightly longer)
- Trailing punctuation: if the word ends with a short-pause character, multiply by `PUNCT_MULT`
- If the word ends with a sentence-ending character, multiply by `LONG_PUNCT_MULT`

**`rampSpeedFactor(rampRemaining)`** → `number` (0.5–1.0)  
During ease-in, returns a speed factor < 1.0. At `rampRemaining = RAMP_WORDS`, returns `RAMP_FACTOR` (0.5). Interpolates linearly to `1.0` as `rampRemaining` approaches 0.

**Effective duration:**
```js
const baseMs = 60000 / wpm;
const ms = baseMs * durationMultiplier(token) / rampSpeedFactor(state.rampRemaining);
```

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

### `js/rsvp/navigation.js`

Step functions for RSVP navigation.

**`stepWord(state, delta)`** → `number` (new tokenIdx)  
Move forward/back by `delta` word tokens (skipping break tokens).

**`stepSentence(state, delta)`** → `number`  
Find the next/previous sentence boundary in `state.sentenceStarts[]`.

**`stepParagraph(state, delta)`** → `number`  
Find the next/previous paragraph break token.

**`rewindWords(state, n)`** → `number`  
Step back `n` word tokens from current position — called on pause to prevent disorientation.

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
