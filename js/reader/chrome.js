import { pageOfWord, wordRange } from '../model/geometry.js';

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
      // Measure each bookmark's word against the live layout (the same geometry
      // scrollToWord uses) rather than estimating its scroll position from the
      // word-count fraction. fraction*scrollHeight assumes words are spread
      // evenly down the page, but density varies (headings, images, short
      // chapters), so the estimate drifts from where the word actually sits and
      // the just-saved bookmark reads as "not here". Map fraction -> ws ordinal
      // -> render token like the windowed/paginated branches, then treat the
      // bookmark as on-screen when its word's top is within ~half a viewport of
      // the top edge (mirrors the prior 0.55-screen threshold, accurately).
      const wsToToken = state.doc.wsToToken;
      const totalWs = wsToToken.length;
      if (!totalWs) return [];
      const vpTop = els.viewport.getBoundingClientRect().top;
      const margin = els.viewport.clientHeight * 0.55;
      return items.filter(item => {
        const tok = wsToToken[Math.round((item.fraction || 0) * (totalWs - 1))];
        if (tok == null) return false;
        const range = wordRange(state, tok);
        if (!range) return false;
        return Math.abs(range.getBoundingClientRect().top - vpTop) < margin;
      });
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
