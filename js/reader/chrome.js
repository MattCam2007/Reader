import { pageOfWord, wordRange, layoutScale } from '../model/geometry.js';

export class ChromeManager {
  constructor(state, els) {
    this.state = state;
    this.els = els;
    this._lastBmIds = null;
    this._lastBmLayoutSig = null;
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

    // (Re)build marker buttons only when the bookmark set changes (ids + colors).
    if (bmMarkersEl) {
      const ids = items.map(i => i.id + (i.color || '')).join(',');
      const rebuilt = ids !== this._lastBmIds;
      if (rebuilt) {
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
            if (item.color) btn.style.setProperty('--bm-color', `var(--bm-${item.color})`);
            btn.addEventListener('click', (e) => { e.stopPropagation(); navigateFn(item); });
            frag.appendChild(btn);
          }
          bmMarkersEl.appendChild(frag);
        }
      }
      // Position each dot with the same metric the scrubber thumb uses, so it
      // sits exactly under the thumb when you reach that bookmark. The mapping
      // is layout-dependent (scroll height / page count), so recompute it when
      // the set is rebuilt or the layout signature changes — but skip it on
      // ordinary page turns, where neither moves.
      if (items.length) {
        const sig = this._bmLayoutSig();
        if (rebuilt || sig !== this._lastBmLayoutSig) {
          this._lastBmLayoutSig = sig;
          this._positionBookmarkMarkers(items, bmMarkersEl.children);
        }
      } else {
        this._lastBmLayoutSig = null;
      }
    }

    // Update quick-bm button color to match the bookmark on this page
    this.refreshQuickBmState(items);
  }

  // Light the quick-bookmark button iff a bookmark sits on the current
  // page/screen. Split from updateBookmarkMarkers so scroll mode can re-check
  // on scroll without rebuilding or repositioning the marker dots.
  refreshQuickBmState(items) {
    const { quickBmBtnEl } = this.els;
    if (!quickBmBtnEl) return;
    const pageItems = items.length > 0 ? this.getPageBookmarks(items) : [];
    const onPage = pageItems.length > 0;
    quickBmBtnEl.classList.toggle('bookmarked', onPage);
    if (onPage && pageItems[0].color) {
      quickBmBtnEl.style.setProperty('--bm-active-color', `var(--bm-${pageItems[0].color})`);
    } else {
      quickBmBtnEl.style.removeProperty('--bm-active-color');
    }
  }

  // A cheap fingerprint of the layout inputs that move marker dots. Scroll mode
  // tracks total scroll height; paginated tracks page count; windowed positions
  // dots by word fraction (layout-independent), so its signature is constant.
  _bmLayoutSig() {
    const { state, els } = this;
    if (state.isScrollMode) return 's' + (els.viewport.scrollHeight - els.viewport.clientHeight);
    if (state.windowed) return 'w';
    return 'p' + state.total;
  }

  // Place each marker dot at the track fraction matching its mode's scrubber
  // thumb: scroll -> word's scroll offset / scrollable height; paginated ->
  // word's page / last page; windowed -> word fraction (the bar already is a
  // word-fraction scrubber). `nodes` is the live .bm-marker list, 1:1 with items.
  _positionBookmarkMarkers(items, nodes) {
    const { state, els } = this;
    const wsToToken = state.doc.wsToToken;
    const totalWs = wsToToken.length;
    // Shared layout reads, hoisted out of the per-bookmark loop.
    const scrollMode = state.isScrollMode;
    let sh = 0, contentTop = 0, scale = 1;
    if (scrollMode) {
      sh = els.viewport.scrollHeight - els.viewport.clientHeight;
      contentTop = els.content.getBoundingClientRect().top;
      scale = layoutScale(els.content);
    }
    const total = state.total;
    for (let i = 0; i < items.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      const f = items[i].fraction || 0;
      let pos = f; // windowed (and any fallback): the bar is a word-fraction scrubber
      const tok = totalWs ? wsToToken[Math.round(f * (totalWs - 1))] : null;
      if (tok != null && !state.windowed) {
        if (scrollMode) {
          if (sh > 0) {
            const range = wordRange(state, tok);
            if (range) {
              // Word's offset from content top, de-scaled to layout px (the
              // viewport transform scales rects but not scrollHeight), as a
              // fraction of the scrollable range = where the thumb lands here.
              const off = (range.getBoundingClientRect().top - contentTop) / scale;
              pos = Math.max(0, Math.min(1, off / sh));
            }
          }
        } else if (total > 1) {
          pos = pageOfWord(state, els.content, tok) / (total - 1);
        }
      }
      node.style.setProperty('--bm-f', String(pos));
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
    // Paginated: measure the bookmark word's real page, exactly like the
    // windowed branch. Estimating the page as fraction × pages assumes uniform
    // word density per page, which drifts (headings, images, short chapters)
    // and breaks the anchor/check/navigate symmetry the quick-bookmark button
    // depends on: navigation lands on the word's measured page, so presence
    // must be measured the same way.
    const wsToToken = state.doc.wsToToken;
    const totalWs = wsToToken.length;
    if (state.total <= 0 || !totalWs) return [];
    return items.filter(item => {
      const tok = wsToToken[Math.round((item.fraction || 0) * (totalWs - 1))];
      return tok != null && pageOfWord(state, els.content, tok) === state.page;
    });
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
