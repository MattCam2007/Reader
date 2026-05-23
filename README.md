# Reader

> **Under Construction**
> The following files are not yet refactored and are excluded from current documentation and review scope:
> - `library.html` — Bookshelf UI (standalone monolith, pending modular extraction)

A browser-based EPUB reader with two reading modes: a **paginated reader** for traditional book-style reading and an **RSVP speed reader** for rapid serial visual presentation. No build step, no server required — open `reader.html` in any modern browser.

Ships with the opening of *Pride and Prejudice* as sample text. Load any `.epub` file to read your own books.

## Quick Start

```sh
# Option 1: open directly
open reader.html

# Option 2: serve locally (required for some browsers' module security)
python3 -m http.server
# visit http://localhost:8000/reader.html
```

The app loads in **paginated reader** mode by default. To start in RSVP mode, visit `reader.html?mode=rsvp` or use the mode-switch button in the toolbar.

To load a specific book from your library:
```
reader.html?src=books/path/to/book.epub&id=my-book-id
```

## Features

### Paginated Reader (`?mode=read`)
- **Multi-column pagination** with CSS columns and swipe/tap/keyboard navigation
- **Table of contents** from EPUB metadata or auto-generated from headings
- **Full-text search** with CSS Highlight API and context snippets
- **Text selection** toolbar with copy and dictionary lookup
- **Footnote popovers** for inline note references
- **Reading position persistence** via word-level locators (survives repagination)
- **Customizable typography**: 4 fonts (serif, sans, dyslexic, mono), adjustable size, line height, margins, paragraph spacing, text alignment
- **Comfort controls**: brightness dimming and warmth overlay
- **Scroll mode** alternative to paginated layout

### RSVP Speed Reader (`?mode=rsvp`)
- **ORP-aligned word display** with visual guide markers
- **Adjustable speed** from 100-800 WPM via scroll-snap picker
- **Smart pacing**: word-length scaling, punctuation pauses, paragraph breaks
- **Ease-in ramp** on resume (half-speed to full over 5 words)
- **Multi-word chunks** (1, 2, or 3 words at a time)
- **Context line** showing the current sentence with the active word bolded
- **Chapter navigation** with dropdown and prev/next buttons
- **Session stats**: words read, play time, average WPM
- **Training mode**: auto-increment WPM after configurable word intervals
- **Countdown timer** (3-2-1) before resume
- **Fullscreen mode** with auto-hiding controls

### Shared
- **4 themes**: dark, sepia, light, OLED black
- **EPUB support** with rich extraction (images, tables, footnotes) and plain-text extraction
- **Mode switching** with book and position transfer between reader and RSVP
- **Respects OS preferences**: `prefers-color-scheme` and `prefers-reduced-motion`
- **Mobile-first** with safe-area insets and touch-friendly controls
- **Self-test suite** (`?selftest=1`) for core module verification

## Architecture

```
reader.html              Unified entry point (25 lines)
index.html               Redirect to reader.html?mode=rsvp
library.html             Bookshelf UI (under construction)

js/
  mode-switcher.js       Orchestrates mode detection, switching, teardown
  reader-app.js          Paginated reader (exports init())
  rsvp-app.js            RSVP speed reader (exports init())
  core/                  Shared infrastructure
    constants.js           Font stacks, thresholds, settings metadata, defaults
    events.js              EventBus pub/sub
    prefs.js               PrefsManager with localStorage persistence
    state.js               ReaderState (paginated reader state container)
    storage.js             Position save/restore with word-level locators
  epub/                  EPUB processing
    extractor.js           Rich section extraction + plain text extraction
    images.js              Blob URL resolution + cover image detection
    toc.js                 TOC flattening, rendering, href resolution
  model/                 Document model and geometry
    doc-model.js           Word/block/section indexing from DOM
    locator.js             Portable position encoding (section, block, word)
    geometry.js            Page-to-word mapping, binary search, scroll tracking
  reader/                Paginated reader modules
    pagination.js          Column layout, page navigation, DOM detach optimization
    chrome.js              Topbar/bottombar updates, chapter labels
    input.js               Touch swipes, tap zones, keyboard shortcuts
    search.js              Full-text search with highlighting
    selection.js           Text selection floating toolbar
    footnotes.js           Footnote/endnote popovers
    chapters.js            Chapter index builder
    focus-trap.js          Modal focus trapping
    template.js            Reader HTML template
  rsvp/                  RSVP speed reader modules
    constants.js           RSVP-specific tuning parameters and defaults
    tokenizer.js           Text-to-token pipeline with sentence/paragraph indices
    timing.js              Duration calculation (length, punctuation, ramp)
    state.js               RsvpState with play state machine
    navigation.js          Step by word/sentence/paragraph, rewind
    playback.js            PlaybackEngine (timer loop, chunks, countdown)
    display.js             Word rendering, context line, seek UI, ETA
    input.js               Touch/keyboard/fullscreen input handling
    stats.js               Session statistics tracker
    training.js            Auto WPM ramp manager
    chapters.js            Chapter dropdown management
    template.js            RSVP HTML template
  shared/                Shared components
    picker.js              Scroll-snap picker factory
  test/
    selftest.js            Per-module test suite with UI reporter

css/
  tokens.css             Unified design tokens (4 themes, fonts, spacing)
  reader.css             Paginated reader imports
  rsvp.css               RSVP-specific styles
  components/
    chrome.css             Topbar, bottombar, toolbar, progress slider
    content.css            Reading surface, typography, tables, footnotes
    controls.css           Segmented buttons, settings sliders
    drawers.css            TOC drawer, settings sheet, search panel
    overlay.css            Loading/error, skip-link, coach hint, comfort
    picker.css             Scroll-snap picker component
    selection.css          Selection bar, search highlights

fixtures/
  sample.js              Pride & Prejudice sample text

plans/                   Implementation plans and investigations
```

## Controls

### Paginated Reader

| Action | Touch | Keyboard |
|--------|-------|----------|
| Next page | Tap right edge or swipe left | `→`, `Space`, `PageDown` |
| Previous page | Tap left edge or swipe right | `←`, `PageUp` |
| Toggle chrome | Tap center | |
| Open TOC | Toolbar button | |
| Open settings | Toolbar button | |
| Search | Toolbar button | |
| Close panel | Tap backdrop | `Escape` |

### RSVP Speed Reader

| Action | Touch | Keyboard |
|--------|-------|----------|
| Play/pause | Tap word area | `Space` |
| Step word | Swipe left/right | `←` / `→` |
| Step paragraph | | `↑` / `↓` |
| Adjust WPM | Swipe up/down | `+` / `-` |
| Fullscreen | Button | `F` |
| Scrub position | Drag slider | |
| Step (hold to fly) | Hold prev/next buttons | |

## Dependencies

Loaded from CDN at runtime — no install or build step:

- [epub.js](https://github.com/futurepress/epub.js) v0.3.93 — EPUB parsing and spine traversal
- [JSZip](https://stuk.github.io/jszip/) v3.10.1 — ZIP archive extraction for EPUB files

Self-hosted font:
- [OpenDyslexic](https://opendyslexic.org/) — dyslexia-friendly typeface (woff2, in css/)

## Browser Support

Requires ES modules, CSS custom properties, CSS multi-column layout, and `AbortController`. Tested on:
- Chrome/Edge 90+
- Firefox 90+
- Safari 15+
- Mobile Safari (iOS 15+)
- Chrome for Android

Optional enhancements (graceful fallback):
- CSS Highlight API (search highlighting)
- Fullscreen API
- `navigator.clipboard` (selection copy)

## Documentation

See the [`docs/`](docs/) directory for detailed documentation:

- [Architecture](docs/architecture.md) — System design, data flow, module relationships
- [Features](docs/features.md) — Detailed feature descriptions and how they work
- [Module Reference](docs/module-reference.md) — Per-file API documentation
- [CSS Architecture](docs/css-architecture.md) — Theming system, component styles, design tokens
- [Recommendations](docs/recommendations.md) — Issues found during code review and proposed fixes

## Development

### Running the self-test
```
reader.html?selftest=1
```
Runs ~40 assertions across core modules (doc-model, locator, geometry, extractor, events, prefs, chapters) with a visual pass/fail report overlay.

### URL parameters
| Parameter | Description | Example |
|-----------|-------------|---------|
| `mode` | `read` (default) or `rsvp` | `?mode=rsvp` |
| `src` | Path or URL to an EPUB file | `?src=books/book.epub` |
| `id` | Book identifier for position storage | `?id=my-book` |
| `title` | Display title override | `?title=My+Book` |
| `selftest` | Run self-test suite | `?selftest=1` |

## License

No license file is currently included. Add one if you intend to share or distribute this project.
