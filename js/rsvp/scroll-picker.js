import { PARAGRAPH_BREAK } from './tokenizer.js';

// Scroll-driven word picker shown while paused (when context is enabled).
//
// The word box stays pinned at the centre of the viewport — exactly where it
// lives while playing. The surrounding text flows above and below it as a
// readable paragraph (many words per line) so you keep your bearings. As you
// scroll, whichever word reels into the centre of the box becomes the active
// word: it is shown in the box and becomes the current reading position, so
// resuming continues from there.
//
// Only a window of words around the current position is rendered. When the
// active word scrolls near a window edge the window is rebuilt around it and
// the scroll position is restored, giving the illusion of an endless reel.

const WINDOW_WORDS = 500;   // words rendered each side of the anchor
const REBUILD_MARGIN = 120; // rebuild once active is within this many words of an edge

export class ScrollPicker {
  constructor(state, prefs, display, els) {
    this.state = state;
    this.prefs = prefs;
    this.display = display;
    this.els = els; // needs readerWrap (scroll container) + contextFlow
    this.active = false;
    this._entries = [];      // { el, idx, cx, cy } in scroll-content coords
    this._activeEntry = null;
    this._windowStart = 0;
    this._windowEnd = 0;
    this._wrapH = 0;
    this._wrapW = 0;
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
    this._entries = [];
    this._activeEntry = null;
  }

  // Rebuild the reel centred on a token index (e.g. after a step/seek).
  recenter(idx) {
    if (this.active) this._build(idx);
  }

  _build(centerIdx) {
    const { state } = this;
    const flow = this.els.contextFlow;
    const wrap = this.els.readerWrap;
    const clamped = Math.max(0, Math.min(centerIdx, state.tokens.length - 1));

    let start = clamped, wc = 0;
    while (start > 0 && wc < WINDOW_WORDS) { start--; if (state.tokens[start] !== PARAGRAPH_BREAK) wc++; }
    let end = clamped, wc2 = 0;
    while (end < state.tokens.length - 1 && wc2 < WINDOW_WORDS) { end++; if (state.tokens[end] !== PARAGRAPH_BREAK) wc2++; }
    this._windowStart = start;
    this._windowEnd = end;

    flow.textContent = '';
    this._entries = [];
    this._activeEntry = null;
    const frag = document.createDocumentFragment();
    let centerEl = null;
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
      frag.appendChild(document.createTextNode(' '));
      this._entries.push({ el: span, idx: i, cx: 0, cy: 0 });
      if (i === clamped) centerEl = span;
    }
    flow.appendChild(frag);

    // Measure every word once (single layout pass) into scroll-content coords,
    // so the per-scroll nearest-word search needs no further layout reads.
    const wrapRect = wrap.getBoundingClientRect();
    this._wrapH = wrapRect.height;
    this._wrapW = wrapRect.width;
    const st = wrap.scrollTop;
    let centerEntry = null;
    for (const e of this._entries) {
      const r = e.el.getBoundingClientRect();
      e.cx = (r.left - wrapRect.left) + r.width / 2;
      e.cy = (r.top - wrapRect.top) + st + r.height / 2;
      if (e.el === centerEl) centerEntry = e;
    }

    this._setActive(centerEntry || this._nearest(), false);
    this._centerOn(this._activeEntry);
  }

  _centerOn(entry) {
    if (!entry) return;
    const wrap = this.els.readerWrap;
    // Programmatic scroll: don't let it register as a user pick.
    this._suppressScroll = true;
    wrap.scrollTop = entry.cy - this._wrapH / 2;
    requestAnimationFrame(() => { this._suppressScroll = false; });
  }

  // Word nearest the centre point of the viewport (2D, so it works with the
  // multi-word centred lines of the flowing paragraph).
  _nearest() {
    const targetY = this.els.readerWrap.scrollTop + this._wrapH / 2;
    const targetX = this._wrapW / 2;
    let best = null, bestD = Infinity;
    for (const e of this._entries) {
      const dx = e.cx - targetX;
      const dy = e.cy - targetY;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  _setActive(entry, fromScroll) {
    if (!entry || entry === this._activeEntry) return;
    if (this._activeEntry) this._activeEntry.el.classList.remove('cw--active');
    this._activeEntry = entry;
    entry.el.classList.add('cw--active');
    this.state.currentIdx = entry.idx;
    if (fromScroll) this.state.manuallySeeked = true;
    this.display.render(this.state.tokens[entry.idx]);
    this.display.updateSeek();
  }

  _onScroll() {
    if (this._suppressScroll || this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      if (!this.active) return;
      this._setActive(this._nearest(), true);
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
