import { HOVER_SETTLE_MS } from '../core/constants.js';
import { wordAtPoint, wordRange } from '../model/geometry.js';

// Is this PointerEvent an S Pen hover (near, not touching, no button)?
export function isHover(pointerType, buttons, pressure) {
  return pointerType === 'pen' && buttons === 0 && (pressure === 0 || pressure == null);
}

// Has the hover settled on a NEW word long enough to act?
// Returns true when `word` differs from `lastWord` (caller then starts/refreshes a timer).
export function hoverChangedWord(word, lastWord) {
  return word >= 0 && word !== lastWord;
}

export class HoverPreview {
  constructor(state, hooks) {
    // hooks: { onDefine(text, rect), peekFootnote(anchor)|null, peekLink(anchor)|null,
    //          onDebug(kind, key, n)|null }
    this._state = state;
    this._hooks = hooks;
    this._onDebug = hooks.onDebug || null;
    this._timer = null;
    this._lastKey = null;
  }

  onPenMove(x, y) {
    if (!this._state._prefs?.data?.penHover) return;

    // Element-first: is the pen over a link/footnote anchor?
    const anchor = document.elementFromPoint(x, y)?.closest('a[href]');
    // Word-second: which word token is under the pen?
    const wi = anchor ? -1 : wordAtPoint(this._state, x, y);
    if (!anchor && wi < 0) return;

    const key = anchor
      ? ('a:' + (anchor.getAttribute('href') || ''))
      : ('w:' + wi);
    if (key === this._lastKey) return;
    this._lastKey = key;
    clearTimeout(this._timer);
    const delay = this._state._prefs?.data?.penHoverDelay ?? HOVER_SETTLE_MS;
    const armed = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this._onDebug?.('arm', key, delay);
    this._timer = setTimeout(() => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this._onDebug?.('fire', key, Math.round(now - armed));
      this._show(anchor, wi, x, y);
    }, delay);
  }

  dismiss() {
    clearTimeout(this._timer);
    this._timer = null;
    this._lastKey = null;
  }

  _show(anchor, wi, x, y) {
    if (anchor) {
      if (this._hooks.peekFootnote?.(anchor)) return;
      this._hooks.peekLink?.(anchor);
      return;
    }
    if (wi >= 0) {
      const w = this._state.doc?.words?.[wi];
      if (!w) return;
      const text = w.node.textContent.slice(w.start, w.end);
      const range = wordRange(this._state, wi);
      const rect = range?.getBoundingClientRect() ?? null;
      this._hooks.onDefine(text, rect);
    }
  }
}
