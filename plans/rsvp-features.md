# RSVP Reader Feature Implementation Plans

## Overview

14 features organized into 11 implementation units. Each unit is independently testable. No localStorage or cross-session persistence — all settings are session-scoped and reset on reload.

### Feature List (deduplicated)

| # | Feature | Unit |
|---|---------|------|
| 1 | Theme switcher (dark/light/sepia) | A |
| 2 | Font size & family selector | B |
| 3 | Chunk mode (1/2/3 words per flash) | C |
| 4 | ETA & filled progress bar | D |
| 5 | Speed adjust keys (+/- during play) | E |
| 6 | Chapter navigation | F |
| 7 | Context preview line | G |
| 8 | Session stats | H |
| 9 | WPM training ramp | H |
| 10 | Fullscreen mode | I |
| 11 | Touch gestures | J |
| 12 | Auto-pause on tab blur | J |
| 13 | Start paused on load | K |
| 14 | Countdown before resume | K |

---

## Unit A: Theme Switcher (Dark / Light / Sepia)

### Scope
- Three themes: Dark (current default), Light, Sepia
- All colors converted to CSS custom properties; theme class on `<body>`
- Default chosen by `prefers-color-scheme` media query (dark or light); sepia is manual only
- 3-button toggle row added to Settings panel
- `<meta name="theme-color">` updates dynamically on switch

### Implementation Details

**1. Define CSS custom properties.** Add a `:root` block with variables, then override per theme class:

```css
:root {
  --bg: #1a1a1a;
  --fg: #e8e8e8;
  --fg-muted: rgba(255,255,255,0.55);
  --accent: #e74c3c;
  --accent-glow: rgba(231,76,60,0.5);
  --accent-dim: rgba(231,76,60,0.22);
  --accent-border: rgba(231,76,60,0.7);
  --control-bg: rgba(255,255,255,0.06);
  --control-bg-hover: rgba(255,255,255,0.14);
  --control-bg-active: rgba(255,255,255,0.08);
  --border: rgba(255,255,255,0.14);
  --border-faint: rgba(255,255,255,0.07);
  --guide: rgba(255,255,255,0.18);
  --guide-tick: rgba(255,255,255,0.55);
  --tick-mark: rgba(255,255,255,0.22);
  --tick-major: rgba(255,255,255,0.45);
  --tick-label: rgba(255,255,255,0.5);
  --pause-dim: 0.55;
}
```

**2. Theme overrides:**

| Variable | Dark (default) | Light | Sepia |
|---|---|---|---|
| `--bg` | `#1a1a1a` | `#fafafa` | `#f4ecd8` |
| `--fg` | `#e8e8e8` | `#1a1a1a` | `#3b2e1a` |
| `--fg-muted` | `rgba(255,255,255,0.55)` | `rgba(0,0,0,0.50)` | `rgba(59,46,26,0.55)` |
| `--accent` | `#e74c3c` | `#c0392b` | `#a0522d` |
| `--accent-glow` | `rgba(231,76,60,0.5)` | `rgba(192,57,43,0.35)` | `rgba(160,82,45,0.35)` |
| `--accent-dim` | `rgba(231,76,60,0.22)` | `rgba(192,57,43,0.15)` | `rgba(160,82,45,0.18)` |
| `--accent-border` | `rgba(231,76,60,0.7)` | `rgba(192,57,43,0.5)` | `rgba(160,82,45,0.5)` |
| `--control-bg` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.04)` | `rgba(60,40,10,0.06)` |
| `--control-bg-hover` | `rgba(255,255,255,0.14)` | `rgba(0,0,0,0.08)` | `rgba(60,40,10,0.10)` |
| `--control-bg-active` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.06)` | `rgba(60,40,10,0.08)` |
| `--border` | `rgba(255,255,255,0.14)` | `rgba(0,0,0,0.12)` | `rgba(60,40,10,0.15)` |
| `--border-faint` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.06)` | `rgba(60,40,10,0.08)` |
| `--guide` | `rgba(255,255,255,0.18)` | `rgba(0,0,0,0.15)` | `rgba(60,40,10,0.18)` |
| `--guide-tick` | `rgba(255,255,255,0.55)` | `rgba(0,0,0,0.45)` | `rgba(60,40,10,0.50)` |

**3. Replace every hardcoded color** in the existing CSS with `var(--x)`. Systematic pass:

- `background: #1a1a1a` → `var(--bg)` (body, status-overlay)
- `color: #e8e8e8` → `var(--fg)` (body, nav-btn, action-btn)
- `color: #cfcfcf` → `var(--fg-muted)` with slight opacity tweak
- `#e74c3c` → `var(--accent)` (ORP, play button, slider thumb, picker pointer)
- `rgba(231,76,60,0.5)` → `var(--accent-glow)` (thumb shadow, play-btn shadow)
- `rgba(231,76,60,0.22)` → `var(--accent-dim)` (active grain-btn bg)
- `rgba(231,76,60,0.7)` → `var(--accent-border)` (active grain-btn border)
- `rgba(255,255,255,0.06)` → `var(--control-bg)` (grain-btn, action-btn)
- `rgba(255,255,255,0.14)` → `var(--control-bg-hover)` (active states)
- `rgba(255,255,255,0.08)` → `var(--control-bg-active)` (nav-btn bg)
- `rgba(255,255,255,0.16)` → `var(--border)` (nav-btn border)
- `rgba(255,255,255,0.07)` → `var(--border-faint)` (controls border-top)
- `rgba(255,255,255,0.18)` → `var(--guide)` (guide lines, slider track)
- `rgba(255,255,255,0.55)` → `var(--guide-tick)` (guide tick marks)
- `rgba(255,255,255,0.22)` → `var(--tick-mark)` (picker tick marks)
- `rgba(255,255,255,0.45)` → `var(--tick-major)` (picker major ticks)
- `rgba(255,255,255,0.5)` → `var(--tick-label)` (picker tick labels)
- `border: 2px solid #1a1a1a` on slider thumb → `var(--bg)`
- `#c0392b` on play-btn:active → derive from `--accent` or use a `--accent-pressed` var
- `rgba(232,232,232,0.3)` on `.word.break .orp` → `color: var(--fg); opacity: 0.3`

**4. Theme selector UI.** Add inside `<details class="settings">`, before the existing pickers:

```html
<div class="theme-row" role="group" aria-label="Theme">
  <button class="grain-btn is-active" type="button" data-theme="dark">Dark</button>
  <button class="grain-btn" type="button" data-theme="light">Light</button>
  <button class="grain-btn" type="button" data-theme="sepia">Sepia</button>
</div>
```

Reuse the `.grain-btn` / `.is-active` pattern already in use for granularity.

**5. JS logic:**

```js
let currentTheme = 'dark';

function applyTheme(name) {
  document.body.classList.remove('theme-dark', 'theme-light', 'theme-sepia');
  document.body.classList.add('theme-' + name);
  currentTheme = name;
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]').content = bg;
}

// Default from OS preference
if (window.matchMedia('(prefers-color-scheme: light)').matches) applyTheme('light');
else applyTheme('dark');
```

Wire up the theme buttons the same way granularity buttons are wired (click handler toggles `is-active`, calls `applyTheme`).

### Test Checklist
- [ ] Default appearance matches current dark theme exactly (no visual regression)
- [ ] Switch to Light → all backgrounds, text, controls, accent colors update coherently
- [ ] Switch to Sepia → warm tones throughout, ORP uses sienna
- [ ] Switch back to Dark → identical to original
- [ ] Guide lines, ticker marks, picker pointer all respect theme
- [ ] `<meta theme-color>` reflects current theme's `--bg`
- [ ] OS in light mode, first load → defaults to Light theme
- [ ] OS in dark mode, first load → defaults to Dark theme
- [ ] Play button glow/shadow adapts per theme
- [ ] Paused dim state (`opacity: 0.55`) looks correct in all themes
- [ ] Status overlay (loading/error) background matches theme

---

## Unit B: Font Size & Family Selector

### Scope
- Font size control for the word display area (range ~1.5rem to 6rem)
- Font family: 4 choices — System Sans, System Serif, Monospace (current default), OpenDyslexic
- Two new controls in Settings panel
- No effect on control panel fonts (only the RSVP word area and context line)

### Implementation Details

**1. CSS variables:**

```css
:root {
  --word-size: clamp(2.5rem, 8vw, 4.5rem);
  --word-font: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
.word-area {
  font-size: var(--word-size);
  font-family: var(--word-font);
}
```

**2. Font family stacks:**

| Label | `--word-font` value |
|---|---|
| Sans | system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif |
| Serif | "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif |
| Mono | ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace |
| Dyslexic | "OpenDyslexic", sans-serif |

**3. Font family selector.** 4-button row in Settings, same pattern as theme/granularity:

```html
<div class="font-row" role="group" aria-label="Font">
  <button class="grain-btn" type="button" data-font="sans">Sans</button>
  <button class="grain-btn" type="button" data-font="serif">Serif</button>
  <button class="grain-btn is-active" type="button" data-font="mono">Mono</button>
  <button class="grain-btn" type="button" data-font="dyslexic">Dyslexic</button>
</div>
```

**4. Font size picker.** Reuse the existing `createPicker()` factory:

```js
createPicker({
  stripId: 'fontSizeStrip', trackId: 'fontSizeTrack', valueId: 'fontSizeValue',
  min: 24, max: 96, step: 4, majorEvery: 16,
  initial: 48, // ~3rem at 16px base, close to current default
  onChange: (v) => {
    document.documentElement.style.setProperty('--word-size', v + 'px');
  },
});
```

HTML for the picker goes in Settings, below the font family row.

**5. OpenDyslexic loading.** Only load the font file when selected:

```js
let dyslexicLoaded = false;
function loadDyslexicFont() {
  if (dyslexicLoaded) return;
  const style = document.createElement('style');
  style.textContent = `@font-face {
    font-family: "OpenDyslexic";
    src: url("fonts/OpenDyslexic-Regular.woff2") format("woff2");
    font-weight: normal; font-style: normal; font-display: swap;
  }`;
  document.head.appendChild(style);
  dyslexicLoaded = true;
}
```

Call `loadDyslexicFont()` when the "Dyslexic" button is clicked, before setting `--word-font`.

**6. ORP alignment is unaffected.** `orpIndex()` is character-count-based, not pixel-based. The CSS layout (`position: absolute`, `left: 35%`, `translateX(-50%)`) handles alignment regardless of font metrics. Guide lines are positioned the same way. No changes needed to JS rendering logic.

### Test Checklist
- [ ] Default: Mono font at current size — no visual regression
- [ ] Switch to Sans → word area updates, controls unchanged
- [ ] Switch to Serif → word area updates
- [ ] Switch to Dyslexic → font loads, word displays in OpenDyslexic
- [ ] Switch back to Mono → reverts cleanly
- [ ] Increase size to max → word area grows, guide lines stay aligned to ORP
- [ ] Decrease size to min → still legible, no overflow
- [ ] ORP red letter stays centered between guides at all sizes and fonts
- [ ] Long words don't overflow `.word-area` at max font size (verify with 15+ char words)
- [ ] Changing font mid-play doesn't cause flicker or misalignment
- [ ] Picker inside `<details>` lays out correctly on first open (relayout call)

---

## Unit C: Chunk Mode (1 / 2 / 3 Words per Flash)

### Scope
- Display 1, 2, or 3 words at a time in the RSVP display
- ORP calculated on the "pivot word" — the word the eye should fixate on
- Timing: one interval per chunk (duration based on slowest word in the chunk)
- 3-button toggle row in controls (not hidden in settings — this is a primary reading control)

### Implementation Details

**1. State:**

```js
let chunkSize = 1; // 1, 2, or 3
```

**2. Pivot word selection:**

| chunkSize | Pivot index within chunk |
|---|---|
| 1 | 0 (the only word) |
| 2 | 0 (first word — eye anchors left) |
| 3 | 1 (middle word) |

**3. Modify `play()` to collect chunks:**

```js
function play() {
  if (state !== STATE_PLAYING) return;
  if (currentIdx >= tokens.length) currentIdx = 0;
  clearPending();

  // Collect chunk: up to chunkSize word tokens. Stop early at paragraph breaks.
  const chunk = [];
  let scanIdx = currentIdx;
  while (chunk.length < chunkSize && scanIdx < tokens.length) {
    const tok = tokens[scanIdx];
    if (tok === PARAGRAPH_BREAK) {
      if (chunk.length === 0) {
        // Render the break itself as a solo pause
        chunk.push({ token: tok, idx: scanIdx });
        scanIdx++;
      }
      break; // Don't cross paragraph boundaries
    }
    chunk.push({ token: tok, idx: scanIdx });
    scanIdx++;
  }

  const pivotPos = Math.min(Math.floor(chunkSize / 2), chunk.length - 1);
  renderChunk(chunk, pivotPos);
  updateSeekUI();

  // Duration: base * max multiplier across all tokens in chunk
  const baseMs = 60000 / currentWPM;
  let maxMul = 0;
  for (const c of chunk) maxMul = Math.max(maxMul, durationMultiplier(c.token));
  let dur = baseMs * maxMul;

  if (rampRemaining > 0 && chunk[0].token !== PARAGRAPH_BREAK) {
    dur = dur / rampSpeedFactor();
    rampRemaining--;
  }

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    currentIdx = scanIdx; // advance past entire chunk
    play();
  }, dur);
}
```

**4. New `renderChunk()` function:**

```js
function renderChunk(chunk, pivotPos) {
  // Solo paragraph break
  if (chunk.length === 1 && chunk[0].token === PARAGRAPH_BREAK) {
    render(PARAGRAPH_BREAK);
    return;
  }

  wordEl.classList.remove('break');
  const pivotToken = chunk[pivotPos].token;
  const oi = orpIndex(pivotToken);

  // Build the three spans:
  // "before" = words before pivot + chars before ORP in pivot
  // "orp"    = the ORP char
  // "after"  = chars after ORP in pivot + words after pivot

  const wordsBefore = chunk.slice(0, pivotPos).map(c => c.token);
  const wordsAfter  = chunk.slice(pivotPos + 1).map(c => c.token);

  const bPart = pivotToken.slice(0, oi);
  const oPart = pivotToken.charAt(oi);
  const aPart = pivotToken.slice(oi + 1);

  const beforeStr = wordsBefore.length
    ? wordsBefore.join(' ') + ' ' + bPart
    : bPart;
  const afterStr = wordsAfter.length
    ? aPart + ' ' + wordsAfter.join(' ')
    : aPart;

  beforeEl.textContent = beforeStr;
  orpEl.textContent    = oPart;
  afterEl.textContent  = afterStr;
}
```

The existing `render()` stays for backward compat (used by seek, countdown, etc.) — `renderChunk` is only used in the `play()` loop.

**5. Seek/step behavior.** `currentIdx` still tracks individual token positions. When paused and stepping, the display shows single words (chunk=1 behavior). Chunk mode only applies during playback. This avoids complexity in the seek path and lets the user precisely position when paused.

**6. UI — 3-button toggle.** Place above the granularity row (or combine into the same row area):

```html
<div class="chunk-row" role="group" aria-label="Words per flash">
  <button class="grain-btn is-active" type="button" data-chunk="1">1 word</button>
  <button class="grain-btn" type="button" data-chunk="2">2 words</button>
  <button class="grain-btn" type="button" data-chunk="3">3 words</button>
</div>
```

Wire the same way as granularity buttons.

### Test Checklist
- [ ] Chunk=1: identical to current behavior (full regression pass)
- [ ] Chunk=2: two words shown, ORP on first word's optimal letter, advances by 2
- [ ] Chunk=3: three words shown, ORP on middle word, advances by 3
- [ ] Paragraph break always renders as solo "—" pause, never grouped with adjacent words
- [ ] End of text with <chunkSize words remaining: shows partial chunk correctly
- [ ] Seek slider position still accurate in all chunk modes
- [ ] Step buttons while paused: show single words regardless of chunk setting
- [ ] Resume from pause: chunk mode resumes from exact position
- [ ] Long words (15+ chars) in a 3-chunk: no overflow from `.word-area`
- [ ] Switching chunk size mid-play: next flash uses new size

---

## Unit D: ETA & Filled Progress Bar

### Scope
- Append estimated time remaining to the seek readout text
- Fill the left portion of the seek slider track with accent color proportional to progress
- Both update live during playback and during seek/scrub

### Implementation Details

**1. ETA calculation.** Add to `updateSeekUI()`:

```js
const wordsLeft = wordTokenIndices.length - wOrd - 1;
const etaSec = Math.max(0, Math.round(wordsLeft * 60 / currentWPM));
let etaStr;
if (etaSec >= 3600) {
  const h = Math.floor(etaSec / 3600);
  const m = Math.floor((etaSec % 3600) / 60);
  etaStr = '~' + h + 'h ' + m + 'm left';
} else if (etaSec >= 60) {
  const m = Math.floor(etaSec / 60);
  const s = etaSec % 60;
  etaStr = '~' + m + 'm ' + s + 's left';
} else {
  etaStr = '~' + etaSec + 's left';
}
```

Append to the existing readout: `seekReadoutEl.textContent = ... + '   ·   ' + etaStr;`

**2. Filled progress track.** CSS approach using a custom property:

```css
.seek-slider {
  --progress: 0%;
}
.seek-slider::-webkit-slider-runnable-track {
  background: linear-gradient(
    to right,
    var(--accent) var(--progress),
    var(--guide) var(--progress)
  );
}
.seek-slider::-moz-range-track {
  background: linear-gradient(
    to right,
    var(--accent) var(--progress),
    var(--guide) var(--progress)
  );
}
```

Note: `::-webkit-slider-runnable-track` and `::-moz-range-track` cannot be combined in one rule (browsers reject the entire rule if they don't recognize the other selector). Keep them separate.

**3. Update in `updateSeekUI()`:**

```js
const pct = (frac * 100).toFixed(1) + '%';
seekSliderEl.style.setProperty('--progress', pct);
```

**4. Edge cases:**
- At word 0: `--progress: 0%`, ETA shows full time
- At last word: `--progress: 100%`, ETA shows "~0s left"
- Empty text (no words): ETA hidden, progress 0%
- WPM changes mid-read: ETA recalculates on next `updateSeekUI()` call (already triggers on every word advance and every slider move)

### Test Checklist
- [ ] Start of book: full ETA displayed, slider track empty (no fill)
- [ ] At ~50%: slider half-filled with accent color, ETA roughly halved
- [ ] At end: slider fully filled, ETA shows "~0s left"
- [ ] Change WPM 200→600 mid-read → ETA drops immediately
- [ ] Scrub slider while paused → ETA and fill update in real time
- [ ] Very long book (50k+ words at 300 WPM) → ETA shows hours correctly
- [ ] Very short text (demo text) → ETA shows seconds correctly
- [ ] Progress fill color matches theme (uses `var(--accent)` and `var(--guide)`)
- [ ] Firefox: `::-moz-range-track` gradient renders correctly

---

## Unit E: Speed Adjust During Playback (Keyboard + Toast)

### Scope
- `+`/`=` increases WPM by 25 without pausing
- `-`/`_` decreases WPM by 25 without pausing
- Brief toast overlay shows new WPM for ~1s
- WPM picker display + scroll position sync to new value
- Works in both playing and paused states

### Rationale — "Do I need more than the slider?"
Yes. The WPM picker lives inside the Settings `<details>` panel. Adjusting it requires: (1) pause or break focus, (2) open settings, (3) scroll the picker. Keyboard shortcuts allow instant, non-disruptive speed tuning mid-read. The picker remains the right tool for initial setup; keys are for in-flight tweaks.

### Implementation Details

**1. `adjustWPM()` function:**

```js
function adjustWPM(delta) {
  const newVal = Math.max(100, Math.min(800, currentWPM + delta));
  if (newVal === currentWPM) return;
  currentWPM = newVal;
  // Sync the picker display and strip position
  document.getElementById('wpmValue').textContent = newVal;
  wpmPicker.scrollTo(newVal);  // needs picker to expose scrollToValue
  showToast(newVal + ' WPM');
}
```

This requires the `createPicker` factory to return `scrollTo` in its return object:

```js
return { relayout, scrollTo: (v) => scrollToValue(v, true) };
```

Store the WPM picker's return value: `const wpmPicker = createPicker({...})`.

**2. Keyboard handler additions.** In the existing `keydown` listener:

```js
if (e.key === '=' || e.key === '+') { e.preventDefault(); adjustWPM(+25); return; }
if (e.key === '-' || e.key === '_') { e.preventDefault(); adjustWPM(-25); return; }
```

Place before the arrow-key checks.

**3. Toast element.** Add to HTML (inside `.main-area`, above `.reader-wrap`):

```html
<div class="wpm-toast" id="wpmToast" aria-live="polite"></div>
```

CSS:

```css
.wpm-toast {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.4rem 1rem;
  background: var(--fg);
  color: var(--bg);
  font-size: 0.85rem;
  font-weight: 700;
  border-radius: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 300ms ease;
  z-index: 10;
}
.wpm-toast.show {
  opacity: 1;
}
```

**4. `showToast()` function:**

```js
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('wpmToast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); toastTimer = null; }, 1000);
}
```

**5. No restart needed.** The `play()` loop computes `baseMs = 60000 / currentWPM` fresh every word, so changing `currentWPM` takes effect on the very next word. No need to clear/restart the timer.

### Test Checklist
- [ ] Press `=` while playing at 400 → toast "425 WPM", next words visibly faster
- [ ] Press `-` three times → 325 WPM, toast updates each press
- [ ] At 800 WPM, press `+` → no change, no error
- [ ] At 100 WPM, press `-` → no change, no error
- [ ] WPM picker strip scrolls to match new value
- [ ] WPM display label updates to match
- [ ] Works while paused (adjusts for next play)
- [ ] Toast fades out after ~1s
- [ ] Rapid key presses: toast stays visible, resets its timer, shows latest value
- [ ] Toast respects theme colors (`var(--fg)` on `var(--bg)` inverted)

---

## Unit F: Chapter Navigation

### Scope
- During EPUB extraction, preserve chapter boundaries (one per spine item)
- Chapter dropdown `<select>` + prev/next buttons in the controls area
- Current chapter name in display; auto-updates during playback
- Jump to start of any chapter (pauses playback)
- Hidden when reading plain text (demo or pasted)

### Implementation Details

**1. Track chapters during `extractFullText()`.** Modify the function to return chapter metadata alongside the text:

```js
async function extractFullText(book) {
  const items = (book.spine && book.spine.spineItems) || [];
  if (!items.length) throw new Error('This EPUB has no readable spine items.');

  const parts = [];
  const chapterMeta = []; // { title: string, wordOffset: number }
  let totalWords = 0;

  for (let i = 0; i < items.length; i++) {
    const section = items[i];
    statusMsgEl.textContent = 'Parsing… ' + (i + 1) + ' / ' + items.length;
    try {
      const doc = await section.load(book.load.bind(book));
      const text = extractTextFromDoc(doc);
      if (text) {
        // Extract title: first <h1>-<h3>, or <title>, or fallback
        const title = extractChapterTitle(doc, i + 1);
        chapterMeta.push({ title, wordOffset: totalWords });
        totalWords += text.split(/\s+/).filter(Boolean).length;
        parts.push(text);
      }
    } catch (sectionErr) {
      console.warn('Skipping section:', section && section.href, sectionErr);
    } finally {
      if (section && typeof section.unload === 'function') {
        try { section.unload(); } catch (_) {}
      }
    }
  }
  return { text: parts.join('\n\n'), chapters: chapterMeta };
}
```

**2. `extractChapterTitle()` helper:**

```js
function extractChapterTitle(docOrEl, fallbackNum) {
  let root = docOrEl;
  if (docOrEl.nodeType === 9) root = docOrEl.body || docOrEl.documentElement;
  else if (docOrEl.tagName && docOrEl.tagName.toUpperCase() === 'HTML') {
    root = (docOrEl.querySelector && docOrEl.querySelector('body')) || docOrEl;
  }
  if (!root || !root.querySelector) return 'Chapter ' + fallbackNum;

  for (const sel of ['h1', 'h2', 'h3', 'title']) {
    const el = root.querySelector(sel);
    if (el) {
      const t = el.textContent.trim();
      if (t && t.length < 80) return t;
    }
  }
  return 'Chapter ' + fallbackNum;
}
```

**3. Module-level state:**

```js
let chapters = [];        // { title, tokenIdx } — tokenIdx filled after tokenize()
let isEpubLoaded = false; // controls chapter nav visibility
```

**4. After `tokenize()` in `loadText()`, map word offsets to token indices:**

```js
function loadText(text, chapterMeta) {
  // ... existing tokenize call ...
  chapters = (chapterMeta || []).map(ch => ({
    title: ch.title,
    tokenIdx: ch.wordOffset < wordTokenIndices.length
      ? wordTokenIndices[ch.wordOffset]
      : tokens.length - 1,
  }));
  isEpubLoaded = chapters.length > 0;
  updateChapterUI();
  // ... rest of existing loadText ...
}
```

**5. UI.** Add above the seek slider:

```html
<div class="chapter-nav" id="chapterNav" hidden>
  <button class="nav-btn" id="chPrev" type="button" aria-label="Previous chapter">◀</button>
  <select class="chapter-select" id="chSelect" aria-label="Chapter"></select>
  <button class="nav-btn" id="chNext" type="button" aria-label="Next chapter">▶</button>
</div>
```

CSS:

```css
.chapter-nav {
  display: flex;
  gap: 0.4rem;
  align-items: stretch;
  max-width: 40rem;
  margin: 0 auto;
}
.chapter-select {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0.4rem 0.6rem;
  background: var(--control-bg);
  color: var(--fg);
  font-family: inherit;
  font-size: 0.8rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

**6. `updateChapterUI()`:**

```js
function updateChapterUI() {
  const nav = document.getElementById('chapterNav');
  const sel = document.getElementById('chSelect');
  if (!isEpubLoaded || !chapters.length) {
    nav.hidden = true;
    return;
  }
  nav.hidden = false;
  // Populate select (only once per load)
  sel.innerHTML = '';
  chapters.forEach((ch, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = ch.title;
    sel.appendChild(opt);
  });
}
```

**7. Current chapter tracking.** In `updateSeekUI()`:

```js
if (isEpubLoaded && chapters.length) {
  const ci = currentChapterIndex();
  document.getElementById('chSelect').value = ci;
}
```

```js
function currentChapterIndex() {
  const pos = currentWordIdx(currentIdx);
  let ci = 0;
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (chapters[i].tokenIdx <= pos) { ci = i; break; }
  }
  return ci;
}
```

**8. Navigation handlers:**

```js
document.getElementById('chSelect').addEventListener('change', (e) => {
  e.stopPropagation();
  if (state === STATE_PLAYING) pause();
  const ci = parseInt(e.target.value, 10);
  if (chapters[ci]) seekTo(chapters[ci].tokenIdx);
});

document.getElementById('chPrev').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state === STATE_PLAYING) pause();
  const ci = currentChapterIndex();
  // If we're past the first word of current chapter, go to its start.
  // Otherwise go to previous chapter.
  const curTok = currentWordIdx(currentIdx);
  if (curTok > chapters[ci].tokenIdx && ci >= 0) {
    seekTo(chapters[ci].tokenIdx);
  } else if (ci > 0) {
    seekTo(chapters[ci - 1].tokenIdx);
  }
});

document.getElementById('chNext').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state === STATE_PLAYING) pause();
  const ci = currentChapterIndex();
  if (ci < chapters.length - 1) seekTo(chapters[ci + 1].tokenIdx);
});
```

### Test Checklist
- [ ] Load multi-chapter EPUB → dropdown appears with chapter titles
- [ ] Titles extracted from `<h1>` or `<h2>` (not generic "Chapter N" for well-formed EPUBs)
- [ ] Select "Chapter 5" → jumps to first word of chapter 5, paused
- [ ] Press next at chapter 3 → jumps to chapter 4 start
- [ ] Press prev mid-chapter → jumps to current chapter start
- [ ] Press prev at chapter start → jumps to previous chapter start
- [ ] At first chapter, press prev → stays (no crash)
- [ ] At last chapter, press next → stays
- [ ] Dropdown auto-updates as playback crosses chapter boundaries
- [ ] Demo text (no EPUB) → chapter nav hidden
- [ ] Load EPUB, then load plain text → chapter nav hides
- [ ] Chapter titles truncated with ellipsis if very long

---

## Unit G: Context Preview Line

### Scope
- Small text line below the RSVP word area showing the current sentence
- Current word highlighted (bold) within the sentence
- Toggleable on/off via Settings (default ON)
- Updates on every word advance

### Implementation Details

**1. HTML.** Add inside `.reader`, after `.word-area`:

```html
<div class="context-line" id="contextLine"></div>
```

**2. CSS:**

```css
.context-line {
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--fg-muted);
  text-align: center;
  max-width: 32rem;
  margin: 0.5rem auto 0;
  max-height: 3em; /* ~2 lines */
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.context-line b {
  color: var(--fg);
  font-weight: 700;
}
body.paused .context-line {
  opacity: 0.7;
}
```

**3. Sentence extraction logic.** New function `updateContext(tokenIdx)`:

```js
let lastSentenceIdx = -1; // cache: which sentence index is currently rendered
let sentenceSpans = [];   // cache: the <span>/<b> elements for current sentence

function sentenceIndexOf(tokenIdx) {
  // Binary search sentenceStarts for the sentence containing tokenIdx
  const wi = currentWordIdx(tokenIdx);
  return lastIndexAtMost(sentenceStarts, wi);
}

function updateContext(tokenIdx) {
  const contextEl = document.getElementById('contextLine');
  if (contextEl.hidden) return;

  if (tokens[tokenIdx] === PARAGRAPH_BREAK) {
    // Show nothing during a paragraph break (next sentence will appear on next word)
    contextEl.textContent = '';
    lastSentenceIdx = -1;
    return;
  }

  const si = sentenceIndexOf(tokenIdx);

  if (si !== lastSentenceIdx) {
    // Rebuild sentence HTML
    lastSentenceIdx = si;
    const start = sentenceStarts[si];
    const end = si + 1 < sentenceStarts.length ? sentenceStarts[si + 1] : tokens.length;

    let html = '';
    for (let i = start; i < end; i++) {
      if (tokens[i] === PARAGRAPH_BREAK) continue;
      const escaped = tokens[i].replace(/&/g, '&amp;').replace(/</g, '&lt;');
      if (i === tokenIdx) {
        html += '<b data-i="' + i + '">' + escaped + '</b> ';
      } else {
        html += '<span data-i="' + i + '">' + escaped + '</span> ';
      }
    }
    contextEl.innerHTML = html.trim();
  } else {
    // Same sentence — just move the bold
    const prevBold = contextEl.querySelector('b');
    if (prevBold) {
      const span = document.createElement('span');
      span.dataset.i = prevBold.dataset.i;
      span.textContent = prevBold.textContent;
      prevBold.replaceWith(span);
    }
    const target = contextEl.querySelector('[data-i="' + tokenIdx + '"]');
    if (target) {
      const b = document.createElement('b');
      b.dataset.i = target.dataset.i;
      b.textContent = target.textContent;
      target.replaceWith(b);
    }
  }
}
```

**4. Call `updateContext(currentIdx)` from `render()` (or immediately after each `render()` call in `play()` and `seekTo()`).

**5. Toggle.** Add in Settings:

```html
<label class="toggle-row">
  <input type="checkbox" id="contextToggle" checked>
  <span>Show context line</span>
</label>
```

```js
document.getElementById('contextToggle').addEventListener('change', (e) => {
  document.getElementById('contextLine').hidden = !e.target.checked;
  if (e.target.checked) updateContext(currentIdx);
});
```

CSS for toggle row:

```css
.toggle-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0; color: var(--fg-muted); font-size: 0.8rem; cursor: pointer;
}
```

### Test Checklist
- [ ] Play text → context line shows current sentence below the word area
- [ ] Current word is bold, rest of sentence is muted
- [ ] Word advances within same sentence → bold moves, no full rebuild (DOM efficient)
- [ ] Cross sentence boundary → full context line updates to new sentence
- [ ] Paragraph break → context line clears (or shows blank)
- [ ] Toggle OFF in settings → context line disappears
- [ ] Toggle ON → reappears with correct sentence and bold word
- [ ] Long sentence (20+ words) → clamps to 2 lines with overflow hidden
- [ ] Short sentence → centered, no extra space
- [ ] HTML entities in text (e.g., `&`, `<`) → escaped correctly, no XSS
- [ ] Doesn't interfere with ORP guide alignment above
- [ ] Works during seek/scrub (updates on `seekTo()`)

---

## Unit H: Session Stats & WPM Training Ramp

**Why grouped**: Training ramp triggers WPM changes that feed into session stats. Both track a running word counter. They share a session timer.

### Scope — Session Stats
- Track: words read, active play time, average effective WPM
- Compact stats bar at top of the reader area (always visible while reading)
- Resets on new text/EPUB load
- Manual "reset" in settings
- Session-only (no persistence)

### Scope — WPM Training Ramp
- Toggle in Settings: "Training mode"
- When ON: auto-bump WPM by `trainingIncrement` every `trainingInterval` words read
- Configurable: increment (default 10 WPM), interval (default 500 words), ceiling (default 600 WPM)
- Toast on each bump (reuses Unit E toast)
- Disabling mid-session freezes WPM at current value

### Implementation Details — Session Stats

**1. State:**

```js
let sessionWords = 0;
let sessionPlayMs = 0;
let sessionPlayStart = null; // timestamp when play started, null when paused
let statsInterval = null;
```

**2. Tracking play time.** Hook into state transitions:

- In `play()` (first call per resume): `if (!sessionPlayStart) sessionPlayStart = Date.now();`
- In `pause()`: `if (sessionPlayStart) { sessionPlayMs += Date.now() - sessionPlayStart; sessionPlayStart = null; }`
- Word counting: in the `setTimeout` callback inside `play()` where `currentIdx++` happens: `sessionWords++` (or `+= chunkSize` if chunk mode is implemented)

**3. Stats display.** HTML (inside `.main-area`, above `.reader-wrap`):

```html
<div class="stats-bar" id="statsBar">
  <span id="statWords">0 words</span>
  <span class="stats-sep">|</span>
  <span id="statTime">0:00</span>
  <span class="stats-sep">|</span>
  <span id="statAvg">— avg wpm</span>
</div>
```

CSS:

```css
.stats-bar {
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  gap: 0.6rem;
  padding: 0.35rem 0.9rem;
  font-size: 0.7rem;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  border-bottom: 1px solid var(--border-faint);
}
.stats-sep { opacity: 0.4; }
```

**4. Update function:**

```js
function updateStats() {
  const totalMs = sessionPlayMs + (sessionPlayStart ? Date.now() - sessionPlayStart : 0);
  const totalSec = Math.floor(totalMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  document.getElementById('statWords').textContent = sessionWords.toLocaleString() + ' words';
  document.getElementById('statTime').textContent = m + ':' + String(s).padStart(2, '0');
  document.getElementById('statAvg').textContent = totalMs > 2000
    ? Math.round(sessionWords / totalMs * 60000) + ' avg wpm'
    : '— avg wpm';
}
```

**5. Timer.** Start a 1s interval when playing, stop when paused:

```js
function startStatsTimer() {
  if (statsInterval) return;
  statsInterval = setInterval(updateStats, 1000);
}
function stopStatsTimer() {
  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  updateStats(); // one final update
}
```

Call `startStatsTimer()` when entering PLAYING state, `stopStatsTimer()` when leaving it.

**6. Reset.** In `loadText()` and via a "Reset stats" button in Settings:

```js
function resetStats() {
  sessionWords = 0; sessionPlayMs = 0; sessionPlayStart = null;
  updateStats();
}
```

### Implementation Details — Training Ramp

**1. State:**

```js
let trainingEnabled = false;
let trainingIncrement = 10;    // WPM added per bump
let trainingInterval = 500;    // words between bumps
let trainingCeiling = 600;     // max WPM training will push to
let trainingCounter = 0;       // words read since last bump (or since enabling)
```

**2. Hook into word-advance.** In the same place `sessionWords++` happens:

```js
if (trainingEnabled) {
  trainingCounter++;
  if (trainingCounter >= trainingInterval && currentWPM < trainingCeiling) {
    trainingCounter = 0;
    adjustWPM(trainingIncrement); // reuses Unit E's function + toast
  }
}
```

**3. Settings UI.** Add in Settings panel:

```html
<label class="toggle-row">
  <input type="checkbox" id="trainingToggle">
  <span>Training mode</span>
</label>
<div class="training-opts" id="trainingOpts" hidden>
  <!-- increment picker: min 5, max 50, step 5, majorEvery 10 -->
  <!-- interval picker: min 100, max 2000, step 100, majorEvery 500 -->
  <!-- ceiling picker: min 200, max 800, step 25, majorEvery 100 -->
</div>
```

Show/hide `.training-opts` when toggle changes. Three pickers using `createPicker()`.

**4. Interactions with manual speed changes:**
- Manual `adjustWPM` doesn't reset the training counter — only word-advance does
- If user manually exceeds `trainingCeiling`, training won't bump further (already capped)
- Disabling training keeps `currentWPM` wherever it is; re-enabling resets counter to 0

### Test Checklist — Stats
- [ ] Start reading demo text → stats bar shows incrementing word count
- [ ] Time display ticks up every second while playing
- [ ] Pause → timer stops, word count frozen, avg WPM shown
- [ ] Resume → timer continues from where it left off
- [ ] Avg WPM is reasonable (close to set WPM, slightly lower due to punctuation pauses)
- [ ] Load EPUB → stats reset to zero
- [ ] "Reset stats" button → zeros all counters
- [ ] Stats bar visible but unobtrusive (doesn't eat into reading space)

### Test Checklist — Training
- [ ] Enable at 400 WPM, increment 10, interval 100 → at 100 words, WPM becomes 410
- [ ] Toast appears: "410 WPM" (reuses Unit E toast)
- [ ] At 200 words → 420 WPM, etc.
- [ ] Reaches ceiling → stops bumping, no toast
- [ ] Disable mid-session → no more auto-increases, WPM stays
- [ ] Re-enable → counter resets, starts counting from 0
- [ ] Manual `+`/`-` keys work alongside training
- [ ] New file load → counter resets
- [ ] Training increment/interval/ceiling pickers work and take effect immediately

---

## Unit I: Fullscreen Mode

### Scope
- Fullscreen toggle via button and keyboard (`F` key)
- Uses browser Fullscreen API
- In fullscreen: controls auto-hide after 2s idle, reappear on interaction
- Graceful degradation if API unavailable

### Implementation Details

**1. HTML.** Add a fullscreen button in the transport row (after step-next):

```html
<button class="nav-btn" id="fullscreenBtn" type="button" aria-label="Toggle fullscreen">
  <span id="fsIcon">⛶</span>
</button>
```

**2. Toggle function:**

```js
function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
}
```

**3. Keyboard.** Add to `keydown` handler:

```js
if (e.key === 'f' || e.key === 'F') {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  e.preventDefault();
  toggleFullscreen();
  return;
}
```

**4. Auto-hide controls in fullscreen:**

```js
let fsHideTimer = null;

function fsShowControls() {
  document.body.classList.remove('fs-hide-controls');
  if (fsHideTimer) clearTimeout(fsHideTimer);
  if (document.fullscreenElement) {
    fsHideTimer = setTimeout(() => {
      document.body.classList.add('fs-hide-controls');
    }, 2000);
  }
}

document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) {
    document.getElementById('fsIcon').textContent = '⛶'; // or a "shrink" icon
    fsShowControls();
    document.addEventListener('pointermove', fsShowControls);
    document.addEventListener('pointerdown', fsShowControls);
  } else {
    document.body.classList.remove('fs-hide-controls');
    if (fsHideTimer) { clearTimeout(fsHideTimer); fsHideTimer = null; }
    document.removeEventListener('pointermove', fsShowControls);
    document.removeEventListener('pointerdown', fsShowControls);
  }
});
```

CSS:

```css
body.fs-hide-controls .controls {
  transform: translateY(100%);
  opacity: 0;
  pointer-events: none;
  transition: transform 400ms ease, opacity 400ms ease;
}
.controls {
  transition: transform 400ms ease, opacity 400ms ease;
}
```

**5. Hide button if API unavailable:**

```js
if (!document.fullscreenEnabled) {
  document.getElementById('fullscreenBtn').hidden = true;
}
```

### Test Checklist
- [ ] Click fullscreen button → enters fullscreen
- [ ] Press `F` → toggles fullscreen
- [ ] In fullscreen, idle 2s → controls slide down and disappear
- [ ] Move mouse → controls reappear, 2s timer resets
- [ ] Tap screen (touch) → controls reappear
- [ ] Press Escape → exits fullscreen, controls permanently visible
- [ ] Keyboard shortcuts still work while controls are hidden (Space, arrows, +/-)
- [ ] Exit fullscreen via button → works
- [ ] Browser without Fullscreen API → button hidden, no errors
- [ ] Controls transition is smooth (no janky jump)

---

## Unit J: Touch Gestures & Auto-Pause on Tab Blur

**Why grouped**: Both are input/event handlers. Tiny, no UI beyond a single settings toggle for auto-pause. No shared dependencies but both are small enough to test together.

### Scope — Touch Gestures
- Horizontal swipe on reader area: step forward/back (by current granularity)
- Vertical swipe on reader area: bump WPM +/- 25 (reuses `adjustWPM()` from Unit E)
- Minimum 40px displacement; dominant axis must exceed minor axis
- Does not interfere with tap-to-toggle-play

### Scope — Auto-Pause on Tab Blur
- When tab/window loses visibility while playing: auto-pause
- Does NOT auto-resume on return (user resumes manually)
- Toggleable in Settings (default ON)

### Implementation Details — Gestures

**1. Pointer tracking on `.reader-wrap`:**

```js
let swipeStart = null;
let swipeFired = false;

const readerWrap = document.getElementById('readerWrap');

readerWrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.controls') || e.target.closest('.status-overlay')) return;
  swipeStart = { x: e.clientX, y: e.clientY };
  swipeFired = false;
});

readerWrap.addEventListener('pointerup', (e) => {
  if (!swipeStart) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  swipeStart = null;

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const MIN = 40;

  if (ax > MIN && ax > ay) {
    // Horizontal swipe
    swipeFired = true;
    doStep(dx < 0 ? 1 : -1); // left = forward, right = back
  } else if (ay > MIN && ay > ax) {
    // Vertical swipe
    swipeFired = true;
    adjustWPM(dy < 0 ? 25 : -25); // up = faster, down = slower
  }
});
```

**2. Suppress click-to-toggle-play after a swipe.** Modify the existing `click` handler:

```js
document.addEventListener('click', (e) => {
  if (e.target.closest('.controls')) return;
  if (e.target.closest('.status-overlay')) return;
  if (swipeFired) { swipeFired = false; return; } // swipe already handled
  togglePlay();
});
```

### Implementation Details — Auto-Pause

**1. State:**

```js
let autoPauseEnabled = true;
```

**2. Visibility listener:**

```js
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === STATE_PLAYING && autoPauseEnabled) {
    pause();
  }
});
```

**3. Toggle in Settings:**

```html
<label class="toggle-row">
  <input type="checkbox" id="autoPauseToggle" checked>
  <span>Pause when tab hidden</span>
</label>
```

```js
document.getElementById('autoPauseToggle').addEventListener('change', (e) => {
  autoPauseEnabled = e.target.checked;
});
```

### Test Checklist — Gestures
- [ ] Swipe left (right-to-left) on reader → steps forward by current granularity
- [ ] Swipe right (left-to-right) → steps back
- [ ] Swipe up → WPM +25, toast shows (requires Unit E)
- [ ] Swipe down → WPM -25
- [ ] Short tap (< 40px movement) → toggles play/pause as before
- [ ] Diagonal swipe → no action (neither axis dominant enough)
- [ ] Swipe on control panel → no effect (events don't propagate)
- [ ] Desktop mouse drag 50px left → treated as swipe (works for mouse too)

### Test Checklist — Auto-Pause
- [ ] Playing, switch to another tab → reader paused on return
- [ ] Already paused, switch tabs → no state change
- [ ] Disable toggle → switching tabs does NOT pause
- [ ] Re-enable → auto-pause works again
- [ ] Playing, minimize window → pauses (visibility API fires)

---

## Unit K: Start Paused & Countdown Before Resume

**Why grouped**: Both affect the play/resume lifecycle. Countdown modifies `resume()`; start-paused modifies initial startup and EPUB load. Testing resume behavior naturally covers both.

### Scope — Start Paused
- On initial page load: show first word of demo text in PAUSED state, don't auto-play
- After EPUB load completes: show first word, PAUSED
- Toggleable in Settings (default ON)

### Scope — Countdown Before Resume
- On resume from pause: show "3 → 2 → 1" in the word area before text starts
- Each number visible for ~600ms (~1.8s total)
- Interruptible: tap/Space during countdown → cancel, return to paused
- Only on resume, NOT on initial play when "start paused" is OFF
- Toggleable in Settings (default ON)

### Implementation Details — Start Paused

**1. State:**

```js
let startPaused = true;
```

**2. Modify initial play call** at bottom of IIFE (currently line 1308: `play()`):

```js
if (startPaused) {
  setState(STATE_PAUSED);
  render(tokens[0]);
  updateSeekUI();
} else {
  play();
}
```

**3. Modify `loadText()`** — currently calls `setState(STATE_PLAYING); play();` at the end:

```js
if (startPaused) {
  setState(STATE_PAUSED);
  render(tokens[0]);
  updateSeekUI();
} else {
  setState(STATE_PLAYING);
  play();
}
```

**4. Toggle in Settings:**

```html
<label class="toggle-row">
  <input type="checkbox" id="startPausedToggle" checked>
  <span>Start paused on load</span>
</label>
```

### Implementation Details — Countdown

**1. State:**

```js
let countdownEnabled = true;
const STATE_COUNTDOWN = 'countdown'; // new transient state
let countdownTimer = null;
```

**2. Modify `resume()`:**

```js
function resume() {
  if (state !== STATE_PAUSED) return;
  currentIdx = manuallySeeked
    ? Math.min(currentIdx, tokens.length - 1)
    : rewindWords(currentIdx, 3);
  manuallySeeked = false;

  if (countdownEnabled) {
    runCountdown();
  } else {
    rampRemaining = 5;
    setState(STATE_PLAYING);
    play();
  }
}
```

**3. `runCountdown()` implementation:**

```js
function runCountdown() {
  setState(STATE_COUNTDOWN);
  // Remove paused dim but don't start advancing text
  document.body.classList.remove('paused');

  const nums = [3, 2, 1];
  let step = 0;

  function tick() {
    if (state !== STATE_COUNTDOWN) return; // cancelled

    if (step < nums.length) {
      wordEl.classList.remove('break');
      wordEl.classList.add('countdown');
      beforeEl.textContent = '';
      orpEl.textContent = String(nums[step]);
      afterEl.textContent = '';
      step++;
      countdownTimer = setTimeout(tick, 600);
    } else {
      // Done — start playing
      wordEl.classList.remove('countdown');
      countdownTimer = null;
      rampRemaining = 3; // shorter ramp since countdown re-oriented user
      setState(STATE_PLAYING);
      play();
    }
  }

  tick();
}
```

**4. Cancel on interrupt.** Modify `togglePlay()` and the click/space handlers:

```js
function togglePlay() {
  if (state === STATE_PLAYING) pause();
  else if (state === STATE_PAUSED) resume();
  else if (state === STATE_COUNTDOWN) cancelCountdown();
}

function cancelCountdown() {
  if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
  wordEl.classList.remove('countdown');
  setState(STATE_PAUSED);
  render(tokens[currentIdx]); // show the word we're positioned at
  updateSeekUI();
}
```

**5. Countdown styling:**

```css
.word.countdown .orp {
  color: var(--accent);
  font-size: 1.2em;
}
```

**6. `setState()` update.** Add STATE_COUNTDOWN handling:

```js
function setState(s) {
  state = s;
  document.body.classList.remove('paused', 'loading', 'error');
  if (s === STATE_PAUSED) document.body.classList.add('paused');
  else if (s === STATE_LOADING) document.body.classList.add('loading');
  else if (s === STATE_ERROR) document.body.classList.add('error');
  // STATE_COUNTDOWN and STATE_PLAYING: no class (full opacity)
}
```

### Test Checklist — Start Paused
- [ ] Page load: first word of demo text shown, PAUSED state, "Play" label
- [ ] Tap/Space → starts playing
- [ ] Load EPUB: after parsing, first word shown, PAUSED
- [ ] Toggle OFF: load another EPUB → auto-plays immediately
- [ ] Toggle ON: next EPUB load → starts paused

### Test Checklist — Countdown
- [ ] Pause then resume → see "3", "2", "1" then text starts
- [ ] Each number visible ~600ms (total ~1.8s)
- [ ] Numbers render in accent color, slightly larger
- [ ] Tap during countdown → cancels, returns to paused at correct word
- [ ] Space during countdown → cancels
- [ ] After countdown, ease-in ramp still applies (3 words at reduced ramp)
- [ ] Seek while paused, then resume → countdown at new position
- [ ] Toggle OFF → resume plays immediately (with full 5-word ramp)
- [ ] Countdown does NOT fire on initial play when "start paused" is OFF
- [ ] Context preview line (if implemented) doesn't show during countdown numbers

---

## Dependency Graph

```
No foundation unit required — all units are session-scoped.

Unit A (Themes)         ← establishes CSS variable system
  |
  +-- all other units use var(--x) colors

Unit E (Speed keys + toast)
  |
  +-- Unit J (Gestures) ← calls adjustWPM() for vertical swipe
  +-- Unit H (Training) ← calls adjustWPM() for auto-bump

Everything else is independent.
```

### Recommended Build Order

| Order | Unit | Rationale |
|-------|------|-----------|
| 1 | **A — Themes** | CSS variable system. Every subsequent unit writes new CSS using `var(--x)` instead of hardcoded colors. Doing this first means later units don't need a second pass. |
| 2 | **B — Fonts** | Small, pairs with the CSS refactor from Unit A. |
| 3 | **E — Speed keys + toast** | Creates `adjustWPM()` and `showToast()` — both reused by Units H, J. |
| 4 | **D — ETA + progress** | Quick win, no deps. |
| 5 | **G — Context preview** | Independent, high-value comprehension aid. |
| 6 | **K — Start paused + countdown** | Changes resume() flow. Best done before chunk mode touches play(). |
| 7 | **C — Chunk mode** | Most complex display change. Modifies play() and render(). |
| 8 | **F — Chapter nav** | Modifies EPUB load path, independent of display. |
| 9 | **I — Fullscreen** | Independent, pure UX. |
| 10 | **J — Gestures + auto-pause** | Requires Unit E's adjustWPM(). |
| 11 | **H — Stats + training** | Requires Unit E's adjustWPM() + toast. Most moving parts, best last. |

---

## Notes

- **No localStorage.** All settings reset on reload. This is intentional.
- All new CSS uses `var(--x)` (requires Unit A first, or hardcode initially and refactor).
- All UI additions go inside existing `.controls` or adjacent to `.reader` in `.main-area`.
- Settings toggles use a shared `.toggle-row` pattern (label + checkbox).
- Button groups reuse the existing `.grain-btn` / `.is-active` pattern.
- The `createPicker()` factory is reused for any new numeric pickers (font size, training params).
- `showToast()` from Unit E is the shared notification mechanism for Units H, J, and any future use.
- No external dependencies added. Everything is vanilla CSS/JS.
