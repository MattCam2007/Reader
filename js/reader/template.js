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
    <div class="reader-book-title" id="bookTitle">Reader</div>
    <div class="reader-book-sub" id="bookSub">&nbsp;</div>
    <button class="reader-quick-bm" id="quickBmBtn" type="button" aria-label="Bookmark this page">
      <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
    </button>
  </header>

  <footer class="reader-bottombar" id="bottombar">
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
      <button class="reader-tool" id="searchBtn" type="button" aria-label="Search" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
        <span>Search</span>
      </button>
      <button class="reader-tool" id="modeBtn" type="button" aria-label="Speed read mode">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
        <span>Speed</span>
      </button>
      <button class="reader-tool" id="ttsModeBtn" type="button" aria-label="Listen with TTS">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        <span>Listen</span>
      </button>
      <button class="reader-tool" id="bookmarksBtn" type="button" aria-label="Bookmarks" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        <span>Marks</span>
      </button>
      <button class="reader-tool" id="openBtn" type="button" aria-label="Open EPUB">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-1.8-1.3-4.6-1.6-7-0.8v12c2.4-0.8 5.2-0.5 7 0.8 1.8-1.3 4.6-1.6 7-0.8V5.2c-2.4-0.8-5.2-0.5-7 0.8z"/><line x1="12" y1="6" x2="12" y2="18.8"/></svg>
        <span>Open</span>
      </button>
    </div>
  </footer>

  <button class="bm-page-indicator" id="bmPageIndicator" type="button" aria-label="Bookmarked page — view bookmarks">
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="currentColor" stroke="none"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-4 7 4V5a2 2 0 0 0-2-2z"/></svg>
  </button>

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
    <button class="ui-chip" id="overlayBtn" type="button" hidden>Open EPUB</button>
  </div>

  <div class="reader-coach" id="coach" role="status" aria-hidden="true">
    <div class="reader-coach-card">Tap the <b>center</b> for the menu.<br>Swipe or tap the <b>edges</b> to turn pages.</div>
  </div>`;
}
