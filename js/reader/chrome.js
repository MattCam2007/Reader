export class ChromeManager {
  constructor(state, els) {
    this.state = state;
    this.els = els;
    this._lastBmIds = null;
  }

  toggle() {
    document.body.classList.toggle("chrome-hidden");
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
    const { bmMarkersEl, bmPageIndicatorEl } = this.els;

    // Re-render markers only when the bookmark set changes
    if (bmMarkersEl) {
      const ids = items.map(i => i.id).join(',');
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
            btn.addEventListener('click', (e) => { e.stopPropagation(); navigateFn(item); });
            frag.appendChild(btn);
          }
          bmMarkersEl.appendChild(frag);
        }
      }
    }

    // Update page indicator
    if (bmPageIndicatorEl) {
      const onPage = items.length > 0 && this._bookmarksOnCurrentPage(items);
      bmPageIndicatorEl.classList.toggle('visible', onPage);
    }
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
