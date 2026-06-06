import { pageOfWord } from '../model/geometry.js';

export class ChromeManager {
  constructor(state, els) {
    this.state = state;
    this.els = els;
    this._lastBmIds = null;
  }

  toggle() {
    document.body.classList.toggle("chrome-hidden");
    this.updateViewportScale();
  }

  updateViewportScale() {
    const { els } = this;
    if (!els.viewport || !els.topbar || !els.bottombar) return;
    const vpH = window.innerHeight;
    const topH = els.topbar.offsetHeight;
    const botH = els.bottombar.offsetHeight;
    const avail = vpH - topH - botH;
    const scale = avail / vpH;
    const ty = (topH - botH) / 2;
    els.viewport.style.setProperty('--vp-scale', scale);
    els.viewport.style.setProperty('--vp-ty', ty + 'px');
  }

  updateProgress() {
    const { state, els } = this;
    const { progressEl, progressLabel, bookSubEl } = els;
    if (state.isScrollMode) {
      const sh = els.viewport.scrollHeight - els.viewport.clientHeight;
      const pct = sh > 0 ? Math.round((els.viewport.scrollTop / sh) * 100) : 100;
      progressLabel.textContent = pct + "% read";
      if (bookSubEl) {
        const ch = this._currentChapterLabel();
        bookSubEl.textContent = ch ? ch + " \u00b7 " + pct + "%" : pct + "%";
      }
      return;
    }
    progressEl.value = String(state.page);
    const pct = state.total > 1 ? Math.round((state.page / (state.total - 1)) * 100) : 100;
    progressLabel.textContent = "Page " + (state.page + 1) + " of " + state.total;
    if (bookSubEl) {
      const ch = this._currentChapterLabel();
      bookSubEl.textContent = ch ? ch + " \u00b7 " + pct + "%" : pct + "%";
    }
  }

  updateBookmarkMarkers(items, navigateFn) {
    const { bmMarkersEl, quickBmBtnEl } = this.els;

    // Re-render markers only when the bookmark set changes (ids + colors)
    if (bmMarkersEl) {
      const ids = items.map(i => i.id + (i.color || '')).join(',');
      if (ids !== this._lastBmIds) {
        this._lastBmIds = ids;
        bmMarkersEl.innerHTML = '';
        if (items.length) {
          const frag = document.createDocumentFragment();
          for (const item of items) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bm-marker';
            const pct = Math.round(item.fraction * 100);
            btn.setAttribute('aria-label', `Go to bookmark: ${item.chapterLabel ? item.chapterLabel + ' · ' : ''}${pct}%`);
            btn.title = `${item.chapterLabel ? item.chapterLabel + ' · ' : ''}${pct}%`;
            btn.style.setProperty('--bm-f', String(item.fraction));
            if (item.color) btn.style.setProperty('--bm-color', `var(--bm-${item.color})`);
            btn.addEventListener('click', (e) => { e.stopPropagation(); navigateFn(item); });
            frag.appendChild(btn);
          }
          bmMarkersEl.appendChild(frag);
        }
      }
    }

    // Update quick-bm button color to match the bookmark on this page
    const pageItems = items.length > 0 ? this.getPageBookmarks(items) : [];
    const onPage = pageItems.length > 0;
    if (quickBmBtnEl) {
      quickBmBtnEl.classList.toggle('bookmarked', onPage);
      if (onPage && pageItems[0].color) {
        quickBmBtnEl.style.setProperty('--bm-active-color', `var(--bm-${pageItems[0].color})`);
      } else {
        quickBmBtnEl.style.removeProperty('--bm-active-color');
      }
    }
  }

  getPageBookmarks(items) {
    const { state, els } = this;
    if (state.isScrollMode) {
      const sh = els.viewport.scrollHeight - els.viewport.clientHeight;
      if (sh <= 0) return [];
      const scrollTop = els.viewport.scrollTop;
      const threshold = els.viewport.clientHeight * 0.55;
      return items.filter(item => Math.abs(item.fraction * sh - scrollTop) < threshold);
    }
    if (state.windowed) {
      const wsToToken = state.doc.wsToToken;
      const totalWs = wsToToken.length;
      const sec = state.doc.sections[state.curChap];
      if (!totalWs || !sec) return [];
      return items.filter(item => {
        const bmWs = Math.round((item.fraction || 0) * (totalWs - 1));
        if (bmWs < sec.wsStart || bmWs >= sec.wsEnd) return false;
        const tok = wsToToken[bmWs];
        return tok != null && pageOfWord(state, els.content, tok) === state.page;
      });
    }
    const total = state.total;
    if (total <= 0) return [];
    return items.filter(item => Math.round(item.fraction * (total - 1)) === state.page);
  }

  _bookmarksOnCurrentPage(items) {
    const { state, els } = this;
    if (state.isScrollMode) {
      const sh = els.viewport.scrollHeight - els.viewport.clientHeight;
      if (sh <= 0) return false;
      const scrollTop = els.viewport.scrollTop;
      const threshold = els.viewport.clientHeight * 0.55;
      return items.some(item => Math.abs(item.fraction * sh - scrollTop) < threshold);
    }
    if (state.windowed) {
      // item.fraction is a global word fraction; total/page are per-chapter. Only a
      // bookmark whose word lands in the currently-attached chapter can be on this
      // page — for those, measure the real page exactly (the chapter is laid out).
      const wsToToken = state.doc.wsToToken;
      const totalWs = wsToToken.length;
      const sec = state.doc.sections[state.curChap];
      if (!totalWs || !sec) return false;
      return items.some(item => {
        const bmWs = Math.round((item.fraction || 0) * (totalWs - 1));
        if (bmWs < sec.wsStart || bmWs >= sec.wsEnd) return false; // other chapter
        const tok = wsToToken[bmWs];
        return tok != null && pageOfWord(state, els.content, tok) === state.page;
      });
    }
    const total = state.total;
    if (total <= 0) return false;
    return items.some(item => Math.round(item.fraction * (total - 1)) === state.page);
  }

  currentChapterLabel() { return this._currentChapterLabel(); }

  _currentChapterLabel() {
    const { chapterIndex, page } = this.state;
    if (!chapterIndex.length) return "";
    let label = chapterIndex[0].label;
    for (let i = chapterIndex.length - 1; i >= 0; i--) {
      if (chapterIndex[i].page <= page) {
        label = chapterIndex[i].label;
        break;
      }
    }
    return label;
  }
}
