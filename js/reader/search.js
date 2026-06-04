import { toLocator } from '../model/locator.js';
import { wordRange } from '../model/geometry.js';
import { renderSearchResults, indexForOffset } from '../shared/search.js';

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
    this.closePanelsFn();
  }

  run(query) {
    const { state, els } = this;
    this.clearHighlights();
    renderSearchResults(els.searchResults, {
      text: state.doc.text,
      charStart: state.doc.wordCharStart,
      query,
      onPick: (wi) => {
        const loc = toLocator(state, wi);
        if (loc) this.goToLocatorFn(loc);
        this.close();
      },
      onHits: (hits) => this._highlightHits(hits, query.length),
    });
  }

  _highlightHits(charOffsets) {
    this.clearHighlights();
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    const { state } = this;
    const ranges = [];
    charOffsets.forEach(charOff => {
      const wi = indexForOffset(state.doc.wordCharStart, charOff);
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
