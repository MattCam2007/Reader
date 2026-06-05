# Reader

A browser-based book reader with three reading modes. Open `reader.html` in any modern browser — no build step, no server, no install required.

Ships with the opening of *Pride and Prejudice* as sample text. Load a supported book file to start reading your own books — **EPUB and PDF** are supported (more formats coming).

PDFs are read via a text-layer reconstruction pipeline (`js/formats/pdf/`): it
rebuilds paragraphs and chapters from the page text so the paginated Reader, RSVP
speed-reader and TTS all work. Text-based PDFs work well; scanned/image-only PDFs
without a text layer are not supported. See `docs/ADDING-A-FORMAT.md` for how the
format layer works.

**Three ways to read:**
- **Reader** — paginated book-style reading with full typography controls (default)
- **RSVP** — speed reading with words flashed one at a time at your chosen pace
- **TTS** — listen with text-to-speech while the app highlights along

---

## Quick Start

```sh
# Option 1: open directly (works in most browsers)
open reader.html

# Option 2: serve locally (required for some browsers' ES module security)
python3 -m http.server
# then visit http://localhost:8000/reader.html
```

The app opens in **Reader** (paginated) mode. Switch modes anytime using the mode button in the toolbar, or go directly to a mode via URL:

```
reader.html           → Reader mode (default)
reader.html?mode=rsvp → RSVP speed reader
reader.html?mode=tts  → Text-to-speech
```

To load a specific EPUB:
```
reader.html?src=books/path/to/book.epub&id=my-book-id
```

---

## Install as an App (PWA)

Reader is a Progressive Web App — you can install it on your device like a native app, with its own icon and full-screen window.

### Chrome / Edge on Desktop
1. Serve the app over HTTP (e.g. `python3 -m http.server`)
2. Visit `http://localhost:8000/reader.html` in Chrome or Edge
3. Look for the **install icon** in the address bar (a computer with a down-arrow), or open the browser menu and choose **"Install Reader"** / **"Add to Home Screen"**
4. Click **Install** — Reader opens in its own standalone window from now on

### Chrome on Android
1. Open Reader in Chrome on your phone
2. Tap the **three-dot menu** (top right)
3. Choose **"Add to Home Screen"** or **"Install app"**
4. Tap **Add** — the Reader icon appears on your home screen

### Safari on iPhone / iPad
1. Open Reader in Safari
2. Tap the **Share button** (the box with an up-arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **Add** — Reader appears as an icon on your home screen

Once installed, Reader opens full-screen with no browser UI, just like a native app. Your reading progress and preferences are stored locally on your device.

---

## Features

### Reader — Paginated Mode (`?mode=read`)

The default mode. Text is laid out in columns like a book, and you turn pages by swiping or tapping.

**Navigation**
- Swipe left/right or tap the edges of the screen to turn pages
- The progress bar at the bottom shows where you are in the book
- Drag the progress bar thumb to jump to any position
- Open the Table of Contents from the toolbar to jump to any chapter

**Typography & Display**
- Choose from four fonts: Serif, Sans-serif, OpenDyslexic, Monospace
- Adjust text size (14–30px) with the size slider in settings
- Change line height, paragraph spacing, and text alignment (left or justified)
- Three margin widths: narrow, normal, or wide
- Toggle images on or off
- Switch between 1 and 2 columns, or let the app decide based on screen width

**Themes**
- Four themes: Dark, Light, Sepia, OLED Black
- Respects your OS dark/light preference by default
- Comfort controls in settings: reduce brightness or add a warm amber overlay

**Search**
- Tap the search icon in the toolbar to open full-text search
- Results are highlighted throughout the book, with context snippets in the results list
- Tap a result to jump to that location
- Uses the CSS Highlight API for crisp highlighting

**Text Selection**
- Tap and hold any text to select it
- A toolbar appears with options to copy or look up the selected text

**Footnotes**
- Footnote references appear as tappable superscripts
- Tapping shows the footnote content in a popover without leaving the page

**Bookmarks**
- Bookmark any page using the bookmark button in the toolbar
- Add optional notes to your bookmarks
- View and manage all bookmarks in the bookmarks panel

**Position Persistence**
- Your position is saved automatically using a word-level locator
- Position survives screen rotation, resizing, and font changes — not just page numbers

**Scroll Mode**
- Prefer continuous scrolling? Switch from paginated to scroll layout in settings

---

### RSVP — Speed Reader (`?mode=rsvp`)

Words are displayed one at a time in the center of the screen, aligned at the Optimal Reading Point (ORP) — the position where your eye naturally lands for fastest recognition.

**Playback**
- Tap the word display or press `Space` to play/pause
- A 3–2–1 countdown appears before playback resumes after a pause
- On resume, the speed ramps up from half-speed to full over the first 5 words (ease-in)

**Speed**
- Default: 300 WPM. Range: 100–800 WPM
- Adjust with the scroll-snap WPM picker (swipe up/down on it, or press `+`/`-`)
- Smart pacing: longer words display slightly longer; punctuation adds a natural pause; paragraph breaks add a longer pause

**Multi-word Chunks**
- Display 1, 2, or 3 words at a time — set this in RSVP settings
- Useful for training your brain to read in groups

**Context Line**
- Below the main word display, the current sentence is shown with the active word in bold
- Gives you context without slowing you down

**Navigation**
- Swipe left/right (or `←`/`→`) to step one word at a time
- `↑`/`↓` jumps by paragraph
- Chapter dropdown in the toolbar to jump to any chapter
- Scrub the progress slider to jump to any position in the book

**Session Statistics**
- Tracks words read, active play time, and average WPM for the current session
- Displayed in the stats bar during playback

**Training Mode**
- Automatically increases your WPM at a configurable interval (every N words)
- Gradually pushes your reading speed upward over a session

**Fullscreen**
- Tap the fullscreen button or press `F` to go fullscreen
- Controls auto-hide when fullscreen and not interacting

---

### TTS — Text-to-Speech (`?mode=tts`)

The app reads the book aloud using your device's built-in speech synthesis, highlighting the active text as it speaks.

**Playback**
- Tap Play to start — the app reads sentence by sentence
- Pause and resume at any point; playback resumes at the exact sentence where you stopped

**Highlighting**
- Three highlight modes: word-by-word, sentence-by-sentence, or paragraph-by-paragraph
- The active text scrolls into view automatically

**Voice & Speed**
- Choose any voice available on your device from the voice selector
- Adjust speech rate from 0.75× to 2×

**Navigation**
- Previous/next sentence buttons to step through the text
- Chapter navigation to jump to any section

**Position Persistence**
- Your playback position is saved automatically and restored when you return to the book

---

### Shared Features (All Modes)

- **4 themes**: Dark, Light, Sepia, OLED Black — switch anytime from the settings panel
- **EPUB support**: rich extraction preserving images, tables, footnotes, and formatting
- **Mode switching**: switch between Reader, RSVP, and TTS without losing your position — the book and position transfer automatically
- **Bookmarks**: save bookmarks with optional notes, backed by localStorage
- **OS preferences**: follows `prefers-color-scheme` and `prefers-reduced-motion` by default
- **Mobile-first**: safe-area insets, touch-friendly controls, swipe gestures throughout

---

## Controls Reference

### Reader (Paginated)

| Action | Touch | Keyboard |
|--------|-------|----------|
| Next page | Tap right edge / swipe left | `→`, `Space`, `PageDown` |
| Previous page | Tap left edge / swipe right | `←`, `PageUp` |
| Toggle toolbar | Tap center | |
| Open TOC | Toolbar button | |
| Open search | Toolbar button | |
| Open bookmarks | Toolbar button | |
| Open settings | Toolbar button | |
| Close any panel | Tap backdrop | `Escape` |

### RSVP (Speed Reader)

| Action | Touch | Keyboard |
|--------|-------|----------|
| Play / pause | Tap word display area | `Space` |
| Step one word back/forward | Swipe right / left | `←` / `→` |
| Step by paragraph | — | `↑` / `↓` |
| Adjust WPM | Swipe up/down on picker | `+` / `-` |
| Toggle fullscreen | Fullscreen button | `F` |
| Scrub position | Drag progress slider | |
| Hold-to-fly step | Hold prev / next buttons | |

### TTS (Text-to-Speech)

| Action | Touch | Keyboard |
|--------|-------|----------|
| Play / pause | Play button | `Space` |
| Previous sentence | Prev button | `←` |
| Next sentence | Next button | `→` |
| Open chapter list | TOC button | |

---

## URL Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `mode` | Starting mode: `read` (default), `rsvp`, or `tts` | `?mode=rsvp` |
| `src` | Path or URL to a book file (EPUB or PDF) | `?src=books/book.pdf` |
| `id` | Book identifier for position storage | `?id=my-book` |
| `title` | Display title override | `?title=My+Book` |
| `selftest` | Run the self-test suite | `?selftest=1` |

---

## Dependencies

No install required. Two libraries are loaded from CDN at runtime:

- [epub.js](https://github.com/futurepress/epub.js) v0.3.93 — EPUB parsing and spine traversal
- [JSZip](https://stuk.github.io/jszip/) v3.10.1 — ZIP archive extraction

Self-hosted font:
- [OpenDyslexic](https://opendyslexic.org/) — dyslexia-friendly typeface (woff2, in `css/`)

---

## Browser Support

Requires ES modules, CSS custom properties, CSS multi-column layout, and `AbortController`. Tested on:

- Chrome / Edge 90+
- Firefox 90+
- Safari 15+
- Mobile Safari (iOS 15+)
- Chrome for Android

Optional enhancements with graceful fallback when unavailable:
- CSS Highlight API — search result highlighting
- Fullscreen API — RSVP fullscreen mode
- `navigator.clipboard` — selection copy
- SpeechSynthesis API — TTS mode

---

## Developer Documentation

See the [`docs/`](docs/) directory for full developer documentation:

| Document | Contents |
|----------|----------|
| [Architecture](docs/ARCHITECTURE.md) | System design, directory structure, entry points, boot sequence |
| [Modules](docs/MODULES.md) | Every module documented: purpose, exports, key APIs |
| [Data Flows](docs/DATA-FLOWS.md) | Step-by-step flows for every major operation |
| [State & Storage](docs/STATE.md) | State structures, localStorage schema, locator system |
| [CSS Architecture](docs/CSS.md) | Theme system, design tokens, component file breakdown |

### Running the self-test

```
reader.html?selftest=1
```

Runs assertions across core modules (doc-model, locator, geometry, extractor, events, prefs, chapters) and shows a visual pass/fail report.

---

> **Note:** `library.html` (bookshelf UI) is not yet refactored into modular components and is excluded from current documentation scope.
