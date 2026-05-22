import { MAX_SEARCH_HITS } from '../core/constants.js';
import { toLocator } from '../model/locator.js';
import { wordRange } from '../model/geometry.js';

export class SearchManager {
  constructor(state, els, goToLocatorFn, closePanelsFn) {
    this.state = state;
    this.els = els;
    this.goToLocatorFn = goToLocatorFn;
    this.closePanelsFn = closePanelsFn;
    this._highlightRanges = [];
  }

  open() {
    this.closePanelsFn();
    document.body.classList.add("show-search");
    document.body.classList.remove("chrome-hidden");
    const input = this.els.searchInput;
    if (input) { input.value = ""; input.focus(); }
    this.els.searchResults.innerHTML = "";
  }

  close() {
    document.body.classList.remove("show-search");
    this.clearHighlights();
  }

  run(query) {
    const { state, els } = this;
    const resultsEl = els.searchResults;
    resultsEl.innerHTML = "";
    this.clearHighlights();
    if (!query || query.length < 2 || !state.doc.text) {
      if (query && query.length >= 2) {
        resultsEl.innerHTML = '<div class="reader-search-empty">No results</div>';
      }
      return;
    }
    const lower = state.doc.text.toLowerCase();
    const q = query.toLowerCase();
    const hits = [];
    let pos = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1 && hits.length < MAX_SEARCH_HITS) {
      hits.push(pos);
      pos += q.length;
    }
    if (!hits.length) {
      resultsEl.innerHTML = '<div class="reader-search-empty">No results</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    hits.forEach((charOff) => {
      let wi = 0;
      for (let j = 0; j < state.doc.wordCharStart.length; j++) {
        if (state.doc.wordCharStart[j] <= charOff) wi = j;
        else break;
      }
      const snippetStart = Math.max(0, charOff - 40);
      const snippetEnd = Math.min(state.doc.text.length, charOff + query.length + 40);
      const before = (snippetStart > 0 ? "\u2026" : "") + state.doc.text.slice(snippetStart, charOff);
      const match = state.doc.text.slice(charOff, charOff + query.length);
      const after = state.doc.text.slice(charOff + query.length, snippetEnd) + (snippetEnd < state.doc.text.length ? "\u2026" : "");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reader-search-result";
      btn.appendChild(document.createTextNode(before));
      const mark = document.createElement("mark");
      mark.textContent = match;
      btn.appendChild(mark);
      btn.appendChild(document.createTextNode(after));
      btn.addEventListener("click", () => {
        const loc = toLocator(state, wi);
        if (loc) this.goToLocatorFn(loc);
        this.close();
      });
      frag.appendChild(btn);
    });
    resultsEl.appendChild(frag);
    this._highlightHits(hits, query.length);
  }

  _highlightHits(charOffsets, len) {
    this.clearHighlights();
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    const { state } = this;
    const ranges = [];
    charOffsets.forEach(charOff => {
      let wi = 0;
      for (let j = 0; j < state.doc.wordCharStart.length; j++) {
        if (state.doc.wordCharStart[j] <= charOff) wi = j;
        else break;
      }
      const r = wordRange(state, wi);
      if (r) ranges.push(r);
    });
    if (ranges.length) {
      try {
        const hl = new Highlight(...ranges);
        CSS.highlights.set("search-results", hl);
        this._highlightRanges = ranges;
      } catch (e) { console.warn("search:highlight", e); }
    }
  }

  clearHighlights() {
    if (typeof CSS !== "undefined" && CSS.highlights) {
      try { CSS.highlights.delete("search-results"); } catch (e) { console.warn("search:clearHighlight", e); }
    }
    this._highlightRanges = [];
  }
}
