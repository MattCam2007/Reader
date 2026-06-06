import { PARAGRAPH_BREAK } from './tokenizer.js';

// Scroll-driven word picker shown while paused (when context is enabled).
//
// The word box stays pinned at the centre of the viewport — exactly where it
// lives while playing. The surrounding words flow above and below it in a
// scrollable column; whichever word reels into the centre becomes the active
// word: it is shown in the box and becomes the current reading position, so
// resuming continues from there.
//
// Only a window of words around the current position is rendered. When the
// active word scrolls near a window edge the window is rebuilt around it and
// the scroll position is restored, giving the illusion of an endless reel.

const WINDOW_WORDS = 400;   // words rendered each side of the anchor
const REBUILD_MARGIN = 90;  // rebuild once active is within this many words of an edge

export class ScrollPicker {
  constructor(state, prefs, display, els) {
    this.state = state;
    this.prefs = prefs;
    this.display = display;
    this.els = els; // needs readerWrap (scroll container) + contextFlow
    this.active = false;
    this._spans = [];
    this._activeSpan = null;
    this._windowStart = 0;
    this._windowEnd = 0;
    this._rafPending = false;
    this._suppressScroll = false;
    this._onScroll = this._onScroll.bind(this);
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
    this._spans = [];
    this._activeSpan = null;
  }

  // Rebuild the reel centred on a token index (e.g. after a step/seek).
  recenter(idx) {
    if (this.active) this._build(idx);
  }

  _build(centerIdx) {
    const { state } = this;
    const flow = this.els.contextFlow;
    const clamped = Math.max(0, Math.min(centerIdx, state.tokens.length - 1));

    let start = clamped, wc = 0;
    while (start > 0 && wc < WINDOW_WORDS) { start--; if (state.tokens[start] !== PARAGRAPH_BREAK) wc++; }
    let end = clamped, wc2 = 0;
    while (end < state.tokens.length - 1 && wc2 < WINDOW_WORDS) { end++; if (state.tokens[end] !== PARAGRAPH_BREAK) wc2++; }
    this._windowStart = start;
    this._windowEnd = end;

    flow.textContent = '';
    this._spans = [];
    this._activeSpan = null;
    const frag = document.createDocumentFragment();
    let centerSpan = null;
    for (let i = start; i <= end; i++) {
      const tok = state.tokens[i];
      if (tok === PARAGRAPH_BREAK) {
        const br = document.createElement('div');
        br.className = 'cw-break';
        frag.appendChild(br);
        continue;
      }
      const span = document.createElement('span');
      span.className = 'cw';
      span.dataset.idx = i;
      span.textContent = tok;
      frag.appendChild(span);
      this._spans.push(span);
      if (i === clamped) centerSpan = span;
    }
    flow.appendChild(frag);

    this._setActive(centerSpan || this._nearestSpan(), false);
    this._centerOn(this._activeSpan);
  }

  _centerOn(span) {
    if (!span) return;
    const wrap = this.els.readerWrap;
    const wrapRect = wrap.getBoundingClientRect();
    const r = span.getBoundingClientRect();
    const delta = (r.top + r.height / 2) - (wrapRect.top + wrapRect.height / 2);
    // Programmatic scroll: don't let it register as a user pick.
    this._suppressScroll = true;
    wrap.scrollTop += delta;
    requestAnimationFrame(() => { this._suppressScroll = false; });
  }

  _nearestSpan() {
    const wrap = this.els.readerWrap;
    const wrapRect = wrap.getBoundingClientRect();
    const cy = wrapRect.top + wrapRect.height / 2;
    let best = null, bestD = Infinity, falling = false;
    // Spans are stacked top-to-bottom, so distance to centre falls then rises:
    // stop as soon as it starts rising again.
    for (const span of this._spans) {
      const r = span.getBoundingClientRect();
      const d = Math.abs((r.top + r.height / 2) - cy);
      if (d < bestD) { bestD = d; best = span; falling = true; }
      else if (falling) break;
    }
    return best;
  }

  _setActive(span, fromScroll) {
    if (!span || span === this._activeSpan) return;
    if (this._activeSpan) this._activeSpan.classList.remove('cw--active');
    this._activeSpan = span;
    span.classList.add('cw--active');
    const idx = parseInt(span.dataset.idx, 10);
    this.state.currentIdx = idx;
    if (fromScroll) this.state.manuallySeeked = true;
    this.display.render(this.state.tokens[idx]);
    this.display.updateSeek();
  }

  _onScroll() {
    if (this._suppressScroll || this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      if (!this.active) return;
      this._setActive(this._nearestSpan(), true);
      const idx = this.state.currentIdx;
      const nearStart = this._windowStart > 0 &&
        this._wordsBetween(this._windowStart, idx) < REBUILD_MARGIN;
      const nearEnd = this._windowEnd < this.state.tokens.length - 1 &&
        this._wordsBetween(idx, this._windowEnd) < REBUILD_MARGIN;
      if (nearStart || nearEnd) this._build(idx);
    });
  }

  _wordsBetween(a, b) {
    let c = 0;
    for (let i = a; i <= b; i++) if (this.state.tokens[i] !== PARAGRAPH_BREAK) c++;
    return c;
  }
}
