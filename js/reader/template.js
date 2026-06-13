export function readerTemplate() {
  return `
  <a href="#content" class="reader-skip-link">Skip to content</a>

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
    <button class="reader-quick-bm" id="quickBmBtn" type="button" aria-label="Bookmark this page">
      <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
    </button>
    <div class="reader-book-title" id="bookTitle">Reader</div>
    <div class="reader-book-sub" id="bookSub">&nbsp;</div>
    <button class="reader-fullscreen-btn" id="fullscreenBtn" type="button" aria-label="Toggle fullscreen">
      <svg class="fs-expand-icon" viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      <svg class="fs-shrink-icon" viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="4,14 4,20 10,20"/><polyline points="20,10 20,4 14,4"/><line x1="14" y1="10" x2="3" y2="21"/><line x1="21" y1="3" x2="10" y2="14"/></svg>
    </button>
  </header>

  <footer class="reader-bottombar" id="bottombar">
    <div class="reader-quick-drawer" id="readerQuickDrawer">
      <button class="reader-drawer-handle" id="readerDrawerHandle" type="button" aria-label="Show quick settings">
        <span class="reader-drawer-pip"></span>
      </button>
      <div class="reader-quick-panel is-collapsed" id="readerQuickPanel">
        <div class="reader-quick-panel-inner">
          <div class="reader-quick-row">
            <div class="reader-quick-item">
              <span class="reader-quick-label">Size</span>
              <div class="reader-quick-counter">
                <button class="reader-quick-step" id="qdSizeDown" type="button" aria-label="Decrease font size">−</button>
                <span class="reader-quick-val" id="qdSizeVal">19</span>
                <button class="reader-quick-step" id="qdSizeUp" type="button" aria-label="Increase font size">+</button>
              </div>
            </div>
            <div class="reader-quick-item">
              <span class="reader-quick-label">Spacing</span>
              <div class="reader-quick-counter">
                <button class="reader-quick-step" id="qdLhDown" type="button" aria-label="Decrease line spacing">−</button>
                <span class="reader-quick-val" id="qdLhVal">1.6</span>
                <button class="reader-quick-step" id="qdLhUp" type="button" aria-label="Increase line spacing">+</button>
              </div>
            </div>
          </div>
          <div class="reader-quick-row">
            <div class="reader-quick-item reader-quick-item--wide">
              <span class="reader-quick-label">Typeface</span>
              <div class="reader-seg reader-seg--fill" id="qdFontSeg">
                <button class="reader-seg-btn" data-font="serif" type="button">Serif</button>
                <button class="reader-seg-btn" data-font="sans" type="button">Sans</button>
                <button class="reader-seg-btn" data-font="dyslexic" type="button">Dyslexic</button>
              </div>
            </div>
          </div>
          <div class="reader-quick-row">
            <div class="reader-quick-item reader-quick-item--wide">
              <span class="reader-quick-label">Paragraphs</span>
              <div class="reader-seg reader-seg--fill" id="qdParaSeg">
                <button class="reader-seg-btn" data-para="indent" type="button">Indented</button>
                <button class="reader-seg-btn" data-para="spaced" type="button">Spaced</button>
                <button class="reader-seg-btn" data-para="both" type="button">Both</button>
              </div>
            </div>
          </div>
          <div class="reader-quick-row">
            <div class="reader-quick-item reader-quick-item--wide">
              <span class="reader-quick-label">Margins</span>
              <div class="reader-seg reader-seg--fill" id="qdMarginSeg">
                <button class="reader-seg-btn" data-margin="fine" type="button">Fine</button>
                <button class="reader-seg-btn" data-margin="narrow" type="button">Narrow</button>
                <button class="reader-seg-btn" data-margin="normal" type="button">Normal</button>
                <button class="reader-seg-btn" data-margin="wide" type="button">Wide</button>
              </div>
            </div>
          </div>
          <div class="reader-quick-row">
            <div class="reader-quick-item reader-quick-item--wide">
              <span class="reader-quick-label">Alignment</span>
              <div class="reader-seg reader-seg--fill" id="qdAlignSeg">
                <button class="reader-seg-btn" data-align="justify" type="button">Justify</button>
                <button class="reader-seg-btn" data-align="left" type="button">Left</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="reader-scrub">
      <div class="bm-track-wrap">
        <input type="range" class="reader-progress" id="progress" min="0" max="0" value="0" step="1" aria-label="Reading position">
        <div class="bm-markers" id="bmMarkers" aria-hidden="true"></div>
      </div>
      <div class="reader-progress-label" id="progressLabel" aria-live="polite">&nbsp;</div>
    </div>
    <div class="reader-toolbar">
      <button class="reader-tool" id="tocBtn" type="button" aria-label="Contents" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
        <span>Contents</span>
      </button>
      <button class="reader-tool" id="settingsBtn" type="button" aria-label="Settings" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="10" cy="8" r="2.6"/><circle cx="15" cy="16" r="2.6"/></svg>
        <span>Settings</span>
      </button>
      <button class="reader-tool" id="modeMenuBtn" type="button" aria-label="Switch mode" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="16,3 21,8 16,13"/><line x1="3" y1="8" x2="21" y2="8"/><polyline points="8,11 3,16 8,21"/><line x1="21" y1="16" x2="3" y2="16"/></svg>
        <span>Mode</span>
      </button>
      <button class="reader-tool" id="bookBtn" type="button" aria-label="Book" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-1.8-1.3-4.6-1.6-7-0.8v12c2.4-0.8 5.2-0.5 7 0.8 1.8-1.3 4.6-1.6 7-0.8V5.2c-2.4-0.8-5.2-0.5-7 0.8z"/><line x1="12" y1="6" x2="12" y2="18.8"/></svg>
        <span>Book</span>
      </button>
    </div>
  </footer>

  <div class="book-submenu" id="modeMenu" hidden>
    <button class="book-submenu-item" id="modeBtn" type="button" aria-label="Speed read mode">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
      Speed
    </button>
    <button class="book-submenu-item" id="ttsModeBtn" type="button" aria-label="Listen with TTS">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      Listen
    </button>
  </div>

  <div class="book-submenu" id="bookMenu" hidden>
    <button class="book-submenu-item" id="openBtn" type="button" aria-label="Open book">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      Open
    </button>
    <button class="book-submenu-item" id="searchBtn" type="button" aria-label="Search" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
      Search
    </button>
    <button class="book-submenu-item" id="bookmarksBtn" type="button" aria-label="Bookmarks" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      Bookmarks
    </button>
  </div>

  <div class="bm-color-popover" id="bmColorPopover" hidden>
    <button class="bm-cp-clear" data-color="" type="button" aria-label="Remove color">✕</button>
    <button class="bm-cp-swatch" data-color="c1" style="--swatch:var(--bm-c1)" type="button" aria-label="Color 1"></button>
    <button class="bm-cp-swatch" data-color="c2" style="--swatch:var(--bm-c2)" type="button" aria-label="Color 2"></button>
    <button class="bm-cp-swatch" data-color="c3" style="--swatch:var(--bm-c3)" type="button" aria-label="Color 3"></button>
    <button class="bm-cp-swatch" data-color="c4" style="--swatch:var(--bm-c4)" type="button" aria-label="Color 4"></button>
    <button class="bm-cp-swatch" data-color="c5" style="--swatch:var(--bm-c5)" type="button" aria-label="Color 5"></button>
    <div class="bm-cp-sep"></div>
    <button class="bm-cp-delete" type="button" aria-label="Remove bookmark">
      <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/><path d="M9,6V4h6v2"/></svg>
    </button>
  </div>

  <div class="ui-backdrop" id="backdrop"></div>

  <nav class="reader-toc" id="toc" role="dialog" aria-modal="true" aria-label="Table of contents">
    <div class="reader-toc-head">Contents</div>
    <div class="reader-toc-list" id="tocList"></div>
  </nav>

  <div class="bm-panel" id="bookmarksPanel" role="dialog" aria-modal="true" aria-label="Bookmarks">
    <div class="bm-panel-head">
      <button class="bm-close-btn" id="bmCloseBtn" type="button" aria-label="Close bookmarks">
        <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="bm-panel-title">Bookmarks</div>
      <button class="bm-add-btn" id="bmAddBtn" type="button">+ Add</button>
    </div>
    <div class="bm-panel-list" id="bmList"></div>
  </div>

  <div class="reader-search-panel" id="searchPanel" role="search" aria-label="Search in book">
    <div class="reader-search-head">
      <input class="reader-search-input" id="searchInput" type="search" placeholder="Search in book\u2026" autocomplete="off">
    </div>
    <div class="reader-search-results" id="searchResults"></div>
  </div>

  <div class="reader-overlay" id="overlay">
    <div class="reader-spinner" id="spinner"></div>
    <div class="reader-overlay-msg" id="overlayMsg">Loading\u2026</div>
    <button class="ui-chip" id="overlayBtn" type="button" hidden>Open book</button>
  </div>

  `;
}
