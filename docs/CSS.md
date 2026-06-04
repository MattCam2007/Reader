# CSS Architecture

This document covers the CSS organization of Reader: the design token system, the four themes, how component stylesheets are structured, and how the app handles responsive layout and accessibility.

---

## Overview

The CSS follows a three-layer model:

```
1. tokens.css         → Design tokens (CSS custom properties for everything)
2. components/*.css   → Component styles that consume the tokens
3. reader.css         → Mode stylesheet that @imports the pieces it needs
   rsvp.css
   tts.css
```

There are no build tools, no preprocessors, no PostCSS. Pure CSS with `@import` and custom properties.

---

## File Map

```
css/
├── tokens.css               Design tokens — themes (incl. --faint, --card-bg), typography, spacing
├── reader.css               Reader mode: @imports tokens + component files
├── rsvp.css                 RSVP mode: @imports tokens + component files
├── tts.css                  TTS mode: @imports tokens + component files
├── library.css              Bookshelf layout (links css/tokens.css for theme tokens)
└── components/
    ├── chrome.css           Topbar, bottombar, toolbar buttons, progress slider
    ├── content.css          Reading surface: typography, column layout, tables, footnotes
    ├── controls.css         Segmented buttons, range sliders, toggle switches
    ├── drawers.css          TOC drawer, settings sheet, search panel, bookmarks panel
    ├── overlay.css          Loading spinner, error state, coach hints, comfort overlay
    ├── picker.css           Scroll-snap picker component (WPM, rate)
    ├── selection.css        Text selection toolbar, search result highlights
    └── settings-screen.css  Settings modal tabs, sliders, pickers inside modal
```

### Which component files each mode imports

| Component | Reader | RSVP | TTS |
|-----------|--------|------|-----|
| chrome.css | ✓ | ✓ | ✓ |
| content.css | ✓ | — | ✓ |
| controls.css | ✓ | ✓ | ✓ |
| drawers.css | ✓ | ✓ | ✓ |
| overlay.css | ✓ | ✓ | ✓ |
| picker.css | ✓ | ✓ | ✓ |
| selection.css | ✓ | — | — |
| settings-screen.css | ✓ | ✓ | ✓ |

---

## Design Tokens (`tokens.css`)

All visual variables are defined as CSS custom properties on `:root` (or per-theme overrides on `body`). No magic numbers appear in component stylesheets.

### Color tokens

```css
:root {
  /* Background and surface */
  --bg:           /* main page background */
  --bg-surface:   /* cards, panels, drawers */
  --bg-elevated:  /* tooltips, popovers */
  --bg-overlay:   /* modal backdrops */

  /* Text */
  --fg:           /* primary text */
  --fg-muted:     /* secondary text, captions */
  --fg-subtle:    /* placeholder, disabled */

  /* Interactive */
  --accent:       /* primary action color */
  --accent-fg:    /* text on accent background */
  --accent-hover: /* hover state */

  /* Borders */
  --border:       /* standard border */
  --border-strong:/* emphasis border */

  /* Status */
  --error:        /* error message color */
  --success:      /* confirmation color */
}
```

### Typography tokens

```css
:root {
  --font-ui:       /* System UI font for chrome elements */
  --font-reader:   /* Set dynamically from prefs: FONT_MAP[prefs.font] */
  --size-reader:   /* Set dynamically from prefs: e.g., '19px' */
  --lh-reader:     /* Set dynamically: e.g., '1.62' */
  --weight-reader: /* 'normal' | '500' | 'bold' */
}
```

### Spacing tokens

```css
:root {
  --sp-xs:   /* 4px */
  --sp-sm:   /* 8px */
  --sp-md:   /* 16px */
  --sp-lg:   /* 24px */
  --sp-xl:   /* 32px */

  --radius-sm:   /* 4px */
  --radius-md:   /* 8px */
  --radius-lg:   /* 12px */
  --radius-full: /* 9999px (pills) */
}
```

### Safe-area tokens

```css
:root {
  --safe-top:    env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left:   env(safe-area-inset-left, 0px);
  --safe-right:  env(safe-area-inset-right, 0px);
}
```

Used throughout the chrome components to avoid content being hidden under notches or the iOS home indicator.

---

## Theme System

Themes are implemented as `body` class overrides. The base `:root` defines dark-theme values (the default). Each other theme overrides only what differs.

### Built-in themes

| Theme | Body class | Background | Text | Use case |
|-------|------------|------------|------|----------|
| Dark | `theme-dark` | `#1a1a1a` | `#e8e8e8` | Default; low eye strain at night |
| Light | `theme-light` | `#ffffff` | `#111111` | Bright environments |
| Sepia | `theme-sepia` | `#f4ecd8` | `#3b2f1e` | Warm, paper-like |
| OLED Black | `theme-oled` | `#000000` | `#e8e8e8` | OLED screens; saves battery |

### How themes are applied

1. On init: `prefs.applyAll()` fires the `theme` listener with the saved value
2. The listener:
   ```js
   document.body.classList.remove(...ALL_THEME_NAMES.map(n => `theme-${n}`))
   document.body.classList.add(`theme-${theme}`)
   document.querySelector('meta[name=theme-color]').content = THEME_COLORS[theme]
   ```
3. CSS picks up the new body class automatically via the overrides in `tokens.css`

### Theme override structure in tokens.css

```css
/* Default (dark) — on :root */
:root {
  --bg: #1a1a1a;
  --fg: #e8e8e8;
  --accent: #4a90e2;
}

/* Light theme override */
body.theme-light {
  --bg: #ffffff;
  --fg: #111111;
  --accent: #0055cc;
}

/* Sepia theme override */
body.theme-sepia {
  --bg: #f4ecd8;
  --fg: #3b2f1e;
  --bg-surface: #ede3c8;
  --accent: #8b6914;
}

/* OLED theme override */
body.theme-oled {
  --bg: #000000;
  --bg-surface: #0a0a0a;
}
```

### OS preference detection

```css
@media (prefers-color-scheme: light) {
  :root:not([data-theme-set]) {
    /* Apply light theme tokens if user hasn't set an explicit preference */
  }
}
```

The `data-theme-set` attribute is set by JavaScript when the user picks a theme explicitly, preventing OS preference from overriding the user's choice.

---

## Component Stylesheets

### `chrome.css`

Controls the topbar, bottombar, and all toolbar UI.

**Key selectors:**
```css
.topbar          /* fixed top bar: title + chapter name */
.bottombar        /* fixed bottom bar: progress slider + page counter */
.toolbar          /* button row inside topbar */
.toolbar-btn      /* individual icon button */
.progress-slider  /* <input type=range> at bottom */
```

**Chrome visibility:**
```css
body.chrome-hidden .topbar,
body.chrome-hidden .bottombar {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-100%); /* topbar slides up */
}
```

Toggled by adding/removing `chrome-hidden` from `document.body`.

**Safe areas:**
```css
.topbar {
  padding-top: calc(var(--sp-sm) + var(--safe-top));
}
.bottombar {
  padding-bottom: calc(var(--sp-sm) + var(--safe-bottom));
}
```

---

### `content.css`

The reading surface and typography.

**Column layout:**
```css
.content {
  column-count: var(--col-count, 1);
  column-gap: 40px;
  column-fill: auto;
  height: calc(100vh - var(--chrome-h));
  overflow: hidden;
  will-change: transform; /* GPU-accelerated page turn */
}
```

`--col-count` is set dynamically based on the `columns` pref and viewport width:
- `columns='1'` → always 1 column
- `columns='2'` → always 2 columns
- `columns='auto'` → 1 column on narrow screens, 2 on wide

**Typography:**
```css
.blk {
  font-family: var(--font-reader);
  font-size: var(--size-reader);
  line-height: var(--lh-reader);
  font-weight: var(--weight-reader);
  color: var(--fg);
}

/* Paragraph spacing modes */
body[data-para='indent'] .blk + .blk { text-indent: 1.5em; }
body[data-para='space'] .blk         { margin-bottom: 0.75em; }
body[data-para='both'] .blk          { margin-bottom: 0.5em; text-indent: 1em; }
```

**Heading styles:**
```css
.blk[data-type='h1'] { font-size: 1.5em; font-weight: bold; margin: 1.5em 0 0.5em; }
.blk[data-type='h2'] { font-size: 1.25em; font-weight: bold; margin: 1.2em 0 0.4em; }
/* h3–h6 progressively smaller */
```

**Images:**
```css
.blk img {
  max-width: 100%;
  height: auto;
  break-inside: avoid;
}
body.images-off .blk img { display: none; }
```

**Tables:**
```css
.blk table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
.blk th, .blk td { padding: 0.4em 0.6em; border: 1px solid var(--border); }
```

---

### `controls.css`

Segmented button controls (used for font, margin, alignment, etc.) and range sliders.

**Segmented buttons:**
```css
.seg { display: flex; border-radius: var(--radius-md); overflow: hidden; }
.seg-btn {
  flex: 1;
  padding: var(--sp-xs) var(--sp-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border);
}
.seg-btn[aria-pressed='true'] {
  background: var(--accent);
  color: var(--accent-fg);
}
```

**Range sliders** (font size, line height, brightness, etc.):
```css
input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  background: var(--border);
  border-radius: var(--radius-full);
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
}
```

---

### `drawers.css`

Side drawers and bottom sheets for TOC, settings, search, and bookmarks.

**Drawer structure:**
```css
.drawer {
  position: fixed;
  top: 0; right: 0;
  height: 100%;
  width: min(360px, 90vw);
  background: var(--bg-surface);
  transform: translateX(100%);
  transition: transform 0.25s ease;
  overflow-y: auto;
}
body.show-toc .drawer--toc    { transform: translateX(0); }
body.show-search .drawer--search { transform: translateX(0); }

.drawer-backdrop {
  position: fixed; inset: 0;
  background: var(--bg-overlay);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s;
}
body.show-toc .drawer-backdrop { opacity: 1; pointer-events: all; }
```

**Settings sheet** (slides up from bottom on mobile):
```css
.settings-sheet {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  max-height: 80vh;
  background: var(--bg-surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  transform: translateY(100%);
  transition: transform 0.3s ease;
  overflow-y: auto;
}
```

---

### `overlay.css`

Loading and error states, coach hints, and the comfort overlay.

**Loading state:**
```css
body.loading .loading-overlay { display: flex; }
.loading-overlay {
  position: fixed; inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  z-index: 100;
}
```

**Comfort overlay (brightness/warmth):**
```css
.comfort-overlay {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 50;
  background: transparent;
}
/* Set via JS: overlay.style.background = `rgba(0,0,0,${1-brightness})` */
/* Warmth: overlay.style.background = `rgba(255,180,50,${warmth})` */
```

**Coach hints** (one-time UI tips):
```css
.coach-hint {
  position: absolute;
  padding: var(--sp-sm) var(--sp-md);
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  animation: coach-in 0.2s ease, coach-out 0.2s ease 3s forwards;
}
```

---

### `picker.css`

The scroll-snap picker used for WPM (RSVP) and speech rate (TTS).

```css
.picker {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.picker::-webkit-scrollbar { display: none; }

.picker-item {
  scroll-snap-align: center;
  flex: 0 0 64px;
  text-align: center;
  padding: var(--sp-sm);
  font-size: 1.1em;
  color: var(--fg-muted);
  transition: color 0.15s, font-size 0.15s;
}
.picker-item.selected {
  color: var(--accent);
  font-size: 1.3em;
}
```

The visual "selected" indicator is implemented via an `IntersectionObserver` that detects which item is centered in the scroll container.

---

### `selection.css`

Text selection toolbar and search result highlighting.

**Selection toolbar:**
```css
.selection-bar {
  position: fixed;
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  display: flex;
  gap: var(--sp-xs);
  padding: var(--sp-xs);
  z-index: 200;
  /* Positioned via JS based on selection rect */
}
```

**Search highlights** (CSS Highlight API):
```css
::highlight(reader-search) {
  background-color: rgba(255, 200, 0, 0.35);
  color: inherit;
}
::highlight(reader-search-active) {
  background-color: rgba(255, 140, 0, 0.6);
}
```

---

## Responsive Layout

### Column auto-detection

```css
@media (min-width: 700px) {
  body[data-columns='auto'] .content {
    column-count: 2;
  }
}
body[data-columns='1'] .content { column-count: 1; }
body[data-columns='2'] .content { column-count: 2; }
```

The `data-columns` attribute on `body` is set from `prefs.columns`.

### Mobile-first approach

Base styles target single-column mobile layouts. Wider breakpoints add two-column support and larger chrome elements.

### Touch targets

All interactive elements have a minimum touch target of 44×44px (Apple HIG / WCAG guideline), implemented via minimum `padding` or explicit `min-height`/`min-width`.

---

## Page Turn Animations

```css
.content {
  transition: transform 0.2s ease;
}
body[data-anim='none'] .content {
  transition: none;
}
```

The `pageAnim` pref controls whether the slide animation is shown:
- `'slide'` → 200ms ease transform transition
- `'none'` → instant (better for `prefers-reduced-motion`)

```css
@media (prefers-reduced-motion: reduce) {
  .content {
    transition: none;
  }
}
```

---

## RSVP-Specific Styles (`rsvp.css`)

The RSVP display has its own distinct layout:

```css
/* ORP display area */
.rsvp-display {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40vh;
  font-size: var(--rsvp-font-size, 2.5em);
  font-family: var(--font-reader);
}

/* ORP alignment */
.rsvp-word {
  display: flex;
  align-items: baseline;
}
.rsvp-word .pre  { text-align: right; min-width: var(--orp-pre-width); }
.rsvp-word .orp  { color: var(--accent); font-weight: bold; }
.rsvp-word .post { }

/* Visual guide */
.orp-guide {
  position: absolute;
  width: 1px;
  background: var(--accent);
  height: 2em;
  /* Positioned to align with the ORP character */
}

/* Context line */
.rsvp-context {
  font-size: 0.9em;
  color: var(--fg-muted);
  text-align: center;
  padding: var(--sp-md);
  min-height: 2.5em;
}
.rsvp-context .active-word {
  color: var(--fg);
  font-weight: bold;
}
```

**Fullscreen controls auto-hide:**
```css
body.fs-hide-controls .rsvp-controls {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.5s;
}
```

---

## TTS-Specific Styles (`tts.css`)

```css
/* Sentence highlight */
.tts-sent.tts-active {
  background: rgba(var(--accent-rgb), 0.15);
  border-radius: var(--radius-sm);
}

/* Active word highlight (from highlighter.js mark element) */
.tts-sent.tts-active mark {
  background: var(--accent);
  color: var(--accent-fg);
  border-radius: 2px;
}
```

---

## CSS Custom Property Naming Conventions

| Prefix | Category | Examples |
|--------|----------|---------|
| `--bg` | Background colors | `--bg`, `--bg-surface`, `--bg-elevated` |
| `--fg` | Foreground/text | `--fg`, `--fg-muted`, `--fg-subtle` |
| `--accent` | Interactive accent | `--accent`, `--accent-fg`, `--accent-hover` |
| `--border` | Borders | `--border`, `--border-strong` |
| `--sp` | Spacing | `--sp-xs`, `--sp-sm`, `--sp-md`, `--sp-lg`, `--sp-xl` |
| `--radius` | Border radius | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-full` |
| `--font` | Font stacks | `--font-ui`, `--font-reader` |
| `--size` | Sizes | `--size-reader` |
| `--safe` | Safe area insets | `--safe-top`, `--safe-bottom`, `--safe-left`, `--safe-right` |

---

## Adding a New Theme

1. Add the theme name and `<meta theme-color>` to `THEME_COLORS` in `js/core/constants.js`
2. Add the name to `ALL_THEME_NAMES` (automatically derived from `Object.keys(THEME_COLORS)`)
3. Add the body class override block to `css/tokens.css`:
   ```css
   body.theme-yourtheme {
     --bg: /* your value */;
     --fg: /* your value */;
     /* ... other overrides ... */
   }
   ```
4. The theme selector in the settings screen auto-generates buttons for all entries in `ALL_THEME_NAMES`

No JavaScript changes needed beyond step 1 and 2 in constants.js.
