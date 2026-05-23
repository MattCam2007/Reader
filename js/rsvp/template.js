export function rsvpTemplate() {
  return `
  <a href="#readerWrap" class="reader-skip-link">Skip to reader</a>

  <div class="rsvp-stats" role="status" aria-live="polite">
    <span id="statWords">0 words</span>
    <span class="rsvp-stats-sep">|</span>
    <span id="statTime">0:00</span>
    <span class="rsvp-stats-sep">|</span>
    <span id="statAvg">&mdash; avg wpm</span>
  </div>

  <div class="rsvp-main">
    <div class="rsvp-wrap" id="readerWrap">
      <main class="rsvp-display" aria-label="RSVP reader">
        <div class="rsvp-word-area">
          <div class="rsvp-guide top"></div>
          <div class="rsvp-guide-tick top"></div>
          <div class="rsvp-word" id="word">
            <span class="before" id="before"></span><span class="orp" id="orp"></span><span class="after" id="after"></span>
          </div>
          <div class="rsvp-guide-tick bottom"></div>
          <div class="rsvp-guide bottom"></div>
        </div>
        <div class="rsvp-context" id="contextLine"></div>
      </main>
      <div class="rsvp-status" id="statusOverlay" aria-live="polite">
        <div class="rsvp-status-msg" id="statusMsg">Loading\u2026</div>
        <button class="rsvp-action-btn" id="statusRetryBtn" type="button" hidden>Choose another file</button>
      </div>
      <div class="rsvp-toast" id="wpmToast" aria-live="polite"></div>
    </div>
  </div>

  <div class="rsvp-controls">
    <div class="rsvp-chapter-nav" id="chapterNav" hidden>
      <button class="rsvp-nav-btn" id="chPrev" type="button" aria-label="Previous chapter">&#9664;</button>
      <select class="rsvp-chapter-select" id="chSelect" aria-label="Chapter"></select>
      <button class="rsvp-nav-btn" id="chNext" type="button" aria-label="Next chapter">&#9654;</button>
    </div>

    <div class="rsvp-seek">
      <div class="rsvp-seek-readout" id="seekReadout"></div>
      <input class="rsvp-seek-slider" id="seekSlider" type="range" min="0" max="0" value="0" step="1" aria-label="Reading position">

      <div class="rsvp-grain" role="group" aria-label="Words per flash">
        <button class="rsvp-grain__btn is-active" type="button" data-chunk="1">1 word</button>
        <button class="rsvp-grain__btn" type="button" data-chunk="2">2 words</button>
        <button class="rsvp-grain__btn" type="button" data-chunk="3">3 words</button>
      </div>

      <div class="rsvp-grain" role="group" aria-label="Move by">
        <button class="rsvp-grain__btn is-active" type="button" data-unit="word">Word</button>
        <button class="rsvp-grain__btn" type="button" data-unit="sentence">Sentence</button>
        <button class="rsvp-grain__btn" type="button" data-unit="paragraph">Paragraph</button>
      </div>
      <div class="rsvp-transport">
        <button class="rsvp-nav-btn" id="stepPrev" type="button" aria-label="Step back">&#9664;</button>
        <button class="rsvp-play-btn" id="playPause" type="button" aria-label="Play or pause"><span id="playLabel">Play</span></button>
        <button class="rsvp-nav-btn" id="stepNext" type="button" aria-label="Step forward">&#9654;</button>
        <button class="rsvp-nav-btn" id="fullscreenBtn" type="button" aria-label="Toggle fullscreen">&#x26F6;</button>
      </div>
    </div>

    <div class="picker" aria-label="Reading speed">
      <div class="picker-display"><span id="wpmValue">400</span><span class="picker-unit">WPM</span></div>
      <div class="strip-wrap">
        <div class="picker-strip" id="wpmStrip">
          <div class="picker-track" id="wpmTrack"></div>
        </div>
        <div class="picker-pointer"></div>
      </div>
    </div>

    <details class="rsvp-settings" id="rsvpSettings">
      <summary>Settings</summary>

      <div class="rsvp-settings-label">Theme</div>
      <div class="rsvp-grain" role="group" aria-label="Theme">
        <button class="rsvp-grain__btn is-active" type="button" data-theme="dark">Dark</button>
        <button class="rsvp-grain__btn" type="button" data-theme="light">Light</button>
        <button class="rsvp-grain__btn" type="button" data-theme="sepia">Sepia</button>
        <button class="rsvp-grain__btn" type="button" data-theme="oled">OLED</button>
      </div>

      <div class="rsvp-settings-label">Font</div>
      <div class="rsvp-grain" role="group" aria-label="Font family">
        <button class="rsvp-grain__btn" type="button" data-font="sans">Sans</button>
        <button class="rsvp-grain__btn" type="button" data-font="serif">Serif</button>
        <button class="rsvp-grain__btn is-active" type="button" data-font="mono">Mono</button>
        <button class="rsvp-grain__btn" type="button" data-font="dyslexic">Dyslexic</button>
      </div>
      <div class="picker" aria-label="Font size">
        <div class="picker-display"><span id="fontSizeValue">48</span><span class="picker-unit">PX</span></div>
        <div class="strip-wrap">
          <div class="picker-strip" id="fontSizeStrip">
            <div class="picker-track" id="fontSizeTrack"></div>
          </div>
          <div class="picker-pointer"></div>
        </div>
      </div>

      <div class="rsvp-settings-label">Timing</div>
      <div class="picker" aria-label="Long word pause intensity">
        <div class="picker-display"><span id="lenValue">50</span><span class="picker-unit">LENGTH</span></div>
        <div class="strip-wrap">
          <div class="picker-strip" id="lenStrip">
            <div class="picker-track" id="lenTrack"></div>
          </div>
          <div class="picker-pointer"></div>
        </div>
      </div>
      <div class="picker" aria-label="Comma pause intensity">
        <div class="picker-display"><span id="commaValue">50</span><span class="picker-unit">COMMA %</span></div>
        <div class="strip-wrap">
          <div class="picker-strip" id="commaStrip">
            <div class="picker-track" id="commaTrack"></div>
          </div>
          <div class="picker-pointer"></div>
        </div>
      </div>
      <div class="picker" aria-label="Period pause intensity">
        <div class="picker-display"><span id="periodValue">120</span><span class="picker-unit">PERIOD %</span></div>
        <div class="strip-wrap">
          <div class="picker-strip" id="periodStrip">
            <div class="picker-track" id="periodTrack"></div>
          </div>
          <div class="picker-pointer"></div>
        </div>
      </div>
      <div class="picker" aria-label="Paragraph pause intensity">
        <div class="picker-display"><span id="paraValue">150</span><span class="picker-unit">PARAGRAPH %</span></div>
        <div class="strip-wrap">
          <div class="picker-strip" id="paraStrip">
            <div class="picker-track" id="paraTrack"></div>
          </div>
          <div class="picker-pointer"></div>
        </div>
      </div>

      <div class="rsvp-settings-label">Behavior</div>
      <label class="rsvp-toggle-row"><input type="checkbox" id="startPausedToggle" checked><span>Start paused on load</span></label>
      <label class="rsvp-toggle-row"><input type="checkbox" id="countdownToggle" checked><span>Countdown before resume</span></label>
      <label class="rsvp-toggle-row"><input type="checkbox" id="contextToggle" checked><span>Show context line</span></label>
      <label class="rsvp-toggle-row"><input type="checkbox" id="autoPauseToggle" checked><span>Pause when tab hidden</span></label>

      <div class="rsvp-settings-label">Training</div>
      <label class="rsvp-toggle-row"><input type="checkbox" id="trainingToggle"><span>WPM training ramp</span></label>
      <div class="rsvp-training-opts" id="trainingOpts" hidden>
        <div class="picker" aria-label="Training increment">
          <div class="picker-display"><span id="trainIncValue">10</span><span class="picker-unit">WPM / BUMP</span></div>
          <div class="strip-wrap">
            <div class="picker-strip" id="trainIncStrip">
              <div class="picker-track" id="trainIncTrack"></div>
            </div>
            <div class="picker-pointer"></div>
          </div>
        </div>
        <div class="picker" aria-label="Training interval">
          <div class="picker-display"><span id="trainIntValue">500</span><span class="picker-unit">WORDS / BUMP</span></div>
          <div class="strip-wrap">
            <div class="picker-strip" id="trainIntStrip">
              <div class="picker-track" id="trainIntTrack"></div>
            </div>
            <div class="picker-pointer"></div>
          </div>
        </div>
        <div class="picker" aria-label="Training ceiling">
          <div class="picker-display"><span id="trainCeilValue">600</span><span class="picker-unit">MAX WPM</span></div>
          <div class="strip-wrap">
            <div class="picker-strip" id="trainCeilStrip">
              <div class="picker-track" id="trainCeilTrack"></div>
            </div>
            <div class="picker-pointer"></div>
          </div>
        </div>
      </div>

      <div class="rsvp-actions">
        <button class="rsvp-action-btn" id="openEpubBtn" type="button">Open EPUB</button>
        <button class="rsvp-action-btn" id="modeBtn" type="button">Book Mode</button>
        <button class="rsvp-action-btn" id="ttsModeBtn" type="button">Listen (TTS)</button>
        <button class="rsvp-action-btn" id="resetStatsBtn" type="button">Reset Stats</button>
      </div>
    </details>
  </div>`;
}
