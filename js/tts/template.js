export function ttsTemplate() {
  return `
  <a href="#ttsContent" class="reader-skip-link">Skip to content</a>

  <div class="reader-comfort-overlay" id="comfortOverlay">
    <div class="reader-comfort-dim" id="comfortDim"></div>
    <div class="reader-comfort-warm" id="comfortWarm"></div>
  </div>

  <div class="tts-viewport margin-normal" id="ttsViewport">
    <div class="tts-content" id="ttsContent"></div>
  </div>

  <header class="reader-topbar" id="topbar">
    <div class="reader-book-title" id="bookTitle">Reader</div>
    <div class="reader-book-sub" id="bookSub">&nbsp;</div>
  </header>

  <footer class="tts-bottombar" id="ttsBottombar">
    <div class="tts-transport">
      <button class="tts-transport-btn" id="ttsPrevBtn" type="button" aria-label="Previous sentence">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="19,20 9,12 19,4"/><line x1="5" y1="4" x2="5" y2="20"/></svg>
      </button>
      <button class="tts-play-btn" id="ttsPlayBtn" type="button" aria-label="Play">
        <svg class="tts-play-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
        <svg class="tts-pause-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
      <button class="tts-transport-btn" id="ttsNextBtn" type="button" aria-label="Next sentence">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="19" y1="4" x2="19" y2="20"/><polyline points="5,4 15,12 5,20"/></svg>
      </button>
      <div class="tts-rate-seg" id="ttsRateSeg" role="group" aria-label="Reading speed">
        <button class="tts-rate-btn" data-rate="0.75" type="button">0.75×</button>
        <button class="tts-rate-btn active" data-rate="1" type="button">1×</button>
        <button class="tts-rate-btn" data-rate="1.25" type="button">1.25×</button>
        <button class="tts-rate-btn" data-rate="1.5" type="button">1.5×</button>
        <button class="tts-rate-btn" data-rate="2" type="button">2×</button>
      </div>
      <button class="tts-transport-btn" id="ttsVoiceBtn" type="button" aria-label="Voice" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </button>
    </div>
    <div class="tts-toolbar">
      <button class="reader-tool" id="ttsTocBtn" type="button" aria-label="Contents" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
        <span>Contents</span>
      </button>
      <button class="reader-tool" id="ttsSettingsBtn" type="button" aria-label="Settings" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="10" cy="8" r="2.6"/><circle cx="15" cy="16" r="2.6"/></svg>
        <span>Settings</span>
      </button>
      <button class="reader-tool" id="ttsModeMenuBtn" type="button" aria-label="Switch mode" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="16,3 21,8 16,13"/><line x1="3" y1="8" x2="21" y2="8"/><polyline points="8,11 3,16 8,21"/><line x1="21" y1="16" x2="3" y2="16"/></svg>
        <span>Mode</span>
      </button>
      <button class="reader-tool" id="ttsBookBtn" type="button" aria-label="Book" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-1.8-1.3-4.6-1.6-7-0.8v12c2.4-0.8 5.2-0.5 7 0.8 1.8-1.3 4.6-1.6 7-0.8V5.2c-2.4-0.8-5.2-0.5-7 0.8z"/><line x1="12" y1="6" x2="12" y2="18.8"/></svg>
        <span>Book</span>
      </button>
    </div>
  </footer>

  <div class="book-submenu" id="ttsModeMenu" hidden>
    <button class="book-submenu-item" id="ttsReadBtn" type="button" aria-label="Book mode">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-1.8-1.3-4.6-1.6-7-0.8v12c2.4-0.8 5.2-0.5 7 0.8 1.8-1.3 4.6-1.6 7-0.8V5.2c-2.4-0.8-5.2-0.5-7 0.8z"/><line x1="12" y1="6" x2="12" y2="18.8"/></svg>
      Read
    </button>
    <button class="book-submenu-item" id="ttsSpeedBtn" type="button" aria-label="Speed read mode">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
      Speed
    </button>
  </div>

  <div class="book-submenu" id="ttsBookMenu" hidden>
    <button class="book-submenu-item" id="ttsOpenBtn" type="button" aria-label="Open EPUB">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      Open
    </button>
    <button class="book-submenu-item" id="ttsSearchBtn" type="button" aria-label="Search" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
      Search
    </button>
    <button class="book-submenu-item" id="ttsBookmarksBtn" type="button" aria-label="Bookmarks" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      Bookmarks
    </button>
  </div>

  <div class="ui-backdrop" id="backdrop"></div>

  <div class="bm-panel" id="ttsBookmarksPanel" role="dialog" aria-modal="true" aria-label="Bookmarks">
    <div class="bm-panel-head">
      <button class="bm-close-btn" id="ttsBmCloseBtn" type="button" aria-label="Close bookmarks">
        <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="bm-panel-title">Bookmarks</div>
      <button class="bm-add-btn" id="ttsBmAddBtn" type="button">+ Add</button>
    </div>
    <div class="bm-panel-list" id="ttsBmList"></div>
  </div>

  <div class="reader-search-panel" id="ttsSearchPanel" role="search" aria-label="Search in book">
    <div class="reader-search-head">
      <input class="reader-search-input" id="ttsSearchInput" type="search" placeholder="Search in book…" autocomplete="off">
    </div>
    <div class="reader-search-results" id="ttsSearchResults"></div>
  </div>

  <nav class="reader-toc" id="toc" role="dialog" aria-modal="true" aria-label="Table of contents">
    <div class="reader-toc-head">Contents</div>
    <div class="reader-toc-list" id="tocList"></div>
  </nav>

  <div class="tts-voice-panel" id="ttsVoicePanel" role="dialog" aria-modal="true" aria-label="Voice selection">
    <div class="tts-voice-panel-head">Voice</div>
    <div id="ttsVoiceList"></div>
  </div>

  <div class="reader-overlay" id="overlay">
    <div class="reader-spinner" id="spinner"></div>
    <div class="reader-overlay-msg" id="overlayMsg">Loading\u2026</div>
    <button class="ui-chip" id="overlayBtn" type="button" hidden>Open EPUB</button>
  </div>

  <div class="tts-coach hide" id="ttsCoach" role="status" aria-hidden="true">
    <div class="reader-coach-card">Tap <b>Play</b> to start listening.</div>
  </div>`;
}
