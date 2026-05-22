import { COLUMN_GAP } from '../core/constants.js';
import { buildDocModel } from '../model/doc-model.js';
import { pageOfWord, wordAtPageStart } from '../model/geometry.js';
import { resolveLocator } from '../model/locator.js';

export class PaginationEngine {
  constructor(state, els, currentLocatorFn, buildChapterIndexFn, updateProgressFn, savePosMainFn) {
    this.state = state;
    this.els = els;
    this.currentLocatorFn = currentLocatorFn;
    this.buildChapterIndexFn = buildChapterIndexFn;
    this.updateProgressFn = updateProgressFn;
    this.savePosMainFn = savePosMainFn;
  }

  setupColumns() {
    const { state, els } = this;
    const { content } = els;
    content.style.transition = "none";
    content.style.setProperty("--page-offset", "0px");
    const vpW = content.clientWidth;
    let cols = 1;
    const prefs = state._prefs.data;
    if (prefs.columns === "2" || (prefs.columns === "auto" && vpW > 700)) cols = 2;
    if (cols === 2) {
      content.style.columnCount = "2";
      content.style.columnWidth = "";
    } else {
      content.style.columnCount = "";
      content.style.columnWidth = vpW + "px";
    }
    content.style.columnGap = COLUMN_GAP + "px";
    state.stride = vpW + COLUMN_GAP;
  }

  paginate(keepFraction) {
    const { state, els } = this;
    const { content } = els;
    let savedLoc = null;
    const frac = (keepFraction && state.total > 1) ? state.page / (state.total - 1) : 0;
    if (keepFraction && state.docModelBuilt && state.doc.words.length) {
      savedLoc = this.currentLocatorFn();
    }

    if (state.isScrollMode) {
      content.style.columnWidth = "";
      content.style.columnGap = "";
      content.style.columnCount = "";
      content.style.transition = "none";
      content.style.setProperty("--page-offset", "0px");
      state.total = 1;
      state.page = 0;
      els.progressEl.max = "0";
      if (!state.docModelBuilt) { buildDocModel(state, content); state.docModelBuilt = true; }
      this.buildChapterIndexFn();
      if (savedLoc && state.doc.words.length) {
        const wi = resolveLocator(state, savedLoc);
        if (wi >= 0) this.scrollToWord(wi);
      }
      return;
    }

    this.setupColumns();
    void content.offsetWidth;
    state.total = Math.max(1, Math.round(content.scrollWidth / state.stride));
    els.progressEl.max = String(state.total - 1);

    if (!state.docModelBuilt) { buildDocModel(state, content); state.docModelBuilt = true; }

    if (savedLoc && state.doc.words.length) {
      const wi = resolveLocator(state, savedLoc);
      if (wi >= 0) {
        state.page = pageOfWord(state, content, wi);
      } else {
        state.page = Math.max(0, Math.min(state.total - 1, Math.round(frac * (state.total - 1))));
      }
    } else {
      state.page = Math.max(0, Math.min(state.total - 1, Math.round(frac * (state.total - 1))));
    }
    this.goTo(state.page, false);
    this.buildChapterIndexFn();
  }

  paginateQuick() {
    const { state, els } = this;
    const { content } = els;
    state.paginateGen++;
    const gen = state.paginateGen;

    if (state.pendingDetached.length) {
      state.pendingDetached.forEach(d => {
        if (d.marker.parentNode) {
          d.marker.parentNode.insertBefore(d.el, d.marker);
          d.marker.parentNode.removeChild(d.marker);
        }
      });
      state.pendingDetached = [];
    }

    const frac = state.total > 1 ? state.page / (state.total - 1) : 0;

    if (state.isScrollMode || !state.docModelBuilt || state.doc.words.length === 0) {
      this.paginate(true);
      return;
    }

    const estWordIdx = Math.min(Math.round(frac * (state.doc.words.length - 1)), state.doc.words.length - 1);
    const curSec = state.doc.words[estWordIdx].section;
    const firstSec = Math.max(0, curSec - 1);
    const lastSec = Math.min(state.doc.sections.length - 1, curSec + 1);
    const chaps = Array.from(content.children);
    const detached = [];
    chaps.forEach((c, i) => {
      if (i < firstSec || i > lastSec) {
        const marker = document.createComment("p" + i);
        content.insertBefore(marker, c);
        content.removeChild(c);
        detached.push({ el: c, marker });
      }
    });

    this.setupColumns();
    void content.offsetWidth;
    const quickTotal = Math.max(1, Math.round(content.scrollWidth / state.stride));

    const visStart = state.doc.sections[firstSec].wordStart;
    const visEnd = state.doc.sections[lastSec].wordEnd;
    const visFrac = visEnd > visStart ? (estWordIdx - visStart) / (visEnd - visStart) : 0;
    state.page = Math.max(0, Math.min(quickTotal - 1, Math.round(visFrac * (quickTotal - 1))));
    state.total = quickTotal;
    this.goTo(state.page, false);

    state.pendingDetached = detached;

    setTimeout(() => {
      if (gen !== state.paginateGen) return;
      content.style.visibility = "hidden";
      state.pendingDetached.forEach(d => {
        if (d.marker.parentNode) {
          d.marker.parentNode.insertBefore(d.el, d.marker);
          d.marker.parentNode.removeChild(d.marker);
        }
      });
      state.pendingDetached = [];
      void content.offsetWidth;
      state.total = Math.max(1, Math.round(content.scrollWidth / state.stride));
      els.progressEl.max = String(state.total - 1);
      state.page = pageOfWord(state, content, estWordIdx);
      content.style.transition = "none";
      content.style.setProperty("--page-offset", -(state.page * state.stride) + "px");
      content.style.visibility = "";
      this.updateProgressFn();
      this.savePosMainFn();
      this.buildChapterIndexFn();
    });
  }

  scrollToWord(wi) {
    const { state, els } = this;
    const { doc } = state;
    const w = doc.words[wi];
    if (!w) return;
    const range = document.createRange();
    range.setStart(w.node, w.start);
    range.setEnd(w.node, w.end);
    const rect = range.getBoundingClientRect();
    els.viewport.scrollTop += rect.top - els.viewport.getBoundingClientRect().top - 20;
  }

  goTo(p, animate) {
    const { state, els } = this;
    const { content } = els;
    const prefs = state._prefs.data;
    state.page = Math.max(0, Math.min(state.total - 1, p));
    const anim = animate ? (prefs.pageAnim || "slide") : "none";
    if (anim === "fade") {
      content.style.transition = "opacity 140ms ease";
      content.style.opacity = "0";
      setTimeout(() => {
        content.style.transition = "none";
        content.style.setProperty("--page-offset", -(state.page * state.stride) + "px");
        content.style.transition = "opacity 140ms ease";
        content.style.opacity = "1";
      }, 150);
    } else if (anim === "slide") {
      content.style.transition = "transform 240ms cubic-bezier(0.22,0.61,0.36,1)";
      content.style.setProperty("--page-offset", -(state.page * state.stride) + "px");
    } else {
      content.style.transition = "none";
      content.style.setProperty("--page-offset", -(state.page * state.stride) + "px");
    }
    this.updateProgressFn();
    this.savePosMainFn();
  }

  next() { if (this.state.page < this.state.total - 1) this.goTo(this.state.page + 1, true); }
  prev() { if (this.state.page > 0) this.goTo(this.state.page - 1, true); }
}
