// Font registry — source of truth is js/core/fonts.js
export { FONT_MAP, FONT_SERIF, FONT_SANS, FONT_MONO, FONT_DYSLEXIC } from './fonts.js';

// Layout
export const COLUMN_GAP = 40;
export const MIN_SIZE = 14;
export const MAX_SIZE = 30;

// Windowed rendering only pays off on books big enough that laying out the whole
// multi-column tree is paint-bound. Below this whitespace-word count (or with a
// single section) we render the whole book and skip the per-chapter-boundary
// relayout overhead entirely. ~A short story; novels are far above it.
export const WINDOW_MIN_WORDS = 6000;

// Theme colors for meta tag
export const THEME_COLORS = {
  dark:     "#1a1a1a",
  sepia:    "#f4ecd8",
  light:    "#ffffff",
  oled:     "#000000",
  terminal: "#0a0d0a",
  nebula:   "#0d0818",
  forest:   "#0b1a0e",
  ember:    "#120c07",
  nord:     "#0f1520",
};

// All theme class names (used for bulk body class removal)
export const ALL_THEME_NAMES = Object.keys(THEME_COLORS);

// Swipe / tap thresholds
export const SWIPE_THRESHOLD_MAX_PX = 80;
export const SWIPE_THRESHOLD_VP_FRACTION = 0.18;
export const TAP_ZONE_LEFT = 0.3;
export const TAP_ZONE_RIGHT = 0.7;
export const SYNTHETIC_CLICK_GUARD_MS = 600;
export const TAP_TIMEOUT_MS = 400;

// Search
export const MAX_SEARCH_HITS = 200;

// Position text-snap (core/position.js refineByText). A candidate matching at
// least this fraction of the saved snippet's words is "high confidence":
// among high-confidence candidates the one nearest the numeric prediction
// wins, which keeps verbatim-repeated passages (liturgy, boilerplate) from
// pulling a restore to a distant copy. Named so it can be tuned without
// touching the algorithm; the 60% acceptance floor below it is the hard-coded
// minimum and not configurable.
export const REFINE_HIGH_MATCH_THRESHOLD = 0.8;

// Debounce timings
export const SAVE_DEBOUNCE_MS = 500;
export const RESIZE_DEBOUNCE_MS = 150;
export const SELECTION_DEBOUNCE_MS = 200;

// EPUB extraction
export const RICH_INLINE = true;
export const BLOCK_SEL = "h1,h2,h3,h4,h5,h6,p,div,blockquote,li,pre,dd,dt,figure,figcaption,table,img";
export const SKIP_SEL = "script,style,nav,header,footer,aside,form";

// Every block type the extractor can emit (shared/render renders each as a
// `.blk blk-<type>` element). This is the single enumeration the three modes'
// word counting derives from: the Reader doc-model walks all .blk, TTS selects
// blocks via EXTRACTABLE_BLOCK_SELECTOR, and RSVP consumes every extracted
// block with text. If these ever disagree, cross-mode word ordinals drift
// cumulatively and restores land pages off (a past bug — see tts-app.js
// segmentContent). A selftest asserts all three counts match.
export const EXTRACTABLE_BLOCK_TYPES = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "li", "pre", "table-wrap", "figure",
];
export const EXTRACTABLE_BLOCK_SELECTOR =
  EXTRACTABLE_BLOCK_TYPES.map(t => ".blk-" + t).join(", ");
export const INLINE_TAGS = new Set(["b","strong","i","em","u","sup","sub","small","a","span","br","code","img","table","thead","tbody","tfoot","tr","th","td","caption"]);
export const SAFE_ATTRS = {
  a: new Set(["href"]),
  img: new Set(["src","alt"]),
  td: new Set(["colspan","rowspan"]),
  th: new Set(["colspan","rowspan","scope"]),
};

// General (app-wide) prefs
export const GENERAL_DEFAULTS = {
  theme: 'dark',
  bgImageOpacity: 1,
  contentOpacity: 1,
  textOutline: 'none',
  brightness: 1,
  warmth: 0,
};

// Default prefs
export const DEFAULT_PREFS = {
  v: 1,
  theme: "dark",
  font: "serif",
  size: 19,
  weight: "regular",
  images: true,
  notePopovers: true,
  lineHeight: 1.62,
  margin: "normal",
  paraSpacing: "indent",
  quickDrawerOpen: false,
  align: "justify",
  hyphens: true,
  selection: false,
  pageAnim: "slide",
  layout: "paginated",
  columns: "auto",
};

// Declarative settings wiring (Phase 3: DRY)
export const SETTINGS = [
  { seg: "themeSeg",     attr: "theme",   pref: "theme",        repaginate: false },
  { seg: "fontSeg",      attr: "font",    pref: "font",         repaginate: true  },
  { seg: "imagesSeg",    attr: "images",  pref: "images",       repaginate: true, transform: v => v === "true" },
  { seg: "notePopSeg",   attr: "notepop", pref: "notePopovers", repaginate: false, transform: v => v === "true" },
  { seg: "marginSeg",    attr: "margin",  pref: "margin",       repaginate: true  },
  { seg: "paraSeg",      attr: "para",    pref: "paraSpacing",  repaginate: true  },
  { seg: "alignSeg",     attr: "align",   pref: "align",        repaginate: true  },
  { seg: "selectionSeg", attr: "sel",     pref: "selection",    repaginate: false, transform: v => v === "true" },
  { seg: "pageAnimSeg",  attr: "anim",    pref: "pageAnim",     repaginate: false },
  { seg: "layoutSeg",    attr: "layout",  pref: "layout",       repaginate: true  },
  { seg: "columnsSeg",   attr: "cols",    pref: "columns",      repaginate: true  },
];
