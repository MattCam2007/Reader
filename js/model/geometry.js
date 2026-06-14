// Effective layout scale applied to `content` by an ancestor transform. The
// reader viewport is scaled down (transform: scale(<1)) whenever the chrome
// bars are visible, so getBoundingClientRect() on any descendant returns
// *scaled* pixels. state.stride, however, is in unscaled CSS pixels (derived
// from clientWidth). Dividing a scaled offset by an unscaled stride under-counts
// the page by exactly this factor — and the error grows with the offset, so a
// TOC/footnote/bookmark jump (which runs while a panel + chrome are visible)
// lands progressively further before its target the deeper it is in the
// chapter. Recover the unscaled offset by dividing rect deltas by this factor.
// getComputedStyle().width is the used width in unscaled CSS pixels (transforms
// don't affect it) and is fractional, so rect.width / computedWidth is the exact
// ancestor scale — content's own transform is a translation, which preserves
// width. (offsetWidth would work too but is integer-rounded, leaving a residual
// that accumulates over large offsets.) Returns 1 when unscaled or unmeasurable.
export function layoutScale(content) {
  if (!content || typeof getComputedStyle === 'undefined') return 1;
  const cssW = parseFloat(getComputedStyle(content).width);
  if (!(cssW > 0)) return 1;
  const s = content.getBoundingClientRect().width / cssW;
  return s > 0 ? s : 1;
}

// A chapter heading forced to a fresh column (break-before:column) starts at
// exactly k*stride, so x/stride is an integer k modulo sub-pixel measurement
// noise. Floor is unstable there — k-0.00001 floors to k-1, landing the jump one
// whole column before the heading. Nudge by a fraction of a pixel before flooring
// to snap boundary cases to the column that starts there. Safe for words too:
// text never begins inside the column gap just below a boundary, so nothing real
// sits within EPS of the previous column's end.
const PAGE_EPS_PX = 0.5;

function pageOfX(state, x) {
  return Math.max(0, Math.min(state.total - 1, Math.floor((x + PAGE_EPS_PX) / state.stride)));
}

export function wordRange(state, i) {
  const w = state.doc.words[i];
  if (!w) return null;
  const range = document.createRange();
  range.setStart(w.node, w.start);
  range.setEnd(w.node, w.end);
  return range;
}

// Map a (text node, character offset) to a render-token (word) index, or -1.
// Scans only the words in the node's containing block (.blk) so it is
// O(words-in-block), not O(book). A word strictly containing the offset always
// wins. At a token boundary (annotateInlineText splits "word." into the two
// adjacent render tokens "word" and ".", so one token's end == the next's
// start) `prefer` breaks the tie: 'start' picks the token that begins at the
// offset (use for a selection's start), 'end' picks the token that ends there
// (use for a selection's inclusive end).
export function wordIndexFromNodeOffset(state, node, offset, prefer = 'start') {
  const doc = state.doc;
  if (!doc || !doc.words || !doc.words.length) return -1;
  if (!node || node.nodeType !== Node.TEXT_NODE) return -1;
  let lo = 0, hi = doc.words.length;
  const blkEl = node.parentElement && node.parentElement.closest(".blk");
  if (blkEl && doc.blocks) {
    const bi = doc.blocks.findIndex(b => b.el === blkEl);
    if (bi >= 0) { lo = doc.blocks[bi].wordStart; hi = doc.blocks[bi].wordEnd; }
  }
  let startsAt = -1, endsAt = -1, after = -1, last = -1;
  for (let i = lo; i < hi; i++) {
    const w = doc.words[i];
    if (w.node !== node) continue;
    last = i;
    if (offset >= w.start && offset < w.end) return i; // interior: unambiguous
    if (startsAt < 0 && w.start === offset) startsAt = i;
    if (w.end === offset) endsAt = i;
    if (after < 0 && w.start > offset) after = i;
  }
  if (prefer === 'end') {
    return endsAt >= 0 ? endsAt : (startsAt >= 0 ? startsAt : (after >= 0 ? after : last));
  }
  return startsAt >= 0 ? startsAt : (endsAt >= 0 ? endsAt : (after >= 0 ? after : last));
}

// Map a viewport point to a render-token (word) index, or -1, via the caret
// hit-test (vendor-prefixed on WebKit).
export function wordAtPoint(state, x, y, prefer = 'start') {
  let node = null, offset = 0;
  if (document.caretPositionFromPoint) {
    const cp = document.caretPositionFromPoint(x, y);
    if (cp) { node = cp.offsetNode; offset = cp.offset; }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  }
  return wordIndexFromNodeOffset(state, node, offset, prefer);
}

export function pageOfWord(state, content, i) {
  const range = wordRange(state, i);
  if (!range) return 0;
  const scale = layoutScale(content);
  const x = (range.getBoundingClientRect().left - content.getBoundingClientRect().left) / scale;
  return pageOfX(state, x);
}

export function pageOfElement(state, content, el) {
  // Divide by the ancestor layout scale so a scaled rect delta maps to the same
  // unscaled stride units state.stride uses (see layoutScale). Without this, jumps
  // made while the chrome is visible (TOC/footnote/bookmark) land short.
  const scale = layoutScale(content);
  const x = (el.getBoundingClientRect().left - content.getBoundingClientRect().left) / scale;
  // pageOfX floors (not rounds) so an element and the words inside it resolve to
  // the same page — chapter labels / TOC / footnote jumps must agree with the
  // saved reading position — with a sub-pixel nudge to stabilise column boundaries.
  return pageOfX(state, x);
}

export function wordAtPageStart(state, content, p) {
  if (!state.doc.words.length) return 0;
  let lo = 0, hi = state.doc.words.length - 1;
  let result = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const wp = pageOfWord(state, content, mid);
    if (wp < p) {
      lo = mid + 1;
    } else {
      result = mid;
      hi = mid - 1;
    }
  }
  return result;
}

// First render token at/after page `p`, searching only the token range
// [lo, hiExcl). Used by windowed rendering, where only the current chapter is
// laid out so a whole-book binary search would read zeroed rects from detached
// chapters. Same monotonic logic as wordAtPageStart, bounded to one chapter.
export function wordAtPageStartRange(state, content, p, lo, hiExcl) {
  let result = lo;
  let hi = hiExcl - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const wp = pageOfWord(state, content, mid);
    if (wp < p) lo = mid + 1;
    else { result = mid; hi = mid - 1; }
  }
  return result;
}

// Tolerance for the "at the viewport top" comparison: absorbs sub-pixel
// measurement noise so a word sitting exactly on the fold counts as visible.
const SCROLL_TOP_EPS_PX = 0.5;

// Scroll-mode locator (Phase 8b: binary search instead of sampling).
//
// The anchor is the FIRST word whose top is at/below the viewport top — i.e.
// the first whole word the reader can see — matching the product model "the
// position is the words at the top of the page" and the paginated capture
// (wordAtPageStart). The previous nearest-by-abs bookkeeping deliberately let a
// word on the line already cut off above the fold win, which is why bookmarks
// pressed on a fold-straddling paragraph could anchor a line above where the
// reader's eye was (and land a page off after a relayout).
//
// Both rect tops below come from getBoundingClientRect under the same ancestor
// transform (the viewport is scaled while the chrome bars are visible — see
// layoutScale), so the comparison is scale-invariant and needs no de-scaling;
// only offset÷length math does.
export function currentLocator(state, content, viewport, toLocatorFn) {
  if (state.isScrollMode) {
    const vpTop = viewport.getBoundingClientRect().top;
    const words = state.doc.words;
    if (!words.length) return null;
    // Binary search converges on the first word with top >= vpTop. Word index
    // order already guarantees the leftmost word of that line wins.
    let lo = 0, hi = words.length - 1;
    let first = words.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const r = wordRange(state, mid);
      if (!r) { lo = mid + 1; continue; }
      if (r.getBoundingClientRect().top >= vpTop - SCROLL_TOP_EPS_PX) {
        first = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return toLocatorFn(first);
  }
  return toLocatorFn(wordAtPageStart(state, content, state.page));
}
