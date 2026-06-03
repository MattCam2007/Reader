export function rsvpTemplate() {
  return `
  <a href="#readerWrap" class="reader-skip-link">Skip to reader</a>

  <header class="rsvp-topbar" id="topbar">
    <div class="rsvp-topbar-spacer"></div>
    <div class="rsvp-topbar-center">
      <div class="reader-book-title" id="bookTitle">Speed Reader</div>
      <div class="rsvp-stats" role="status" aria-live="polite">
        <span id="statWords">0 words</span>
        <span class="rsvp-stats-sep">|</span>
        <span id="statTime">0:00</span>
        <span class="rsvp-stats-sep">|</span>
        <span id="statAvg">&mdash; avg wpm</span>
      </div>
    </div>
    <div class="rsvp-topbar-end">
      <button class="rsvp-nav-btn" id="fullscreenBtn" type="button" aria-label="Toggle fullscreen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
    </div>
  </header>

  <div class="rsvp-main">
    <div class="rsvp-wrap" id="readerWrap">
      <main class="rsvp-display" aria-label="RSVP reader">
        <div class="rsvp-context rsvp-context--above" id="contextAbove"></div>
        <div class="rsvp-word-area">
          <div class="rsvp-guide top"></div>
          <div class="rsvp-guide-tick top"></div>
          <div class="rsvp-word" id="word">
            <span class="before" id="before"></span><span class="orp" id="orp"></span><span class="after" id="after"></span>
          </div>
          <div class="rsvp-guide-tick bottom"></div>
          <div class="rsvp-guide bottom"></div>
        </div>
        <div class="rsvp-context rsvp-context--below" id="contextBelow"></div>
      </main>
      <div class="rsvp-status" id="statusOverlay" aria-live="polite">
        <div class="rsvp-status-msg" id="statusMsg">Loading\u2026</div>
        <button class="ui-chip" id="statusRetryBtn" type="button" hidden>Choose another file</button>
      </div>
      <div class="rsvp-toast" id="wpmToast" aria-live="polite"></div>
    </div>
  </div>

  <footer class="rsvp-bottombar" id="rsvpBottombar">
    <div class="rsvp-controls" id="rsvpControls">
      <button class="rsvp-drawer-handle" id="drawerHandle" type="button" aria-label="Expand controls">
        <span class="rsvp-drawer-pip"></span>
      </button>

      <div class="rsvp-panel" id="panelPurple">
        <div class="rsvp-panel-inner">
          <div class="picker" aria-label="Reading speed">
            <div class="picker-display"><span id="wpmValue">400</span><span class="picker-unit">WPM</span></div>
            <div class="strip-wrap">
              <div class="picker-strip" id="wpmStrip">
                <div class="picker-track" id="wpmTrack"></div>
              </div>
              <div class="picker-pointer"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="rsvp-panel" id="panelBlue">
        <div class="rsvp-panel-inner">
          <div class="rsvp-seek">
            <div class="rsvp-seek-readout" id="seekReadout"></div>
            <input class="rsvp-seek-slider" id="seekSlider" type="range" min="0" max="0" value="0" step="1" aria-label="Reading position">
          </div>
          <div class="rsvp-transport">
            <button class="rsvp-nav-btn" id="stepPrev" type="button" aria-label="Step back">
              <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15,18 9,12 15,6"/></svg>
            </button>
            <button class="rsvp-unit-cycle" id="unitCycleBtn" type="button" aria-label="Cycle step unit">Word</button>
            <button class="rsvp-play-btn" id="playPause" type="button" aria-label="Play or pause">
              <svg class="rsvp-play-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
              <svg class="rsvp-pause-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              <span id="playLabel" class="rsvp-sr-only">Play</span>
            </button>
            <button class="rsvp-nav-btn" id="stepNext" type="button" aria-label="Step forward">
              <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9,18 15,12 9,6"/></svg>
            </button>
          </div>
        </div>
      </div>
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
      <button class="reader-tool" id="modeBtn" type="button" aria-label="Book mode">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-1.8-1.3-4.6-1.6-7-0.8v12c2.4-0.8 5.2-0.5 7 0.8 1.8-1.3 4.6-1.6 7-0.8V5.2c-2.4-0.8-5.2-0.5-7 0.8z"/><line x1="12" y1="6" x2="12" y2="18.8"/></svg>
        <span>Read</span>
      </button>
      <button class="reader-tool" id="ttsModeBtn" type="button" aria-label="Listen with TTS">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        <span>Listen</span>
      </button>
      <button class="reader-tool" id="bookmarksBtn" type="button" aria-label="Bookmarks" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        <span>Marks</span>
      </button>
      <button class="reader-tool" id="openEpubBtn" type="button" aria-label="Open EPUB">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>Open</span>
      </button>
    </div>
  </footer>

  <div class="ui-backdrop" id="backdrop"></div>

  <div class="bm-panel" id="bookmarksPanel" role="dialog" aria-modal="true" aria-label="Bookmarks">
    <div class="bm-panel-head">
      <div class="bm-panel-title">Bookmarks</div>
      <button class="bm-add-btn" id="bmAddBtn" type="button">+ Add</button>
    </div>
    <div class="bm-panel-list" id="bmList"></div>
  </div>

  <div class="reader-search-panel" id="searchPanel" role="search" aria-label="Search in book">
    <div class="reader-search-head">
      <input class="reader-search-input" id="searchInput" type="search" placeholder="Search in book…" autocomplete="off">
    </div>
    <div class="reader-search-results" id="searchResults"></div>
  </div>

  <nav class="reader-toc" id="toc" role="dialog" aria-modal="true" aria-label="Contents">
    <div class="reader-toc-head">Contents</div>
    <div class="reader-toc-list" id="tocList">
      <div class="reader-toc-empty">Load an EPUB to see chapters.</div>
    </div>
  </nav>

`;
}
