// Font stacks
export const FONT_SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", Cambria, "Times New Roman", serif';
export const FONT_SANS  = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const FONT_DYSLEXIC = '"OpenDyslexic", "Comic Sans MS", cursive';
export const FONT_MAP = { serif: FONT_SERIF, sans: FONT_SANS, dyslexic: FONT_DYSLEXIC };

// Layout
export const COLUMN_GAP = 40;
export const MIN_SIZE = 14;
export const MAX_SIZE = 30;

// Margins
export const MARGINS = {
  narrow: "1rem",
  normal: "clamp(1.25rem, 6vw, 3rem)",
  wide: "clamp(2rem, 10vw, 5rem)",
};

// Theme colors for meta tag
export const THEME_COLORS = {
  dark: "#1a1a1a",
  sepia: "#f4ecd8",
  light: "#ffffff",
  oled: "#000000",
};

// Swipe / tap thresholds
export const SWIPE_THRESHOLD_MAX_PX = 80;
export const SWIPE_THRESHOLD_VP_FRACTION = 0.18;
export const TAP_ZONE_LEFT = 0.3;
export const TAP_ZONE_RIGHT = 0.7;
export const SYNTHETIC_CLICK_GUARD_MS = 600;
export const TAP_TIMEOUT_MS = 400;

// Search
export const MAX_SEARCH_HITS = 200;

// Debounce timings
export const SAVE_DEBOUNCE_MS = 500;
export const RESIZE_DEBOUNCE_MS = 150;
export const SELECTION_DEBOUNCE_MS = 200;

// EPUB extraction
export const RICH_INLINE = true;
export const BLOCK_SEL = "h1,h2,h3,h4,h5,h6,p,div,blockquote,li,pre,dd,dt,figure,figcaption,table,img";
export const SKIP_SEL = "script,style,nav,header,footer,aside,form";
export const INLINE_TAGS = new Set(["b","strong","i","em","u","sup","sub","small","a","span","br","code","img","table","thead","tbody","tfoot","tr","th","td","caption"]);
export const SAFE_ATTRS = {
  a: new Set(["href"]),
  img: new Set(["src","alt"]),
  td: new Set(["colspan","rowspan"]),
  th: new Set(["colspan","rowspan","scope"]),
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
  align: "justify",
  hyphens: true,
  selection: true,
  brightness: 1,
  warmth: 0,
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
