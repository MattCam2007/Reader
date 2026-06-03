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
  const x = range.getBoundingClientRect().left - content.getBoundingClientRect().left;
  return Math.max(0, Math.min(state.total - 1, Math.floor(x / state.stride)));
}

export function pageOfElement(state, content, el) {
  const x = el.getBoundingClientRect().left - content.getBoundingClientRect().left;
  // floor (not round) to match pageOfWord: an element and the words inside it
  // must resolve to the same page, or chapter labels / TOC / footnote jumps land
  // one page off relative to the saved reading position.
  return Math.max(0, Math.min(state.total - 1, Math.floor(x / state.stride)));
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
