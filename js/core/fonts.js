// Font registry — single source of truth for all available fonts.
//
// To ADD a font:
//   1. Add an entry to FONT_REGISTRY below (keep named fonts alphabetical).
//   2. Download the woff2 file(s) to /fonts/ (Regular + Bold minimum; Italic optional).
//   3. Add matching @font-face declarations in css/tokens.css.
//
// To REMOVE a font:
//   1. Delete its entry from FONT_REGISTRY.
//   Unknown keys in saved prefs fall back to the default (serif).

export const FONT_REGISTRY = [
  // ── Generic system-font stacks (always shown first, in this order) ──────────
  {
    key: 'serif',
    label: 'Serif',
    stack: 'Georgia, "Iowan Old Style", "Palatino Linotype", Cambria, "Times New Roman", serif',
    group: 'generic',
  },
  {
    key: 'sans',
    label: 'Sans',
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    group: 'generic',
  },
  {
    key: 'mono',
    label: 'Mono',
    stack: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    group: 'generic',
  },

  // ── Named fonts — keep alphabetical — add/remove freely ─────────────────────
  { key: 'alegreya',          label: 'Alegreya',              stack: '"Alegreya", Georgia, serif',                     group: 'named' },
  { key: 'andika',            label: 'Andika',                stack: '"Andika", sans-serif',                           group: 'named' },
  { key: 'atkinson',          label: 'Atkinson Hyperlegible', stack: '"Atkinson Hyperlegible", Helvetica, sans-serif', group: 'named' },
  { key: 'bitter',            label: 'Bitter',                stack: '"Bitter", Georgia, serif',                       group: 'named' },
  { key: 'bookman',           label: 'Bookman',               stack: '"URW Bookman", "Bookman Old Style", serif',      group: 'named' },
  { key: 'crimson-pro',       label: 'Crimson Pro',           stack: '"Crimson Pro", Georgia, serif',                  group: 'named' },
  { key: 'dyslexic',          label: 'OpenDyslexic',          stack: '"OpenDyslexic", "Comic Sans MS", cursive',       group: 'named' },
  { key: 'eb-garamond',       label: 'EB Garamond',           stack: '"EB Garamond", Georgia, serif',                  group: 'named' },
  { key: 'inconsolata',       label: 'Inconsolata',           stack: '"Inconsolata", "Courier New", monospace',        group: 'named' },
  { key: 'jetbrains-mono',    label: 'JetBrains Mono',        stack: '"JetBrains Mono", monospace',                   group: 'named' },
  { key: 'lato',              label: 'Lato',                  stack: '"Lato", Helvetica, sans-serif',                  group: 'named' },
  { key: 'lexend',            label: 'Lexend',                stack: '"Lexend", Helvetica, sans-serif',                group: 'named' },
  { key: 'libre-baskerville', label: 'Libre Baskerville',     stack: '"Libre Baskerville", Georgia, serif',            group: 'named' },
  { key: 'libre-caslon',      label: 'Libre Caslon',          stack: '"Libre Caslon Text", Georgia, serif',            group: 'named' },
  { key: 'literata',          label: 'Literata',              stack: '"Literata", Georgia, serif',                     group: 'named' },
  { key: 'lora',              label: 'Lora',                  stack: '"Lora", Georgia, serif',                         group: 'named' },
  { key: 'merriweather',      label: 'Merriweather',          stack: '"Merriweather", Georgia, serif',                 group: 'named' },
  { key: 'noto-serif',        label: 'Noto Serif',            stack: '"Noto Serif", Georgia, serif',                   group: 'named' },
  { key: 'nunito',            label: 'Nunito',                stack: '"Nunito", Helvetica, sans-serif',                group: 'named' },
  { key: 'open-sans',         label: 'Open Sans',             stack: '"Open Sans", Helvetica, sans-serif',             group: 'named' },
  { key: 'pt-serif',          label: 'PT Serif',              stack: '"PT Serif", Georgia, serif',                     group: 'named' },
  { key: 'source-code-pro',   label: 'Source Code Pro',       stack: '"Source Code Pro", monospace',                  group: 'named' },
  { key: 'source-sans-3',     label: 'Source Sans 3',         stack: '"Source Sans 3", Helvetica, sans-serif',         group: 'named' },
  { key: 'source-serif-4',    label: 'Source Serif 4',        stack: '"Source Serif 4", Georgia, serif',               group: 'named' },
  { key: 'spectral',          label: 'Spectral',              stack: '"Spectral", Georgia, serif',                     group: 'named' },
  { key: 'vollkorn',          label: 'Vollkorn',              stack: '"Vollkorn", Georgia, serif',                     group: 'named' },

  // ── Fonts designers love to hate 😈 (hosted — Comic Neue is the free, served
  // twin of Comic Sans, so "Comic Sans" works for everyone even without the
  // genuine article installed) ────────────────────────────────────────────────
  { key: 'comic-sans',        label: 'Comic Sans',            stack: '"Comic Sans MS", "Comic Neue", cursive',         group: 'named' },
  { key: 'lobster',           label: 'Lobster',               stack: '"Lobster", cursive',                             group: 'named' },
  { key: 'pacifico',          label: 'Pacifico',              stack: '"Pacifico", cursive',                            group: 'named' },

  // ── System fonts — NOT bundled/served ───────────────────────────────────────
  // These are proprietary (Microsoft/Apple/Monotype) and can't be self-hosted.
  // They use the reader's device copy when installed and are HIDDEN from the
  // menu when not (see font availability detection in shared/font-picker.js).
  // For that detection to be honest, each stack lists ONLY genuine aliases /
  // metric-clones of the same typeface plus a generic — never an unrelated
  // fallback, which would make the entry show while rendering a different font.
  { key: 'arial',           label: 'Arial',           stack: 'Arial, "Liberation Sans", sans-serif',                   group: 'named', system: true },
  { key: 'avenir',          label: 'Avenir',          stack: '"Avenir Next", Avenir, sans-serif',                      group: 'named', system: true },
  { key: 'brush-script',    label: 'Brush Script',    stack: '"Brush Script MT", "Brush Script Std", cursive',         group: 'named', system: true },
  { key: 'futura',          label: 'Futura',          stack: 'Futura, "Futura PT", sans-serif',                        group: 'named', system: true },
  { key: 'georgia',         label: 'Georgia',         stack: 'Georgia, serif',                                         group: 'named', system: true },
  { key: 'gill-sans',       label: 'Gill Sans',       stack: '"Gill Sans", "Gill Sans MT", "Gill Sans Nova", sans-serif', group: 'named', system: true },
  { key: 'helvetica',       label: 'Helvetica',       stack: '"Helvetica Neue", Helvetica, sans-serif',                group: 'named', system: true },
  { key: 'impact',          label: 'Impact',          stack: 'Impact, "Impact LT Std", sans-serif',                    group: 'named', system: true },
  { key: 'palatino',        label: 'Palatino',        stack: '"Palatino Linotype", Palatino, "Book Antiqua", serif',   group: 'named', system: true },
  { key: 'papyrus',         label: 'Papyrus',         stack: 'Papyrus, fantasy',                                       group: 'named', system: true },
  { key: 'rockwell',        label: 'Rockwell',        stack: 'Rockwell, "Rockwell Std", serif',                        group: 'named', system: true },
  { key: 'times-new-roman', label: 'Times New Roman', stack: '"Times New Roman", Times, "Liberation Serif", serif',    group: 'named', system: true },
];

// Display order for the picker: the generic stacks first (in registry order:
// serif, sans, mono), then the named fonts alphabetised by their visible label.
// Sorting here means new fonts can be added anywhere in FONT_REGISTRY above and
// still land in the right alphabetical slot.
export const FONTS_ORDERED = [
  ...FONT_REGISTRY.filter(f => f.group === 'generic'),
  ...FONT_REGISTRY.filter(f => f.group === 'named')
    .sort((a, b) => a.label.localeCompare(b.label)),
];

// key → CSS font-family stack
export const FONT_MAP = Object.fromEntries(FONT_REGISTRY.map(f => [f.key, f.stack]));

// Convenience exports kept for backward compatibility
export const FONT_SERIF    = FONT_MAP.serif;
export const FONT_SANS     = FONT_MAP.sans;
export const FONT_MONO     = FONT_MAP.mono;
export const FONT_DYSLEXIC = FONT_MAP.dyslexic;

export function fontByKey(key) {
  return FONT_REGISTRY.find(f => f.key === key) ?? FONT_REGISTRY[0];
}
