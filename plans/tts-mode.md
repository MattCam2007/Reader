# TTS Reading Mode — Implementation Plan

## Overview

Add a third reading mode (`?mode=tts`) using the Web Speech API (`SpeechSynthesis`). The UI follows the traditional/paginated reader style — the book text is displayed on screen with the currently-spoken sentence highlighted, while Android TTS reads aloud. This is a "read-along" experience: you see the page and hear the words.

---

## Architecture

```
reader.html (shell, unchanged)
  └── mode-switcher.js
        ├── ?mode=read  → reader-app.js
        ├── ?mode=rsvp  → rsvp-app.js
        └── ?mode=tts   → tts-app.js   ← NEW
```

### New Files

| File | Purpose |
|------|---------|
| `js/tts-app.js` | Main TTS app module, exports `init(options)` |
| `js/tts/template.js` | DOM template (reader-style layout) |
| `js/tts/engine.js` | SpeechSynthesis wrapper — speak, pause, resume, cancel, voice selection, boundary events |
| `js/tts/highlighter.js` | Tracks spoken position, highlights current sentence/word in the rendered text |
| `js/tts/controls.js` | Play/pause, skip sentence, speed, voice picker wiring |
| `css/tts.css` | TTS-specific styles (highlight, controls); imports `tokens.css` |

### Modified Files

| File | Change |
|------|--------|
| `js/mode-switcher.js` | Add `tts` case to `switchMode()`, add `TTS_BODY_CLASSES`, import `ttsTemplate` |
| `reader.html` | Add `<link rel="stylesheet" href="css/tts.css">` |
| `js/reader/template.js` | Add a TTS mode-switch button to the toolbar (alongside existing Speed button) |
| `js/rsvp/template.js` | Add a TTS mode-switch button (for switching from RSVP to TTS) |

---

## Detailed Design

### 1. Mode Switcher Integration

```js
// mode-switcher.js additions
import { ttsTemplate } from './tts/template.js';

const TTS_BODY_CLASSES = ['tts', 'loading', 'error', 'show-toc', 'show-settings', 'tts-playing'];

// In switchMode():
} else if (targetMode === 'tts') {
  document.body.classList.add('tts');
  appEl.innerHTML = ttsTemplate();
  const mod = await import('./tts-app.js');
  currentHandle = mod.init({ signal, onModeSwitch, onBookLoaded });
}
```

The TTS app exports the same handle interface as reader/RSVP:
```js
{ teardown(), getPositionFraction(), getBookId(), isBookLoaded(), seekFraction(f), loadFromBuffer(buf, fn) }
```

### 2. Template (`js/tts/template.js`)

Modeled on the reader template. Key differences:
- **No pagination controls** (no page-turn swipe, no progress range slider for pages)
- **Scroll layout only** — continuous vertical scroll, no columns
- **TTS control bar** at the bottom instead of page scrubber
- **Reuses reader chrome pattern**: topbar with title, bottombar with toolbar
- Settings panel is a subset of reader settings (theme, font, size, line height — no page-turn anim, no columns)

```
Template structure:
  .reader-comfort-overlay        (reuse)
  .tts-viewport                  (scroll container)
    .tts-content                 (rendered book text — same structure as reader)
  header.reader-topbar           (reuse reader topbar styling)
  footer.tts-bottombar
    .tts-transport               (play/pause, prev/next sentence, speed)
    .tts-toolbar                 (Contents, Display, Voice, Open, mode-switch buttons)
  .ui-backdrop
  nav.reader-toc                 (reuse TOC panel)
  section.tts-settings           (subset of reader settings)
  .tts-voice-panel               (voice selector — list of available voices)
  .reader-overlay                (loading/error)
```

### 3. TTS Engine (`js/tts/engine.js`)

Wraps the Web Speech API in a clean interface.

```js
export class TtsEngine {
  constructor({ onBoundary, onSentenceEnd, onEnd, onError })

  async loadVoices()          // returns voice list, handles async voiceschanged
  setVoice(voice)             // set SpeechSynthesisVoice
  setRate(rate)               // 0.5–3.0
  setPitch(pitch)             // 0.5–2.0

  speak(text, sentenceIndex)  // queue a SpeechSynthesisUtterance
  speakSentences(sentences, startIndex) // speak array of sentences sequentially
  pause()
  resume()
  cancel()

  get speaking()              // boolean
  get paused()                // boolean
}
```

**Key behaviors:**
- One `SpeechSynthesisUtterance` per sentence (natural pause between sentences)
- `onBoundary` event fires with `{ charIndex, charLength }` — used by highlighter for word-level tracking
- `onSentenceEnd(index)` fires when each sentence finishes — advance highlight
- `onEnd` fires when all queued sentences are done
- Chrome/Android bug workaround: some engines stop after ~15 seconds of continuous speech. Mitigation: speak one sentence at a time, queue the next in `onend`
- `loadVoices()` returns a Promise that resolves on `voiceschanged` (handles async voice loading on Android/Chrome)

### 4. Text Model for TTS

Reuse the existing EPUB extraction pipeline:
- `extractSections(book)` gives us rich blocks (same as reader mode)
- Render into `.tts-content` using the same `renderBook()` logic from reader-app (extract into shared util or duplicate the small function)

**Sentence segmentation** (new, lightweight):
- After rendering, walk the DOM text nodes in `.tts-content`
- Split into sentences using a simple regex: `/[.!?]+[\s]+|[.!?]+$/` with fallback on `\n`
- Build an array: `[{ text, startNode, startOffset, endNode, endOffset, blockEl }]`
- This array drives both TTS utterance order and highlight positioning

Why DOM-based rather than pre-split: we need the DOM node references for highlighting, and the rendered text is the source of truth (after sanitization, image removal, etc.).

### 5. Highlighter (`js/tts/highlighter.js`)

```js
export class TtsHighlighter {
  constructor(contentEl, viewportEl)

  setSentences(sentences)         // receives the sentence array
  highlightSentence(index)        // highlight full sentence, scroll into view
  highlightWord(sentenceIdx, charIndex, charLength)  // word-level highlight within sentence
  clearHighlight()
}
```

**Approach:**
- Sentence highlight: wrap the sentence's text range in a `<mark class="tts-sentence-hl">` (or use CSS `::highlight` if available, with fallback to mark elements)
- Word highlight: secondary `<mark class="tts-word-hl">` within the sentence
- Auto-scroll: when a new sentence is highlighted, `scrollIntoView({ behavior: 'smooth', block: 'center' })` on the sentence element
- On `clearHighlight()`, remove all mark wrappers (restore original text nodes)

**CSS highlight classes** (in `tts.css`):
```css
.tts-sentence-hl {
  background: var(--accent-dim);
  border-radius: 2px;
}
.tts-word-hl {
  background: var(--accent);
  color: var(--bg);
  border-radius: 2px;
}
```

### 6. Controls (`js/tts/controls.js`)

```js
export class TtsControls {
  constructor(engine, highlighter, els, prefs, signal)

  wire()    // bind all event listeners with signal
}
```

**Transport bar UI:**
```
[<< Prev] [ Play/Pause ] [Next >>]    Rate: [1.0x]
```

- **Play/Pause**: `engine.speak()` / `engine.pause()` / `engine.resume()`
- **Prev/Next sentence**: cancel current, seek to adjacent sentence, re-speak
- **Rate**: segmented buttons or picker (0.75x, 1.0x, 1.25x, 1.5x, 2.0x)
- Body class `tts-playing` toggles when speech is active (for UI state)

**Keyboard shortcuts:**
| Key | Action |
|-----|--------|
| Space | Play / Pause |
| ArrowRight | Next sentence |
| ArrowLeft | Previous sentence |
| ArrowUp | Increase rate |
| ArrowDown | Decrease rate |

### 7. Voice Panel (`js/tts/voice-panel.js` — optional, could be in controls.js)

- List available voices from `speechSynthesis.getVoices()`
- Group by language, show `[local]` badge for offline voices
- Persist selected voice name in prefs (`tts:prefs` → `voiceName`)
- On Android, prefer local voices (lower latency, work offline)

### 8. Preferences

New `PrefsManager` instance:
```js
const prefs = new PrefsManager({
  storageKey: 'tts:prefs',
  defaults: {
    theme: 'dark',
    font: 'serif',
    size: 19,
    lineHeight: 1.6,
    margin: 'normal',
    align: 'justify',
    images: true,
    brightness: 1,
    warmth: 0,
    // TTS-specific:
    rate: 1.0,
    pitch: 1.0,
    voiceName: '',        // empty = system default
    autoScroll: true,     // scroll to follow speech
    highlightMode: 'sentence',  // 'sentence' | 'word' | 'off'
  },
  version: 1,
});
```

### 9. CSS (`css/tts.css`)

```css
@import 'tokens.css';

/* TTS viewport — always scroll, no pagination */
.tts-viewport { ... }       /* similar to .reader-viewport but overflow-y: auto */
.tts-content { ... }        /* similar to .reader-content but single-column flow */

/* Highlights */
.tts-sentence-hl { ... }
.tts-word-hl { ... }

/* Transport bar */
.tts-bottombar { ... }      /* reuse reader-bottombar pattern */
.tts-transport { ... }
.tts-transport-btn { ... }  /* reuse reader-tool pattern */

/* Settings (reuse reader-settings-* classes where possible) */
.tts-settings { ... }
.tts-voice-panel { ... }

/* Body states */
body.tts .tts-viewport { display: block; }
body.tts-playing .tts-play-icon { display: none; }
body.tts-playing .tts-pause-icon { display: block; }
```

Import in `reader.html`:
```html
<link rel="stylesheet" href="css/tts.css">
```

### 10. Position Tracking & Transfer

- **Position fraction**: `currentSentenceIndex / totalSentences` mapped to word-fraction equivalent using sentence start word offsets
- **seekFraction(f)**: find the sentence closest to the target word fraction, scroll to it
- **Transfer from reader/RSVP**: receive word fraction, map to nearest sentence, begin there
- **Transfer to reader/RSVP**: export current word fraction from sentence position
- **localStorage**: save `tts:pos:{bookId}` = `{ sentenceIndex }` on sentence transitions

---

## Implementation Order

### Phase 1: Skeleton & Text Display
1. Create `js/tts/template.js` — reader-like layout with TTS transport bar
2. Create `css/tts.css` — viewport, content, transport bar styles (reuse reader patterns)
3. Create `js/tts-app.js` — minimal init: load EPUB, render text (copy renderBook from reader), display in scroll view
4. Update `mode-switcher.js` — add `tts` case
5. Update `reader.html` — add TTS CSS link
6. **Milestone**: can switch to `?mode=tts`, see book text in scrollable view

### Phase 2: Speech Engine
7. Create `js/tts/engine.js` — SpeechSynthesis wrapper
8. Sentence segmentation in `tts-app.js` (walk DOM after render)
9. Wire play/pause button to engine
10. **Milestone**: press play, hear the book read aloud

### Phase 3: Highlighting & Scroll
11. Create `js/tts/highlighter.js` — sentence/word highlight
12. Wire `onBoundary` → word highlight, `onSentenceEnd` → next sentence highlight
13. Auto-scroll to current sentence
14. **Milestone**: text highlights and scrolls as TTS reads

### Phase 4: Full Controls
15. Create `js/tts/controls.js` — prev/next sentence, rate control, keyboard shortcuts
16. Voice selector panel
17. Preferences (rate, pitch, voice, highlight mode)
18. Settings panel (theme, font, size — subset of reader)
19. **Milestone**: fully controllable TTS with settings

### Phase 5: Integration
20. Mode-switch buttons: add TTS button to reader and RSVP toolbars
21. Position transfer: word-fraction mapping between modes
22. Position persistence (localStorage)
23. TOC panel (reuse reader's TOC logic — jump to chapter = seek to that sentence)
24. **Milestone**: seamless switching between all 3 modes with position preservation

### Phase 6: Polish
25. Loading/error overlay states
26. Handle edge cases: no voices available, speech interrupted by phone call, app backgrounded
27. Android-specific testing (Chrome TTS quirks, voice availability)
28. Coach hint for TTS mode ("Press play to listen")
29. Selftest additions

---

## Known Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Chrome/Android stops speech after ~15s | Speak one sentence at a time, chain via `onend` |
| `onBoundary` not supported on all engines | Word-level highlighting is progressive enhancement; sentence highlight is the baseline |
| `getVoices()` returns empty array initially | Use `voiceschanged` event with Promise wrapper |
| Voice selection doesn't persist across sessions | Store voice by `name` string; re-match on load |
| Sentence splitting is imperfect | Use conservative regex; treat each `<p>` block as minimum unit |
| Large books → huge sentence array | Lazy segmentation: only segment visible/nearby chapters, expand as needed |

---

## Non-Goals (this release)

- Custom TTS engine / ML voice (use platform voices only)
- Offline TTS caching
- Synchronized word timestamps (beyond what `onBoundary` provides)
- SSML markup for better prosody
- Bookmarking / annotation while listening

---

## File Tree (post-implementation)

```
js/tts-app.js              ← TTS mode init (~300-400 lines)
js/tts/template.js         ← DOM template
js/tts/engine.js           ← SpeechSynthesis wrapper
js/tts/highlighter.js      ← sentence/word highlighting + auto-scroll
js/tts/controls.js         ← transport bar + keyboard shortcuts
css/tts.css                ← TTS-specific styles (imports tokens.css)
```
