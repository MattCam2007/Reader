// Unified, mode-independent reading position.
//
// All three modes (Reader, RSVP, TTS) derive their content from the same EPUB
// extraction and can each compute an exact *global word ordinal* for the current
// position. They used to discard that and persist a single scalar fraction in
// each mode's own unit (Reader/RSVP: words, TTS: sentences), which drifted by a
// page or more on every mode switch. This module makes the word ordinal the
// shared currency, anchored to the section's stable spine href so it survives:
//
//   - switching between Reader / RSVP / TTS
//   - re-pagination, font/column/theme changes
//   - small differences in how each mode tokenises words (bounded to one section)
//
// Storage key (shared by every mode): `book:pos:{bookId}`.

export const POS_KEY_PREFIX = 'book:pos:';

function clamp(n, lo, hi) {
  n = Number.isFinite(n) ? n : lo;
  return Math.max(lo, Math.min(hi, n));
}

// Derive a book identifier that is identical across every mode, so the shared
// storage key matches even across separate sessions. Order: explicit ?id=,
// then metadata title, then filename (sans .epub).
export function deriveBookId(urlId, metaTitle, fileName) {
  const id = (urlId || '').trim();
  if (id) return id;
  const title = (metaTitle || '').trim();
  if (title) return title;
  const name = (fileName || '').replace(/\.epub$/i, '').trim();
  return name || 'untitled';
}

// Build a canonical position object.
//
//   sections   [{ href, wordStart, wordCount }] in reading order, where
//              wordStart is the global word ordinal of the section's first word.
//   totalWords total words in this mode's stream.
//   globalOrd  the current global word ordinal.
//
// The returned object carries section-relative coordinates (primary), a global
// ordinal, and a fraction — each a progressively coarser fallback for the resolver.
export function buildPosition(sections, totalWords, globalOrd) {
  const words = Math.max(1, Math.trunc(totalWords) || 1);
  const ord = clamp(Math.trunc(globalOrd) || 0, 0, words - 1);

  // Find the section that contains `ord`. If `ord` falls in a gap keep the
  // last section that starts at or before it.
  let chosen = null;
  for (const s of sections) {
    if (!s || s.wordCount <= 0) continue;
    if (ord >= s.wordStart && ord < s.wordStart + s.wordCount) { chosen = s; break; }
    if (s.wordStart <= ord) chosen = s;
  }

  let href = '';
  let wordInSec = ord;
  let secWords = words;
  if (chosen) {
    href = chosen.href || '';
    wordInSec = clamp(ord - chosen.wordStart, 0, chosen.wordCount - 1);
    secWords = chosen.wordCount;
  }

  return {
    v: 1,
    href,
    wordInSec,
    secWords: Math.max(1, secWords),
    ord,
    words,
    f: words > 1 ? ord / (words - 1) : 0,
  };
}

// Resolve a canonical position to a global word ordinal in *this* mode's stream.
// Falls through three levels of robustness:
//   1. Match the section by stable href, then reconcile the within-section word
//      offset if the two modes counted that section's words differently.
//   2. Scale the global ordinal by the ratio of total word counts.
//   3. The progress fraction.
export function resolvePosition(pos, sections, totalWords) {
  const words = Math.max(1, Math.trunc(totalWords) || 1);
  if (!pos || typeof pos !== 'object') return 0;

  // 1. Stable section anchor.
  if (pos.href) {
    const s = sections.find(x => x && x.href === pos.href && x.wordCount > 0);
    if (s) {
      let wis = Math.trunc(pos.wordInSec) || 0;
      if (pos.secWords > 1 && s.wordCount !== pos.secWords) {
        wis = Math.round(wis * (s.wordCount - 1) / (pos.secWords - 1));
      }
      return clamp(s.wordStart + clamp(wis, 0, s.wordCount - 1), 0, words - 1);
    }
  }

  // 2. Global word ordinal, scaled to this mode's count.
  if (typeof pos.ord === 'number' && pos.words > 1) {
    return clamp(Math.round(pos.ord * (words - 1) / (pos.words - 1)), 0, words - 1);
  }

  // 3. Fraction fallback (also reads the legacy `{ f }` format).
  if (typeof pos.f === 'number') {
    return clamp(Math.round(pos.f * (words - 1)), 0, words - 1);
  }
  return 0;
}

export function loadStoredPosition(bookId) {
  if (!bookId) return null;
  try {
    const raw = localStorage.getItem(POS_KEY_PREFIX + bookId);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

export function saveStoredPosition(bookId, pos) {
  if (!bookId || !pos) return;
  try { localStorage.setItem(POS_KEY_PREFIX + bookId, JSON.stringify(pos)); }
  catch (_) {}
}
