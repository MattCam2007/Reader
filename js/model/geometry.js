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

// Scroll-mode locator: binary search instead of sampling (Phase 8b)
export function currentLocator(state, content, viewport, toLocatorFn) {
  if (state.isScrollMode) {
    const vpTop = viewport.getBoundingClientRect().top;
    const words = state.doc.words;
    if (!words.length) return null;
    // Binary search for the word nearest viewport top
    let lo = 0, hi = words.length - 1;
    let best = 0, bestDist = Infinity;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const r = wordRange(state, mid);
      if (!r) { lo = mid + 1; continue; }
      const top = r.getBoundingClientRect().top;
      const d = Math.abs(top - vpTop);
      if (d < bestDist) { bestDist = d; best = mid; }
      if (top < vpTop) lo = mid + 1;
      else hi = mid - 1;
    }
    // Refine in local neighborhood
    const refineLo = Math.max(0, best - 20);
    const refineHi = Math.min(words.length - 1, best + 20);
    for (let i = refineLo; i <= refineHi; i++) {
      const r = wordRange(state, i);
      if (!r) continue;
      const d = Math.abs(r.getBoundingClientRect().top - vpTop);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return toLocatorFn(best);
  }
  return toLocatorFn(wordAtPageStart(state, content, state.page));
}
