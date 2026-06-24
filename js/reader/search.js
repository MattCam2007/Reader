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
    this._queryLen = 0;
  }

  open() {
    this.closePanelsFn();
    this.clearHighlights();
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
    this._queryLen = query.length;
    this.clearHighlights();
    renderSearchResults(els.searchResults, {
      text: state.doc.text,
      charStart: state.doc.wordCharStart,
      query,
      onPick: (wi, charOff) => {
        this._highlightSelected(charOff);
        const loc = toLocator(state, wi);
        if (loc) this.goToLocatorFn(loc);
        this.close();
      },
      onHits: (hits) => this._highlightHits(hits),
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

  _highlightSelected(charOff) {
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    const { state } = this;
    const qLen = this._queryLen;
    const wiStart = indexForOffset(state.doc.wordCharStart, charOff);
    const wiEnd = indexForOffset(state.doc.wordCharStart, charOff + Math.max(qLen - 1, 0));
    const wStart = state.doc.words[wiStart];
    const wEnd = state.doc.words[wiEnd];
    if (!wStart || !wEnd) return;
    try {
      const range = document.createRange();
      range.setStart(wStart.node, wStart.start);
      range.setEnd(wEnd.node, wEnd.end);
      CSS.highlights.set("search-selected", new Highlight(range));
    } catch (e) { console.warn("search:highlight-selected", e); }
  }

  clearHighlights() {
    if (typeof CSS !== "undefined" && CSS.highlights) {
      try { CSS.highlights.delete("search-results"); } catch (e) { console.warn("search:clearHighlight", e); }
      try { CSS.highlights.delete("search-selected"); } catch (e) { console.warn("search:clearHighlight", e); }
    }
    this._highlightRanges = [];
  }
}
