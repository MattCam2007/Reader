import { RSVP } from './constants.js';
import { PARAGRAPH_BREAK } from './tokenizer.js';
import { durationMultiplier, rampSpeedFactor } from './timing.js';
import { rewindWords } from './navigation.js';

export class PlaybackEngine {
  constructor(state, prefs, bus) {
    this.state = state;
    this.prefs = prefs;
    this.bus = bus; // EventBus for cross-module events
    this._countdownTimer = null;
  }

  play() {
    const { state, prefs } = this;
    if (state.playState !== 'playing') return;
    if (state.currentIdx >= state.tokens.length) state.currentIdx = 0;
    this.clearPending();

    this.bus.emit('playStart');

    // Collect chunk
    const chunkSize = prefs.get('chunkSize') || 1;
    const chunk = [];
    let scanIdx = state.currentIdx;
    while (chunk.length < chunkSize && scanIdx < state.tokens.length) {
      const tok = state.tokens[scanIdx];
      if (tok === PARAGRAPH_BREAK) {
        if (chunk.length === 0) {
          chunk.push({ token: tok, idx: scanIdx });
          scanIdx++;
        }
        break;
      }
      chunk.push({ token: tok, idx: scanIdx });
      scanIdx++;
    }

    if (!chunk.length) return;

    const pivotPos = Math.min(Math.floor((chunkSize - 1) / 2), chunk.length - 1);
    this.bus.emit('renderChunk', chunk, pivotPos);
    this.bus.emit('updateSeek');

    // Duration
    const p = prefs.data;
    const baseMs = 60000 / p.wpm;
    let maxMul = 0;
    for (const c of chunk) maxMul = Math.max(maxMul, durationMultiplier(c.token, p));
    let dur = baseMs * maxMul;
    if (state.rampRemaining > 0 && chunk[0].token !== PARAGRAPH_BREAK) {
      dur = dur / rampSpeedFactor(state.rampRemaining);
      state.rampRemaining--;
    }

    state.pendingTimer = setTimeout(() => {
      state.pendingTimer = null;
      const wordsInChunk = chunk.filter(c => c.token !== PARAGRAPH_BREAK).length;
      this.bus.emit('wordsRead', wordsInChunk);
      state.currentIdx = scanIdx;
      this.play();
    }, dur);
  }

  pause() {
    const { state } = this;
    if (state.playState !== 'playing') return;
    this.clearPending();
    this.bus.emit('playStop');
    state.setPlayState('paused');
    state.manuallySeeked = false;
    this.bus.emit('updateSeek');
  }

  resume() {
    const { state, prefs } = this;
    if (state.playState !== 'paused') return;
    state.currentIdx = state.manuallySeeked
      ? Math.min(state.currentIdx, state.tokens.length - 1)
      : rewindWords(state, state.currentIdx, RSVP.REWIND_WORDS_ON_RESUME);
    state.manuallySeeked = false;

    if (prefs.data.countdownEnabled) {
      this.runCountdown();
    } else {
      state.rampRemaining = RSVP.RAMP_STEPS;
      state.setPlayState('playing');
      this.bus.emit('playStart');
      this.play();
    }
  }

  toggle() {
    if (this.state.playState === 'playing') this.pause();
    else if (this.state.playState === 'paused') this.resume();
    else if (this.state.playState === 'countdown') this.cancelCountdown();
  }

  seekTo(idx) {
    const { state } = this;
    state.currentIdx = Math.max(0, Math.min(idx, state.tokens.length - 1));
    state.manuallySeeked = true;
    this.bus.emit('renderWord', state.currentIdx);
    this.bus.emit('updateSeek');
  }

  clearPending() {
    if (this.state.pendingTimer !== null) {
      clearTimeout(this.state.pendingTimer);
      this.state.pendingTimer = null;
    }
  }

  runCountdown() {
    const { state } = this;
    state.setPlayState('countdown');
    document.body.classList.remove('paused');
    const nums = [3, 2, 1];
    let step = 0;
    const tick = () => {
      if (state.playState !== 'countdown') return;
      if (step < nums.length) {
        this.bus.emit('renderCountdown', nums[step]);
        step++;
        this._countdownTimer = setTimeout(tick, RSVP.COUNTDOWN_TICK_MS);
      } else {
        this._countdownTimer = null;
        state.rampRemaining = 3;
        state.setPlayState('playing');
        this.bus.emit('playStart');
        this.play();
      }
    };
    tick();
  }

  cancelCountdown() {
    if (this._countdownTimer) { clearTimeout(this._countdownTimer); this._countdownTimer = null; }
    this.state.setPlayState('paused');
    this.bus.emit('renderWord', this.state.currentIdx);
    this.bus.emit('updateSeek');
  }
}
