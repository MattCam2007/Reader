import { PARAGRAPH_BREAK } from './tokenizer.js';

// Scroll-driven word picker shown while paused (when context is enabled).
//
// Layout: the context-flow div contains three stacked blocks:
//   cw-above  — all words before the active word, as a flowing paragraph
//   cw-slot   — an empty gap the same height as the pinned word box
//   cw-below  — all words after the active word, as a flowing paragraph
//
// The word box (rsvp-word-area) is position:fixed at viewport centre and
// overlays the slot exactly. As the user scrolls, the slot drifts from
// centre; the picker detects the drift, steps the active word index, and
// rebuilds the above/below text so the slot returns to centre. This means:
//   - the last word of cw-above is always the word immediately before active
//   - the first word of cw-below is always the word immediately after active
// giving clean line breaks right at the box boundary.

const WINDOW_WORDS = 400;
const REBUILD_MARGIN = 100;

export class ScrollPicker {
  constructor(state, prefs, display, els) {
    this.state   = state;
    this.prefs   = prefs;
    this.display = display;
    this.els     = els;
    this.active  = false;

    this._activeIdx   = 0;
    this._windowStart = 0;
    this._windowEnd   = 0;
    this._pxPerWord   = 20;   // estimated in _build
    this._suppressScroll = false;
    this._rafPending  = false;
    this._onScroll    = this._onScroll.bind(this);

    this._cwAbove = null;
    this._cwSlot  = null;
    this._cwBelow = null;
  }

  activate() {
    if (this.active) return;
    const { contextFlow, readerWrap } = this.els;
    if (!contextFlow || !readerWrap || !this.state.tokens.length) return;
    this.active = true;
    this._build(this.state.currentIdx);
    readerWrap.addEventListener('scroll', this._onScroll, { passive: true });
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
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

    // Window around idx
    let start = idx, wc = 0;
    while (start > 0 && wc < WINDOW_WORDS) { start--; if (state.tokens[start] !== PARAGRAPH_BREAK) wc++; }
    let end = idx, wc2 = 0;
    while (end < state.tokens.length - 1 && wc2 < WINDOW_WORDS) { end++; if (state.tokens[end] !== PARAGRAPH_BREAK) wc2++; }
    this._windowStart = start;
    this._windowEnd   = end;
    this._activeIdx   = idx;

    // Build three-block DOM structure
    flow.textContent = '';
    this._cwAbove = Object.assign(document.createElement('div'), { className: 'cw-above' });
    this._cwSlot  = Object.assign(document.createElement('div'), { className: 'cw-slot'  });
    this._cwBelow = Object.assign(document.createElement('div'), { className: 'cw-below' });
    flow.append(this._cwAbove, this._cwSlot, this._cwBelow);

    // Match slot height to word box
    const wordArea = this.els.wordArea;
    if (wordArea) this._cwSlot.style.height = wordArea.getBoundingClientRect().height + 'px';

    this._renderText(idx);

    // Estimate px per word for fast-scroll step count
    const wrapRect  = wrap.getBoundingClientRect();
    const fs        = parseFloat(getComputedStyle(this._cwAbove).fontSize) || 16;
    const lineH     = fs * 2;
    const wordsPerLine = Math.max(1, Math.round((wrapRect.width * 0.8) / (fs * 5)));
    this._pxPerWord = lineH / wordsPerLine;

    // Update box and state
    this.display.render(state.tokens[idx]);
    this.state.currentIdx    = idx;
    this.state.manuallySeeked = true;
    this.display.updateSeek();

    // Scroll slot to viewport centre (two rAFs: first measures after layout, second clears suppress)
    this._suppressScroll = true;
    requestAnimationFrame(() => {
      if (!this._cwSlot) return;
      const wr = wrap.getBoundingClientRect();
      const sr = this._cwSlot.getBoundingClientRect();
      wrap.scrollTop += (sr.top + sr.height / 2) - (wr.top + wr.height / 2);
      requestAnimationFrame(() => { this._suppressScroll = false; });
    });
  }

  _renderText(activeIdx) {
    const { state } = this;
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

  _onScroll() {
    if (this._suppressScroll || this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      if (!this.active || !this._cwSlot) return;

      const wrap     = this.els.readerWrap;
      const wr       = wrap.getBoundingClientRect();
      const sr       = this._cwSlot.getBoundingClientRect();
      const viewCy   = wr.top + wr.height / 2;
      const slotCy   = sr.top + sr.height / 2;
      const drift    = slotCy - viewCy; // negative = slot above centre (user scrolled down)

      if (Math.abs(drift) < 2) return;

      const steps = Math.max(1, Math.round(Math.abs(drift) / this._pxPerWord));
      // drift < 0: slot above centre → scrolled down → advance (next word)
      // drift > 0: slot below centre → scrolled up  → retreat (prev word)
      this._stepN(steps, drift < 0 ? 1 : -1);

      const idx = this._activeIdx;
      if ((this._windowStart > 0 && idx - this._windowStart < REBUILD_MARGIN) ||
          (this._windowEnd < this.state.tokens.length - 1 && this._windowEnd - idx < REBUILD_MARGIN)) {
        this._build(idx);
      }
    });
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
    this._renderText(idx);
    this.state.currentIdx    = idx;
    this.state.manuallySeeked = true;
    this.display.render(this.state.tokens[idx]);
    this.display.updateSeek();
  }
}
