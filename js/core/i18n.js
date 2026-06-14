// App-wide internationalisation.
//
// A tiny synchronous string table: the active locale is chosen once (stored
// preference → browser language → English) and held in memory. `t(key)` looks
// the key up in the active locale, falls back to English, then to the key
// itself — so a missing translation degrades gracefully rather than blanking
// the UI. Locale data is statically imported (see js/i18n/index.js), so this
// module is ready the moment it's imported: templates can call `t()` inline.
//
// Strings are baked into the mode templates at build time, so changing the
// language reloads the page (setLang persists, the caller reloads) rather than
// trying to re-render every surface in place.

import { MESSAGES, LANGUAGES } from '../i18n/index.js';

const STORAGE_KEY = 'app:lang';
const DEFAULT_LANG = 'en';

const SUPPORTED = new Set(LANGUAGES.map((l) => l.code));

let _lang = DEFAULT_LANG;
let _messages = MESSAGES[DEFAULT_LANG];

function detectLang() {
  // 1. Explicit stored preference wins.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.has(stored)) return stored;
  } catch (_) { /* private mode etc. */ }
  // 2. Otherwise match the browser's preferred languages by base tag.
  const prefs = (navigator.languages && navigator.languages.length)
    ? navigator.languages
    : [navigator.language || ''];
  for (const tag of prefs) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (SUPPORTED.has(base)) return base;
  }
  return DEFAULT_LANG;
}

function apply(lang) {
  _lang = SUPPORTED.has(lang) ? lang : DEFAULT_LANG;
  _messages = MESSAGES[_lang] || MESSAGES[DEFAULT_LANG];
  try {
    if (document.documentElement) document.documentElement.lang = _lang;
  } catch (_) { /* no DOM yet — harmless */ }
}

// Initialise from storage/browser. Called once at import; safe to call again.
export function initI18n() {
  apply(detectLang());
  return _lang;
}

export function getLang() { return _lang; }

export function availableLanguages() { return LANGUAGES.slice(); }

// Persist and apply a new language. Does NOT reload — callers that need every
// rendered string refreshed should reload the page afterwards.
export function setLang(lang) {
  if (!SUPPORTED.has(lang)) return false;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
  apply(lang);
  return true;
}

// Translate `key`, interpolating {placeholder} tokens from `params`. Falls back
// to English, then to the raw key, so the UI never shows a blank label.
export function t(key, params) {
  let s = _messages[key];
  if (s === undefined) s = MESSAGES[DEFAULT_LANG][key];
  if (s === undefined) return key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (m, name) =>
      (params[name] !== undefined ? String(params[name]) : m));
  }
  return s;
}

// Initialise on first import so `t()` works synchronously everywhere.
initI18n();
