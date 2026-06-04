// Shared "shell" helpers for the three reading-mode apps (Reader, RSVP, TTS).
//
// Phase 5's goal is to stop re-implementing the mode-agnostic shell in all three
// entry points. Each mode's init() is a large closure-based lifecycle wired
// through an AbortController; rather than invert that into a fragile base class,
// the genuinely-duplicated, mode-agnostic pieces — theme application, the
// OS-preference fallback, and the canonical-position localStorage plumbing —
// live here once and each mode composes them.
//
// (Bookmark-panel wiring is already shared via bookmarks/panel.js. Panel
// open/close is left per-mode: the element IDs and body-class names differ too
// much between modes for a shared abstraction to be a net win.)

import { THEME_COLORS, ALL_THEME_NAMES } from './core/constants.js';
import { loadStoredPosition, saveStoredPosition } from './core/position.js';

// Toggle the body theme class. "dark" is the default (no class).
export function applyThemeClass(name) {
  document.body.classList.remove(...ALL_THEME_NAMES.map(t => `theme-${t}`));
  if (name !== 'dark') document.body.classList.add('theme-' + name);
}

// Tint the browser chrome (address bar / status bar) to match the theme.
export function setMetaThemeColor(name) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && THEME_COLORS[name]) meta.setAttribute('content', THEME_COLORS[name]);
}

// Apply a theme everywhere it shows: body class + browser-chrome meta color.
export function applyTheme(name) {
  applyThemeClass(name);
  setMetaThemeColor(name);
}

// First run only: with no stored general prefs, honour the OS light preference.
// Sets generalPrefs.data.theme to 'light' and calls onApply('light') (which the
// caller uses to re-apply + persist). Returns true if it changed the theme.
export function applyOsThemeFallback(generalPrefs, onApply) {
  if (localStorage.getItem('general:prefs')) return false;
  if (!window.matchMedia('(prefers-color-scheme: light)').matches) return false;
  generalPrefs.data.theme = 'light';
  if (onApply) onApply('light');
  return true;
}

// Canonical reading-position persistence, shared `book:pos:{bookId}` key.
export function savePosition(bookId, getPos) {
  if (!bookId) return;
  let pos = null;
  try { pos = getPos(); } catch (_) { return; }
  if (pos) saveStoredPosition(bookId, pos);
}

export function loadPosition(bookId) {
  return loadStoredPosition(bookId);
}
