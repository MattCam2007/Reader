import { SELECTION_DEBOUNCE_MS } from '../core/constants.js';

// Floating toolbar shown over a text selection. Beyond Copy/Define it offers
// "continue in another mode from here" actions, so selecting a word or sentence
// becomes the anchor for switching between reading, speed-reading and listening
// without losing your place. Used by both the paginated reader and TTS view.
export class SelectionToolbar {
  constructor(opts = {}) {
    this.opts = opts;
    this._bar = null;
    this._timer = null;
    this._signal = opts.signal;
    this._bind();
  }

  _bind() {
    document.addEventListener('selectionchange', () => {
      if (this.opts.isEnabled && !this.opts.isEnabled()) { this.dismiss(); return; }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { this.dismiss(); return; }
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._show(), SELECTION_DEBOUNCE_MS);
    }, { signal: this._signal });
  }

  _button(label, onActivate, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (extraClass) btn.className = extraClass;
    // Guard the selection against the synthetic mousedown teardown so the
    // range is still live when we read it inside the click handler.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onActivate(); });
    return btn;
  }

  _show() {
    this.dismiss();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const bar = document.createElement('div');
    bar.className = 'reader-sel-bar';

    bar.appendChild(this._button('Copy', () => {
      const text = sel.toString();
      try { navigator.clipboard.writeText(text); } catch (_) {
        try { document.execCommand('copy'); } catch (__) {}
      }
      this.dismiss();
    }));

    bar.appendChild(this._button('Define', () => {
      const word = sel.toString().trim().split(/\s+/)[0];
      if (word) window.open('https://en.wiktionary.org/wiki/' + encodeURIComponent(word), '_blank');
      this.dismiss();
    }));

    const modes = this.opts.modes || [];
    if (modes.length && typeof this.opts.onModeSwitch === 'function') {
      modes.forEach((m) => {
        bar.appendChild(this._button(m.label, () => this._jump(m.mode, range), 'sel-mode-btn'));
      });
    }

    document.body.appendChild(bar);
    this._bar = bar;
    this._position(bar, rect);
  }

  _jump(mode, range) {
    let fraction = null;
    if (typeof this.opts.resolveFraction === 'function') {
      try { fraction = this.opts.resolveFraction(range); } catch (_) { fraction = null; }
    }
    if ((fraction == null || fraction < 0) && typeof this.opts.fallbackFraction === 'function') {
      try { fraction = this.opts.fallbackFraction(); } catch (_) { fraction = 0; }
    }
    const info = { fromSelection: true };
    if (typeof fraction === 'number' && fraction >= 0) info.fraction = fraction;
    if (typeof this.opts.getBookId === 'function') info.bookId = this.opts.getBookId();
    this.dismiss();
    try { window.getSelection().removeAllRanges(); } catch (_) {}
    this.opts.onModeSwitch(mode, info);
  }

  _position(bar, rect) {
    const barRect = bar.getBoundingClientRect();
    let top = rect.top - barRect.height - 6;
    let left = rect.left + rect.width / 2 - barRect.width / 2;
    if (top < 4) top = rect.bottom + 6;
    if (left < 4) left = 4;
    if (left + barRect.width > window.innerWidth - 4) left = window.innerWidth - barRect.width - 4;
    bar.style.top = top + 'px';
    bar.style.left = left + 'px';
  }

  dismiss() {
    if (this._bar) { this._bar.remove(); this._bar = null; }
  }
}
