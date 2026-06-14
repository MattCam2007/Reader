import { t } from '../core/i18n.js';

export function readerTemplate() {
  return `
  <a href="#content" class="reader-skip-link">${t('a11y.skipToContent')}</a>

  <div class="reader-comfort-overlay" id="comfortOverlay">
    <div class="reader-comfort-dim" id="comfortDim"></div>
    <div class="reader-comfort-warm" id="comfortWarm"></div>
  </div>
  <div class="reader-viewport margin-normal" id="viewport">
    <div class="reader-content-clip" id="contentClip">
      <div class="reader-content" id="content"></div>
    </div>
  </div>

  <header class="reader-topbar" id="topbar">
    <button class="reader-quick-bm" id="quickBmBtn" type="button" aria-label="${t('a11y.bookmarkPage')}">
      <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
    </button>
    <div class="reader-book-title" id="bookTitle">${t('app.title')}</div>
    <div class="reader-book-sub" id="bookSub">&nbsp;</div>
    <button class="reader-fullscreen-btn" id="fullscreenBtn" type="button" aria-label="${t('a11y.toggleFullscreen')}">
      <svg class="fs-expand-icon" viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      <svg class="fs-shrink-icon" viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="4,14 4,20 10,20"/><polyline points="20,10 20,4 14,4"/><line x1="14" y1="10" x2="3" y2="21"/><line x1="21" y1="3" x2="10" y2="14"/></svg>
    </button>
  </header>

  <footer class="reader-bottombar" id="bottombar">
    <div class="reader-quick-drawer" id="readerQuickDrawer">
      <button class="reader-drawer-handle" id="readerDrawerHandle" type="button" aria-label="${t('a11y.showQuickSettings')}">
        <span class="reader-drawer-pip"></span>
      </button>
      <div class="reader-quick-panel is-collapsed" id="readerQuickPanel">
        <div class="reader-quick-panel-inner">
          <div class="reader-quick-row">
            <div class="reader-quick-item">
              <span class="reader-quick-label">${t('quick.size')}</span>
              <div class="reader-quick-counter">
                <button class="reader-quick-step" id="qdSizeDown" type="button" aria-label="${t('a11y.decreaseFontSize')}">−</button>
                <span class="reader-quick-val" id="qdSizeVal">19</span>
                <button class="reader-quick-step" id="qdSizeUp" type="button" aria-label="${t('a11y.increaseFontSize')}">+</button>
              </div>
            </div>
            <div class="reader-quick-item">
              <span class="reader-quick-label">${t('quick.spacing')}</span>
              <div class="reader-quick-counter">
                <button class="reader-quick-step" id="qdLhDown" type="button" aria-label="${t('a11y.decreaseLineSpacing')}">−</button>
                <span class="reader-quick-val" id="qdLhVal">1.6</span>
                <button class="reader-quick-step" id="qdLhUp" type="button" aria-label="${t('a11y.increaseLineSpacing')}">+</button>
              </div>
            </div>
          </div>
          <div class="reader-quick-row">
            <div class="reader-quick-item reader-quick-item--wide">
              <span class="reader-quick-label">${t('quick.typeface')}</span>
              <div class="font-picker" id="qdFontPicker">
                <button class="font-picker-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
                  <span class="font-picker-label">Serif</span>
                  <svg class="font-picker-chevron" viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,1 5,5 9,1"/></svg>
                </button>
                <div class="font-picker-panel" role="listbox" hidden></div>
              </div>
            </div>
          </div>
          <div class="reader-quick-row">
            <div class="reader-quick-item reader-quick-item--wide">
              <span class="reader-quick-label">${t('quick.paragraphs')}</span>
              <div class="reader-seg reader-seg--fill" id="qdParaSeg">
                <button class="reader-seg-btn" data-para="indent" type="button">${t('opt.indented')}</button>
                <button class="reader-seg-btn" data-para="spaced" type="button">${t('opt.spaced')}</button>
                <button class="reader-seg-btn" data-para="both" type="button">${t('opt.both')}</button>
              </div>
            </div>
          </div>
          <div class="reader-quick-row">
            <div class="reader-quick-item reader-quick-item--wide">
              <span class="reader-quick-label">${t('quick.margins')}</span>
              <div class="reader-seg reader-seg--fill" id="qdMarginSeg">
                <button class="reader-seg-btn" data-margin="fine" type="button">${t('opt.fine')}</button>
                <button class="reader-seg-btn" data-margin="narrow" type="button">${t('opt.narrow')}</button>
                <button class="reader-seg-btn" data-margin="normal" type="button">${t('opt.normal')}</button>
                <button class="reader-seg-btn" data-margin="wide" type="button">${t('opt.wide')}</button>
              </div>
            </div>
          </div>
          <div class="reader-quick-row">
            <div class="reader-quick-item reader-quick-item--wide">
              <span class="reader-quick-label">${t('quick.alignment')}</span>
              <div class="reader-seg reader-seg--fill" id="qdAlignSeg">
                <button class="reader-seg-btn" data-align="justify" type="button">${t('opt.justify')}</button>
                <button class="reader-seg-btn" data-align="left" type="button">${t('opt.left')}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="reader-scrub">
      <div class="bm-track-wrap">
        <input type="range" class="reader-progress" id="progress" min="0" max="0" value="0" step="1" aria-label="${t('a11y.readingPosition')}">
        <div class="bm-markers" id="bmMarkers" aria-hidden="true"></div>
      </div>
      <div class="reader-progress-label" id="progressLabel" aria-live="polite">&nbsp;</div>
    </div>
    <div class="reader-toolbar">
      <button class="reader-tool" id="tocBtn" type="button" aria-label="${t('nav.contents')}" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
        <span>${t('nav.contents')}</span>
      </button>
      <button class="reader-tool" id="settingsBtn" type="button" aria-label="${t('nav.settings')}" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="10" cy="8" r="2.6"/><circle cx="15" cy="16" r="2.6"/></svg>
        <span>${t('nav.settings')}</span>
      </button>
      <button class="reader-tool" id="modeMenuBtn" type="button" aria-label="${t('a11y.switchMode')}" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="16,3 21,8 16,13"/><line x1="3" y1="8" x2="21" y2="8"/><polyline points="8,11 3,16 8,21"/><line x1="21" y1="16" x2="3" y2="16"/></svg>
        <span>${t('nav.mode')}</span>
      </button>
      <button class="reader-tool" id="bookBtn" type="button" aria-label="${t('nav.book')}" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-1.8-1.3-4.6-1.6-7-0.8v12c2.4-0.8 5.2-0.5 7 0.8 1.8-1.3 4.6-1.6 7-0.8V5.2c-2.4-0.8-5.2-0.5-7 0.8z"/><line x1="12" y1="6" x2="12" y2="18.8"/></svg>
        <span>${t('nav.book')}</span>
      </button>
    </div>
  </footer>

  <div class="book-submenu" id="modeMenu" hidden>
    <button class="book-submenu-item" id="modeBtn" type="button" aria-label="${t('a11y.speedReadMode')}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
      ${t('nav.speed')}
    </button>
    <button class="book-submenu-item" id="ttsModeBtn" type="button" aria-label="${t('a11y.listenTts')}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      ${t('nav.listen')}
    </button>
  </div>

  <div class="book-submenu" id="bookMenu" hidden>
    <button class="book-submenu-item" id="openBtn" type="button" aria-label="${t('a11y.openBook')}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      ${t('nav.open')}
    </button>
    <button class="book-submenu-item" id="searchBtn" type="button" aria-label="${t('nav.search')}" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
      ${t('nav.search')}
    </button>
    <button class="book-submenu-item" id="bookmarksBtn" type="button" aria-label="${t('nav.bookmarks')}" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      ${t('nav.bookmarks')}
    </button>
  </div>

  <div class="bm-color-popover" id="bmColorPopover" hidden>
    <button class="bm-cp-clear" data-color="" type="button" aria-label="${t('a11y.removeColor')}">✕</button>
    <button class="bm-cp-swatch" data-color="c1" style="--swatch:var(--bm-c1)" type="button" aria-label="${t('a11y.color', { n: 1 })}"></button>
    <button class="bm-cp-swatch" data-color="c2" style="--swatch:var(--bm-c2)" type="button" aria-label="${t('a11y.color', { n: 2 })}"></button>
    <button class="bm-cp-swatch" data-color="c3" style="--swatch:var(--bm-c3)" type="button" aria-label="${t('a11y.color', { n: 3 })}"></button>
    <button class="bm-cp-swatch" data-color="c4" style="--swatch:var(--bm-c4)" type="button" aria-label="${t('a11y.color', { n: 4 })}"></button>
    <button class="bm-cp-swatch" data-color="c5" style="--swatch:var(--bm-c5)" type="button" aria-label="${t('a11y.color', { n: 5 })}"></button>
    <div class="bm-cp-sep"></div>
    <button class="bm-cp-delete" type="button" aria-label="${t('a11y.removeBookmark')}">
      <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/><path d="M9,6V4h6v2"/></svg>
    </button>
  </div>

  <div class="ui-backdrop" id="backdrop"></div>

  <nav class="reader-toc" id="toc" role="dialog" aria-modal="true" aria-label="${t('a11y.tableOfContents')}">
    <div class="reader-toc-head">${t('nav.contents')}</div>
    <div class="reader-toc-list" id="tocList"></div>
  </nav>

  <div class="bm-panel" id="bookmarksPanel" role="dialog" aria-modal="true" aria-label="${t('nav.bookmarks')}">
    <div class="bm-panel-head">
      <button class="bm-close-btn" id="bmCloseBtn" type="button" aria-label="${t('a11y.closeBookmarks')}">
        <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="bm-panel-title">${t('nav.bookmarks')}</div>
      <button class="bm-add-btn" id="bmAddBtn" type="button">${t('btn.add')}</button>
    </div>
    <div class="bm-panel-list" id="bmList"></div>
  </div>

  <div class="reader-search-panel" id="searchPanel" role="search" aria-label="${t('a11y.searchInBook')}">
    <div class="reader-search-head">
      <input class="reader-search-input" id="searchInput" type="search" placeholder="${t('msg.searchInBook')}" autocomplete="off">
    </div>
    <div class="reader-search-results" id="searchResults"></div>
  </div>

  <div class="reader-overlay" id="overlay">
    <div class="reader-spinner" id="spinner"></div>
    <div class="reader-overlay-msg" id="overlayMsg">${t('msg.loading')}</div>
    <button class="ui-chip" id="overlayBtn" type="button" hidden>${t('btn.openBook')}</button>
  </div>

  `;
}
