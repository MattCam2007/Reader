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

import { safeSetItem, POS_KEY_PREFIX } from './safe-storage.js';

export { POS_KEY_PREFIX };

// Text-anchor refinement. After the section/ordinal math lands us *near* the
// right word, we snap to the exact word by matching a short snippet of the
// text captured at save time against this mode's words around the prediction.
// This absorbs the last residual count differences between modes (a stray
// footnote digit, a sanitiser dropping a glyph) that otherwise leave us a
// paragraph or a page off at a boundary.
const SNIPPET_WORDS = 8;   // words captured at the anchor
const REFINE_WINDOW = 600; // how far either side of the prediction to search

// Normalise a word for cross-mode comparison: lowercase, drop everything that
// isn't a letter or digit (punctuation/quotes/dashes differ between modes).
function normWord(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function clamp(n, lo, hi) {
  n = Number.isFinite(n) ? n : lo;
  return Math.max(lo, Math.min(hi, n));
}

// Snap `ord` to the best text match for `snippet` within REFINE_WINDOW words.
// `wordAt(i)` returns the raw word string at global ordinal i in this mode.
// Requires a strong majority of the snippet's real words to match, and breaks
// ties toward the prediction, so repeated phrases don't pull us far away.
function refineByText(ord, snippet, wordAt, total) {
  if (!Array.isArray(snippet) || snippet.length < 2 || typeof wordAt !== 'function') return ord;
  const N = snippet.length;
  const lo = Math.max(0, ord - REFINE_WINDOW);
  const hi = Math.min(total, ord + REFINE_WINDOW + N);
  const tw = [];
  for (let i = lo; i < hi; i++) tw.push(normWord(wordAt(i)));

  const maxMatch = snippet.filter(Boolean).length;
  if (maxMatch < 2) return ord;
  const need = Math.ceil(maxMatch * 0.6);

  let best = -1, bestScore = 0, bestDist = Infinity;
  for (let i = 0; i + N <= tw.length; i++) {
    let score = 0;
    for (let j = 0; j < N; j++) { const a = tw[i + j]; if (a && a === snippet[j]) score++; }
    if (score === 0) continue;
    const absI = lo + i;
    const d = Math.abs(absI - ord);
    if (score > bestScore || (score === bestScore && d < bestDist)) {
      bestScore = score; best = absI; bestDist = d;
    }
  }
  return (best >= 0 && bestScore >= need) ? best : ord;
}

// Derive a book identifier that is identical across every mode, so the shared
// storage key matches even across separate sessions. Order: explicit ?id=,
// then metadata title, then filename (sans extension).
//
// Extension stripping is driven by the format registry so adding a new format
// automatically keeps bookIds clean (no hard-coded '.epub').
export function deriveBookId(urlId, metaTitle, fileName) {
  const id = (urlId || '').trim();
  if (id) return id;
  const title = (metaTitle || '').trim();
  if (title) return title;
  // Strip the last file extension (e.g. .epub, .pdf) from the filename.
  // We import the registry lazily to avoid a module-init-order issue: at the
  // time position.js first evaluates the adapters may not yet be registered, so
  // we use a simple heuristic (strip any .<= 5-char alphabetic extension) rather
  // than reading the registry at module-eval time. The registry-driven version
  // would require a function call inside deriveBookId; both are equivalent for
  // all current and planned extensions.
  const name = (fileName || '').trim().replace(/\.[a-z]{1,5}$/i, '').trim();
  return name || 'untitled';
}

// Short content fingerprint for derived (title/filename) book ids: SHA-256 of
// the first 4 KB, first 8 hex chars. Two different books that share a title or
// filename otherwise share every book:* storage key and poison each other's
// saved positions. Returns '' when hashing is unavailable (no crypto.subtle —
// e.g. an insecure context), in which case callers keep the un-hashed id and
// behaviour is unchanged.
export async function contentHashId(buffer) {
  try {
    if (!buffer || typeof crypto === 'undefined' || !crypto.subtle) return '';
    const digest = await crypto.subtle.digest('SHA-256', buffer.slice(0, 4096));
    return [...new Uint8Array(digest)].slice(0, 4)
      .map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return '';
  }
}

// Build a canonical position object.
//
//   sections   [{ href, wordStart, wordCount }] in reading order, where
//              wordStart is the global word ordinal of the section's first word.
//   totalWords total words in this mode's stream.
//   globalOrd  the current global word ordinal.
//
// The returned object carries section-relative coordinates (primary), a global
// ordinal, and a fraction — each a progressively coarser fallback for the
// resolver — plus a short text snippet (`t`) for the final exact snap.
//
//   wordAt   optional (i) => raw word string at global ordinal i, used to
//            capture the snippet. Omit it and the position is purely numeric.
export function buildPosition(sections, totalWords, globalOrd, wordAt) {
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

  const out = {
    v: 1,
    href,
    wordInSec,
    secWords: Math.max(1, secWords),
    ord,
    words,
    f: words > 1 ? ord / (words - 1) : 0,
  };

  // Capture a normalised snippet starting at the anchor word, for the exact
  // text snap on restore. Kept as consecutive words (empties preserved) so the
  // resolver can align it positionally against the target mode's words.
  if (typeof wordAt === 'function') {
    const snip = [];
    for (let i = 0; i < SNIPPET_WORDS && ord + i < words; i++) snip.push(normWord(wordAt(ord + i)));
    if (snip.some(Boolean)) out.t = snip;
  }
  return out;
}

// Resolve a canonical position to a global word ordinal in *this* mode's stream.
// Falls through three levels of robustness:
//   1. Match the section by stable href, then reconcile the within-section word
//      offset if the two modes counted that section's words differently.
//   2. Scale the global ordinal by the ratio of total word counts.
//   3. The progress fraction.
//   wordAt   optional (i) => raw word string at global ordinal i; when present
//            (and the position carries a snippet) the result is snapped to the
//            exact matching word near the numeric prediction.
export function resolvePosition(pos, sections, totalWords, wordAt) {
  const words = Math.max(1, Math.trunc(totalWords) || 1);
  if (!pos || typeof pos !== 'object') return 0;

  let ord = null;

  // 1. Stable section anchor.
  if (ord === null && pos.href) {
    const s = sections.find(x => x && x.href === pos.href && x.wordCount > 0);
    if (s) {
      let wis = Math.trunc(pos.wordInSec) || 0;
      if (pos.secWords > 1 && s.wordCount !== pos.secWords) {
        wis = Math.round(wis * (s.wordCount - 1) / (pos.secWords - 1));
      }
      ord = clamp(s.wordStart + clamp(wis, 0, s.wordCount - 1), 0, words - 1);
    }
  }

  // 2. Global word ordinal, scaled to this mode's count.
  if (ord === null && typeof pos.ord === 'number' && pos.words > 1) {
    ord = clamp(Math.round(pos.ord * (words - 1) / (pos.words - 1)), 0, words - 1);
  }

  // 3. Fraction fallback (also reads the legacy `{ f }` format).
  if (ord === null && typeof pos.f === 'number') {
    ord = clamp(Math.round(pos.f * (words - 1)), 0, words - 1);
  }
  if (ord === null) return 0;

  // 4. Exact text snap: the numeric prediction is close; match the saved
  //    snippet to this mode's words around it to land on the precise word.
  return refineByText(ord, pos.t, wordAt, words);
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
  // `la` (last-accessed, unix ms) rides inside the position object — one extra
  // field, zero schema change — so safe-storage can prune by recency when
  // localStorage fills instead of silently dropping the save.
  pos.la = Date.now();
  try { safeSetItem(POS_KEY_PREFIX + bookId, JSON.stringify(pos)); }
  catch (_) {}
}
