import { PARAGRAPH_BREAK } from './tokenizer.js';

// Scroll-driven word picker shown while paused (when context is enabled).
//
// Twitchiness fix: the hot-path scroll handler reads only scrollTop (cheap,
// no layout) and accumulates it into a fractional-word counter. Words step
// when the accumulator crosses a full pxPerWord threshold. This is pure
// delta arithmetic — no BoundingClientRect in the scroll loop, no
// position-feedback oscillation.
//
// After scrolling settles (200 ms of silence) a one-shot sync reads the
// slot position and silently corrects any accumulated drift so the word
// box stays aligned.

const WINDOW_WORDS = 400;
const REBUILD_MARGIN = 100;

export class ScrollPicker {
  constructor(state, prefs, display, els) {
    this.state   = state;
    this.prefs   = prefs;
    this.display = display;
    this.els     = els;
    this.active  = false;

    this._activeIdx      = 0;
    this._windowStart    = 0;
    this._windowEnd      = 0;
    this._pxPerWord      = 20;   // updated in _build
    this._scrollAccum    = 0;    // fractional-word accumulator
    this._lastScrollTop  = null;
    this._suppressScroll = false;
    this._rafPending     = false;
    this._syncTimer      = null;
    this._onScroll       = this._onScroll.bind(this);

    this._cwAbove = null;
    this._cwSlot  = null;
    this._cwBelow = null;
  }

  activate() {
    if (this.active) return;
    const { contextFlow, readerWrap } = this.els;
    if (!contextFlow || !readerWrap || !this.state.tokens.length) return;
    this.active = true;
    this._scrollAccum   = 0;
    this._lastScrollTop = null;
    this._build(this.state.currentIdx);
    readerWrap.addEventListener('scroll', this._onScroll, { passive: true });
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this._syncTimer);
    this._syncTimer = null;
    const { contextFlow, readerWrap } = this.els;
    if (readerWrap) readerWrap.removeEventListener('scroll', this._onScroll);
    if (contextFlow) contextFlow.textContent = '';
    this._cwAbove = this._cwSlot = this._cwBelow = null;
  }

  recenter(idx) {
    if (this.active) this._build(idx);
  }

  _build(centerIdx) {
    const { state } = this;
    const flow = this.els.contextFlow;
    const wrap = this.els.readerWrap;

    let idx = Math.max(0, Math.min(centerIdx, state.tokens.length - 1));
    if (state.tokens[idx] === PARAGRAPH_BREAK) {
      idx = this._nextWord(idx + 1) ?? this._prevWord(idx - 1) ?? idx;
    }

    let start = idx, wc = 0;
    while (start > 0 && wc < WINDOW_WORDS) { start--; if (state.tokens[start] !== PARAGRAPH_BREAK) wc++; }
    let end = idx, wc2 = 0;
    while (end < state.tokens.length - 1 && wc2 < WINDOW_WORDS) { end++; if (state.tokens[end] !== PARAGRAPH_BREAK) wc2++; }
    this._windowStart = start;
    this._windowEnd   = end;
    this._activeIdx   = idx;

    flow.textContent = '';
    this._cwAbove = Object.assign(document.createElement('div'), { className: 'cw-above' });
    this._cwSlot  = Object.assign(document.createElement('div'), { className: 'cw-slot'  });
    this._cwBelow = Object.assign(document.createElement('div'), { className: 'cw-below' });
    flow.append(this._cwAbove, this._cwSlot, this._cwBelow);

    const wordArea = this.els.wordArea;
    if (wordArea) this._cwSlot.style.height = wordArea.getBoundingClientRect().height + 'px';

    this._renderText(idx);

    // Estimate px per word once per build (used by delta accumulator)
    const wrapRect = wrap.getBoundingClientRect();
    const fs       = parseFloat(getComputedStyle(this._cwAbove).fontSize) || 16;
    const lineH    = fs * 2; // matches line-height: 2
    const wordsPerLine = Math.max(1, Math.round((wrapRect.width * 0.8) / (fs * 5)));
    this._pxPerWord  = lineH / wordsPerLine;
    this._scrollAccum = 0;

    this.display.render(state.tokens[idx]);
    this.state.currentIdx    = idx;
    this.state.manuallySeeked = true;
    this.display.updateSeek();

    // Centre the slot in the viewport; suppress scroll events during this adjustment.
    this._suppressScroll = true;
    requestAnimationFrame(() => {
      if (!this._cwSlot) return;
      const wr = wrap.getBoundingClientRect();
      const sr = this._cwSlot.getBoundingClientRect();
      wrap.scrollTop += (sr.top + sr.height / 2) - (wr.top + wr.height / 2);
      this._lastScrollTop = wrap.scrollTop;
      requestAnimationFrame(() => { this._suppressScroll = false; });
    });
  }

  _renderText(activeIdx) {
    this._cwAbove.textContent = this._buildText(this._windowStart, activeIdx - 1);
    this._cwBelow.textContent = this._buildText(activeIdx + 1, this._windowEnd);
  }

  _buildText(from, to) {
    const { state } = this;
    let out = '';
    for (let i = from; i <= to; i++) {
      const tok = state.tokens[i];
      if (tok === PARAGRAPH_BREAK) {
        out = out.trimEnd() + '\n\n';
      } else {
        if (out.length > 0 && !out.endsWith('\n')) out += ' ';
        out += tok;
      }
    }
    return out;
  }

  _nextWord(from) {
    for (let i = from; i <= this._windowEnd; i++) {
      if (this.state.tokens[i] !== PARAGRAPH_BREAK) return i;
    }
    return null;
  }

  _prevWord(from) {
    for (let i = from; i >= this._windowStart; i--) {
      if (this.state.tokens[i] !== PARAGRAPH_BREAK) return i;
    }
    return null;
  }

  // ── Hot path: pure arithmetic, zero layout reads ──────────────────────────
  _onScroll() {
    if (this._suppressScroll || this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      if (!this.active) return;

      const wrap = this.els.readerWrap;
      const st   = wrap.scrollTop;

      if (this._lastScrollTop === null) { this._lastScrollTop = st; return; }

      const delta = st - this._lastScrollTop;
      this._lastScrollTop = st;
      if (Math.abs(delta) < 0.5) return;

      this._scrollAccum += delta;
      const steps = Math.trunc(this._scrollAccum / this._pxPerWord);
      if (steps !== 0) {
        this._scrollAccum -= steps * this._pxPerWord;
        this._stepN(Math.abs(steps), steps > 0 ? 1 : -1);

        const idx = this._activeIdx;
        if ((this._windowStart > 0 && idx - this._windowStart < REBUILD_MARGIN) ||
            (this._windowEnd < this.state.tokens.length - 1 && this._windowEnd - idx < REBUILD_MARGIN)) {
          this._build(idx);
          return; // _build resets accum and recentres; no sync needed
        }
      }

      // Debounced sync: once scrolling goes quiet, nudge slot back to centre.
      clearTimeout(this._syncTimer);
      this._syncTimer = setTimeout(() => this._syncSlot(), 200);
    });
  }

  // ── Called once after scroll settles; corrects accumulated drift ──────────
  _syncSlot() {
    this._syncTimer = null;
    if (!this.active || !this._cwSlot) return;
    const wrap = this.els.readerWrap;
    const wr   = wrap.getBoundingClientRect();
    const sr   = this._cwSlot.getBoundingClientRect();
    const drift = (sr.top + sr.height / 2) - (wr.top + wr.height / 2);
    if (Math.abs(drift) < 2) return;
    this._suppressScroll = true;
    wrap.scrollTop += drift;
    this._lastScrollTop = wrap.scrollTop;
    requestAnimationFrame(() => { this._suppressScroll = false; });
  }

  _stepN(n, dir) {
    let idx = this._activeIdx;
    for (let i = 0; i < n; i++) {
      const next = dir > 0 ? this._nextWord(idx + 1) : this._prevWord(idx - 1);
      if (next === null) break;
      idx = next;
    }
    if (idx === this._activeIdx) return;
    this._activeIdx = idx;
    this._renderText(idx); // single rebuild for all N steps
    this.state.currentIdx    = idx;
    this.state.manuallySeeked = true;
    this.display.render(this.state.tokens[idx]);
    this.display.updateSeek();
  }
}
