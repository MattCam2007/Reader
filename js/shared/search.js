import { MAX_SEARCH_HITS } from '../core/constants.js';
import { lastIndexAtMost } from '../rsvp/tokenizer.js';

// Shared full-text search. The same hit-finding + snippet-rendering loop was
// copy-pasted into reader/search.js, rsvp-app and tts-app — and every copy
// resolved each hit to its word/sentence by LINEAR-scanning the char-start
// array from 0 (O(hits × items), ~20M comparisons per keystroke on a 100k-word
// book). The char-start arrays are sorted, so this resolves each hit with a
// binary search instead.

// Find up to `maxHits` case-insensitive match offsets of `query` in `text`.
export function findHits(text, query, maxHits = MAX_SEARCH_HITS) {
  const hits = [];
  if (!text || !query) return hits;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let pos = 0;
  while ((pos = lower.indexOf(q, pos)) !== -1 && hits.length < maxHits) {
    hits.push(pos);
    pos += q.length;
  }
  return hits;
}

// Build a { before, match, after } snippet around a char offset.
export function snippetAt(text, charOff, qlen, pad = 40) {
  const start = Math.max(0, charOff - pad);
  const end = Math.min(text.length, charOff + qlen + pad);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, charOff),
    match: text.slice(charOff, charOff + qlen),
    after: text.slice(charOff + qlen, end) + (end < text.length ? "…" : ""),
  };
}

// Resolve a char offset to the index of the item that contains it (binary
// search over the sorted `charStart` array). Exposed so callers that need the
// index outside of rendering (e.g. highlighting) share the same fast path.
export function indexForOffset(charStart, charOff) {
  return lastIndexAtMost(charStart, charOff);
}

// Render search results for `query` into `resultsEl`.
//   text      the full searchable string
//   charStart sorted array: item index -> first char offset in `text`
//   onPick    (itemIndex, charOff) => void, fired when a result is clicked
//   onHits    optional (hits[]) => void with all match offsets (for highlight)
// Returns the number of results rendered.
export function renderSearchResults(resultsEl, opts) {
  const { text, charStart, query, onPick, onHits, maxHits } = opts;
  resultsEl.innerHTML = "";
  if (!query || query.length < 2 || !text || !charStart.length) {
    if (query && query.length >= 2) {
      resultsEl.innerHTML = '<div class="reader-search-empty">No results</div>';
    }
    return 0;
  }
  const hits = findHits(text, query, maxHits);
  if (!hits.length) {
    resultsEl.innerHTML = '<div class="reader-search-empty">No results</div>';
    return 0;
  }
  const frag = document.createDocumentFragment();
  hits.forEach((charOff) => {
    const idx = indexForOffset(charStart, charOff);
    const { before, match, after } = snippetAt(text, charOff, query.length);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-search-result";
    btn.appendChild(document.createTextNode(before));
    const mark = document.createElement("mark");
    mark.textContent = match;
    btn.appendChild(mark);
    btn.appendChild(document.createTextNode(after));
    btn.addEventListener("click", () => onPick(idx, charOff));
    frag.appendChild(btn);
  });
  resultsEl.appendChild(frag);
  if (onHits) onHits(hits);
  return hits.length;
}
