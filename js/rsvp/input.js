import { RSVP } from './constants.js';
import { stepFn, stepParagraph } from './navigation.js';
import { t } from '../core/i18n.js';

export class RsvpInput {
  constructor(state, prefs, playback, display, bus, els, signal) {
    this.state = state;
    this.prefs = prefs;
    this.playback = playback;
    this.display = display;
    this.bus = bus;
    this.els = els;
    this._signal = signal;

    // Swipe tracking
    this._swipeStart = null;
    this._swipeFired = false;

    // Fullscreen
    this._fsHideTimer = null;

    this._bind();
  }

  _doStep(dir) {
    if (this.state.playState === 'playing') this.playback.pause();
    else if (this.state.playState === 'countdown') this.playback.cancelCountdown();
    const granularity = this.prefs.data.granularity || 'word';
    const fn = stepFn(granularity);
    this.playback.seekTo(fn(this.state, this.state.currentIdx, dir));
  }

  _adjustWPM(delta) {
    const newVal = Math.max(RSVP.WPM_MIN, Math.min(RSVP.WPM_MAX, this.prefs.data.wpm + delta));
    if (newVal === this.prefs.data.wpm) return;
    this.prefs.data.wpm = newVal;
    this.prefs.save();
    this.bus.emit('wpmChanged', newVal);
    this.display.showToast(newVal + " WPM");
    this.display.updateSeek();
  }

  _toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }

  _fsShowControls() {
    document.body.classList.remove("fs-hide-controls");
    if (this._fsHideTimer) clearTimeout(this._fsHideTimer);
    if (document.fullscreenElement) {
      this._fsHideTimer = setTimeout(() => {
        document.body.classList.add("fs-hide-controls");
      }, RSVP.FS_AUTO_HIDE_MS);
    }
  }

  _bind() {
    const signal = this._signal;
    const { readerWrap, seekSlider, stepPrevBtn, stepNextBtn, playPauseBtn,
            fullscreenBtn } = this.els;

    // Tap / click on reader area -> toggle play
    if (readerWrap) {
      readerWrap.addEventListener('click', (e) => {
        if (e.target.closest('button, select, input, a, details, summary')) return;
        if (e.target.closest('.rsvp-status')) return;
        if (this._swipeFired) { this._swipeFired = false; return; }
        this.playback.toggle();
      }, { signal });

      // Swipe gestures. While the scroll picker is up, the reel handles
      // vertical drags natively, so don't treat them as swipes.
      readerWrap.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.rsvp-status')) return;
        if (document.body.classList.contains('context-page') &&
            document.body.classList.contains('paused')) return;
        this._swipeStart = { x: e.clientX, y: e.clientY };
        this._swipeFired = false;
      }, { signal });

      readerWrap.addEventListener('pointercancel', () => {
        this._swipeStart = null;
      }, { signal });

      readerWrap.addEventListener('pointerup', (e) => {
        if (!this._swipeStart) return;
        const dx = e.clientX - this._swipeStart.x;
        const dy = e.clientY - this._swipeStart.y;
        this._swipeStart = null;
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (ax > RSVP.SWIPE_MIN_PX && ax > ay) {
          this._swipeFired = true;
          this._doStep(dx < 0 ? 1 : -1);
        } else if (ay > RSVP.SWIPE_MIN_PX && ay > ax) {
          this._swipeFired = true;
          this._adjustWPM(dy < 0 ? RSVP.WPM_ADJUST_STEP : -RSVP.WPM_ADJUST_STEP);
        }
      }, { signal });
    }

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === "=" || e.key === "+") { e.preventDefault(); this._adjustWPM(RSVP.WPM_ADJUST_STEP); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); this._adjustWPM(-RSVP.WPM_ADJUST_STEP); return; }
      if ((e.key === "f" || e.key === "F") && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT") {
        e.preventDefault(); this._toggleFullscreen(); return;
      }
      if (e.code === "Space") { e.preventDefault(); this.playback.toggle(); return; }
      if (e.target === seekSlider) return;
      if (e.code === "ArrowLeft") { e.preventDefault(); this._doStep(-1); }
      else if (e.code === "ArrowRight") { e.preventDefault(); this._doStep(1); }
      else if (e.code === "ArrowUp") {
        e.preventDefault();
        if (this.state.playState === 'playing') this.playback.pause();
        else if (this.state.playState === 'countdown') this.playback.cancelCountdown();
        this.playback.seekTo(stepParagraph(this.state, this.state.currentIdx, -1));
      }
      else if (e.code === "ArrowDown") {
        e.preventDefault();
        if (this.state.playState === 'playing') this.playback.pause();
        else if (this.state.playState === 'countdown') this.playback.cancelCountdown();
        this.playback.seekTo(stepParagraph(this.state, this.state.currentIdx, 1));
      }
    }, { signal });

    // Auto-pause on tab blur
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state.playState === 'playing' && this.prefs.data.autoPauseEnabled) {
        this.playback.pause();
      }
    }, { signal });

    // Seek slider
    if (seekSlider) {
      seekSlider.addEventListener('pointerdown', () => {
        if (this.state.playState === 'playing') this.playback.pause();
        else if (this.state.playState === 'countdown') this.playback.cancelCountdown();
        this.state.sliderDragging = true;
      }, { signal });
      seekSlider.addEventListener('keydown', () => {
        if (this.state.playState === 'playing') this.playback.pause();
        else if (this.state.playState === 'countdown') this.playback.cancelCountdown();
      }, { signal });
      seekSlider.addEventListener('input', () => {
        const granularity = this.prefs.data.granularity || 'word';
        let list;
        if (granularity === 'sentence') list = this.state.sentenceStarts;
        else if (granularity === 'paragraph') list = this.state.paragraphStarts;
        else list = this.state.wordTokenIndices;
        if (!list.length) return;
        const v = Math.max(0, Math.min(parseInt(seekSlider.value, 10) || 0, list.length - 1));
        this.playback.seekTo(list[v]);
      }, { signal });
      const endDrag = () => { this.state.sliderDragging = false; };
      seekSlider.addEventListener('change', endDrag, { signal });
      window.addEventListener('pointerup', endDrag, { signal });
    }

    // Play/pause button
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playback.toggle();
      }, { signal });
    }

    // Step buttons with hold-to-repeat
    if (stepPrevBtn) this._bindHold(stepPrevBtn, -1, signal);
    if (stepNextBtn) this._bindHold(stepNextBtn, 1, signal);

    // Fullscreen
    if (fullscreenBtn) {
      if (!document.fullscreenEnabled) {
        fullscreenBtn.hidden = true;
      } else {
        fullscreenBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._toggleFullscreen();
        }, { signal });
      }
    }

    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        this._fsShowControls();
        document.addEventListener('pointermove', () => this._fsShowControls(), { signal });
        document.addEventListener('pointerdown', () => this._fsShowControls(), { signal });
      } else {
        document.body.classList.remove("fs-hide-controls");
        if (this._fsHideTimer) { clearTimeout(this._fsHideTimer); this._fsHideTimer = null; }
      }
    }, { signal });

    // Granularity selector (settings grain buttons — keep in sync with cycle btn)
    const UNIT_LABELS = { word: t('rsvp.unitWord'), sentence: t('rsvp.unitSent'), paragraph: t('rsvp.unitPara') };
    const grainBtns = Array.from(document.querySelectorAll('[data-unit]'));
    grainBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const unit = btn.dataset.unit;
        this.prefs.data.granularity = unit;
        this.prefs.save();
        grainBtns.forEach(b => b.classList.toggle('is-active', b === btn));
        const cycleBtn = document.getElementById('unitCycleBtn');
        if (cycleBtn) cycleBtn.textContent = UNIT_LABELS[unit] ?? unit;
        this.display.updateSeek();
      }, { signal });
    });

    // Chunk size selector
    const chunkBtns = Array.from(document.querySelectorAll('[data-chunk]'));
    chunkBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.prefs.data.chunkSize = parseInt(btn.dataset.chunk, 10) || 1;
        this.prefs.save();
        chunkBtns.forEach(b => b.classList.toggle('is-active', b === btn));
      }, { signal });
    });

    // Theme buttons
    const themeBtns = Array.from(document.querySelectorAll('[data-theme]'));
    themeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.bus.emit('themeChange', btn.dataset.theme);
      }, { signal });
    });

    // Font buttons
    const fontBtns = Array.from(document.querySelectorAll('[data-font]'));
    fontBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.bus.emit('fontChange', btn.dataset.font);
      }, { signal });
    });
  }

  _bindHold(btn, dir, signal) {
    let delayTimer = null;
    let repeatTimer = null;
    const stop = () => {
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
      if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._doStep(dir);
      window.addEventListener('pointerup', stop, { once: true, signal });
      window.addEventListener('pointercancel', stop, { once: true, signal });
      delayTimer = setTimeout(() => {
        repeatTimer = setInterval(() => this._doStep(dir), RSVP.STEP_REPEAT_MS);
      }, RSVP.STEP_HOLD_DELAY_MS);
    }, { signal });
  }

}
