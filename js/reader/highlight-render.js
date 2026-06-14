import { resolveLocator, toLocator } from '../model/locator.js';
import { wordIndexFromNodeOffset, wordAtPoint } from '../model/geometry.js';

// Palette keys, in render order. Each has a matching ::highlight(hl-<key>) rule
// in css/components/selection.css and a swatch colour below.
export const HL_COLORS = ['yellow', 'green', 'blue', 'pink'];

// Renders persisted highlights via the CSS Custom Highlight API (the same
// mechanism search and the resume-highlight use) and owns the small edit bar
// shown when an existing highlight is tapped. Highlights are addressed by
// locator and re-resolved to ranges on every relayout, so nothing here holds a
// live Range across repagination. When the Highlight API is unavailable the
// store still works — highlights just don't paint (graceful degradation).
export class HighlightController {
  constructor(state, manager, signal) {
    this.state = state;
    this.manager = manager;
    this._bar = null;
    // Dismiss the edit bar on any tap outside it.
    document.addEventListener('pointerdown', (e) => {
      if (this._bar && !this._bar.contains(e.target)) this.dismissBar();
    }, { signal });
  }

  _rangeFor(item) {
    const state = this.state;
    let s = resolveLocator(state, item.start);
    let e = resolveLocator(state, item.end);
    if (s < 0 || e < 0) return null;
    if (e < s) { const t = s; s = e; e = t; }
    const a = state.doc.words[s];
    const b = state.doc.words[e];
    if (!a || !b) return null;
    // Off-window chapters are detached in windowed mode; skip ranges whose
    // endpoints aren't in the live tree (they re-render on the next window turn).
    if (!a.node.isConnected || !b.node.isConnected) return null;
    try {
      const range = document.createRange();
      range.setStart(a.node, a.start);
      range.setEnd(b.node, b.end);
      return range;
    } catch (_) { return null; }
  }

  // Re-resolve every stored highlight to a Range and publish one Highlight per
  // colour. Call after the first paginate and after every relayout/window turn.
  renderAll() {
    this.dismissBar();
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const groups = {};
    for (const c of HL_COLORS) groups[c] = [];
    for (const item of this.manager.getAll()) {
      const range = this._rangeFor(item);
      if (!range) continue;
      const color = HL_COLORS.includes(item.color) ? item.color : 'yellow';
      groups[color].push(range);
    }
    for (const c of HL_COLORS) {
      const name = 'hl-' + c;
      try {
        if (groups[c].length) CSS.highlights.set(name, new Highlight(...groups[c]));
        else CSS.highlights.delete(name);
      } catch (e) { console.warn('highlights:render', e); }
    }
  }

  clearAll() {
    this.dismissBar();
    if (typeof CSS === 'undefined' || !CSS.highlights) return;
    for (const c of HL_COLORS) {
      try { CSS.highlights.delete('hl-' + c); } catch (_) {}
    }
  }

  _textFor(sWi, eWi) {
    const doc = this.state.doc;
    const parts = [];
    for (let i = sWi; i <= eWi && parts.length < 40; i++) {
      const w = doc.words[i];
      if (w) parts.push(w.node.nodeValue.slice(w.start, w.end));
    }
    return parts.join(' ');
  }

  // Turn the current window selection into a stored highlight in `color`.
  createFromSelection(color) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    let sWi = wordIndexFromNodeOffset(this.state, r.startContainer, r.startOffset, 'start');
    let eWi = wordIndexFromNodeOffset(this.state, r.endContainer, r.endOffset, 'end');
    if (sWi < 0 || eWi < 0) return null;
    if (eWi < sWi) { const t = sWi; sWi = eWi; eWi = t; }
    const start = toLocator(this.state, sWi);
    const end = toLocator(this.state, eWi);
    if (!start || !end) return null;
    const item = this.manager.add({ start, end, color, text: this._textFor(sWi, eWi) });
    this.renderAll();
    return item;
  }

  itemAtWord(wi) {
    if (wi < 0) return null;
    for (const item of this.manager.getAll()) {
      let s = resolveLocator(this.state, item.start);
      let e = resolveLocator(this.state, item.end);
      if (s < 0 || e < 0) continue;
      if (e < s) { const t = s; s = e; e = t; }
      if (wi >= s && wi <= e) return item;
    }
    return null;
  }

  itemAtPoint(x, y) {
    return this.itemAtWord(wordAtPoint(this.state, x, y));
  }

  // If a highlight sits under (x,y), open its edit bar and return true.
  handleTap(x, y) {
    const item = this.itemAtPoint(x, y);
    if (!item) return false;
    this._showBar(item, x, y);
    return true;
  }

  _showBar(item, x, y) {
    this.dismissBar();
    const bar = document.createElement('div');
    bar.className = 'reader-sel-bar reader-hl-bar';

    for (const c of HL_COLORS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'reader-hl-swatch hl-' + c + (item.color === c ? ' active' : '');
      sw.setAttribute('aria-label', 'Highlight colour ' + c);
      sw.addEventListener('click', () => {
        this.manager.updateColor(item.id, c);
        this.renderAll();
      });
      bar.appendChild(sw);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Remove';
    del.addEventListener('click', () => {
      this.manager.remove(item.id);
      this.renderAll();
    });
    bar.appendChild(del);

    document.body.appendChild(bar);
    this._bar = bar;

    const rect = bar.getBoundingClientRect();
    let top = y - rect.height - 10;
    let left = x - rect.width / 2;
    if (top < 4) top = y + 14;
    if (left < 4) left = 4;
    if (left + rect.width > window.innerWidth - 4) left = window.innerWidth - rect.width - 4;
    bar.style.top = top + 'px';
    bar.style.left = left + 'px';
  }

  dismissBar() {
    if (this._bar) { this._bar.remove(); this._bar = null; }
  }
}
