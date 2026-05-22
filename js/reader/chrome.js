export class ChromeManager {
  constructor(state, els) {
    this.state = state;
    this.els = els;
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
