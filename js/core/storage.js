import { SAVE_DEBOUNCE_MS } from './constants.js';

export class StorageManager {
  constructor(state, els) {
    this.state = state;
    this.els = els;
    this._saveTimer = null;
  }

  _writePosNow(currentLocatorFn, fractionFn) {
    const { state, els } = this;
    if (!state.bookId) return;
    let f;
    if (fractionFn) {
      f = fractionFn();
    } else if (state.isScrollMode) {
      const sh = els.viewport.scrollHeight - els.viewport.clientHeight;
      f = sh > 0 ? els.viewport.scrollTop / sh : 0;
    } else {
      f = state.total > 1 ? state.page / (state.total - 1) : 0;
    }
    try { localStorage.setItem("book:pos:" + state.bookId, JSON.stringify({ f })); }
    catch (e) { console.warn("storage:savePos", e); }
    if (state.doc.words.length && currentLocatorFn) {
      try {
        const loc = currentLocatorFn();
        if (loc) localStorage.setItem("reader:loc:" + state.bookId, JSON.stringify(loc));
      } catch (e) { console.warn("storage:saveLoc", e); }
    }
  }

  savePos(currentLocatorFn, fractionFn) {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._writePosNow(currentLocatorFn, fractionFn), SAVE_DEBOUNCE_MS);
  }

  flushPos(currentLocatorFn, fractionFn) {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._writePosNow(currentLocatorFn, fractionFn);
  }

  restorePos(goToWordFn, scrollToWordFn, goToPageFn, resolveLocatorFn) {
    const { state, els } = this;
    // Prefer word-level locator
    try {
      const raw = localStorage.getItem("reader:loc:" + state.bookId);
      if (raw && state.doc.words.length) {
        const loc = JSON.parse(raw);
        const wi = resolveLocatorFn(loc);
        if (wi >= 0) {
          if (state.isScrollMode) scrollToWordFn(wi);
          else goToWordFn(wi);
          return;
        }
      }
    } catch (e) { console.warn("storage:restoreLoc", e); }
    // Fall back to fraction
    let f = 0;
    try {
      const raw = localStorage.getItem("book:pos:" + state.bookId);
      if (raw) f = JSON.parse(raw).f || 0;
    } catch (e) { console.warn("storage:restorePos", e); }
    if (state.isScrollMode) {
      const sh = els.viewport.scrollHeight - els.viewport.clientHeight;
      els.viewport.scrollTop = Math.round(f * sh);
    } else {
      goToPageFn(Math.round(f * (state.total - 1)));
    }
  }
}
