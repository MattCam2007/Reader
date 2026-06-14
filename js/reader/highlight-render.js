import { resolveLocator, toLocator } from '../model/locator.js';
import { wordIndexFromNodeOffset, wordAtPoint, wordRange } from '../model/geometry.js';
import { t } from '../core/i18n.js';

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
  constructor(state, manager, signal, hooks = {}) {
    this.state = state;
    this.manager = manager;
    this._hooks = hooks;    // { onDefine(text, rect) }
    this._bar = null;       // edit bar for an existing highlight
    this._selBar = null;    // action bar for a live pen selection
    this._notePop = null;   // { backdrop, popover } note editor
    this._penSel = null;    // { lo, hi } word indices of the live pen selection
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
  // Highlights carrying a note are published under a second name (hl-<c>-note)
  // so CSS can mark them (dotted underline) — a cue that moves with the text,
  // unlike an absolutely-positioned marker.
  renderAll() {
    this.dismissBar();
    // NOTE: deliberately does not dismiss the note editor. Opening the soft
    // keyboard resizes the viewport, which triggers relayout() -> renderAll();
    // tearing down the textarea here would blur it and snap the keyboard shut
    // the instant it opened. The editor is closed explicitly by its own
    // Save/Delete/Cancel actions (and by clearAll on book change).
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const plain = {}, noted = {};
    for (const c of HL_COLORS) { plain[c] = []; noted[c] = []; }
    for (const item of this.manager.getAll()) {
      const range = this._rangeFor(item);
      if (!range) continue;
      const color = HL_COLORS.includes(item.color) ? item.color : 'yellow';
      (item.note ? noted : plain)[color].push(range);
    }
    const publish = (name, ranges) => {
      try {
        if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
        else CSS.highlights.delete(name);
      } catch (e) { console.warn('highlights:render', e); }
    };
    for (const c of HL_COLORS) {
      publish('hl-' + c, plain[c]);
      publish('hl-' + c + '-note', noted[c]);
    }
  }

  clearAll() {
    this.clearPenSelection();
    this.dismissBar();
    this._dismissNotePopover();
    if (typeof CSS === 'undefined' || !CSS.highlights) return;
    for (const c of HL_COLORS) {
      try { CSS.highlights.delete('hl-' + c); } catch (_) {}
      try { CSS.highlights.delete('hl-' + c + '-note'); } catch (_) {}
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

  // Store a highlight directly from word indices (the pen path, which never
  // creates a native window selection — see setPenSelection).
  createFromWords(aWi, bWi, color) {
    if (aWi < 0 || bWi < 0) return null;
    const lo = Math.min(aWi, bWi), hi = Math.max(aWi, bWi);
    const start = toLocator(this.state, lo);
    const end = toLocator(this.state, hi);
    if (!start || !end) return null;
    const item = this.manager.add({ start, end, color, text: this._textFor(lo, hi) });
    this.renderAll();
    return item;
  }

  // ── Pen selection (custom highlight, not the browser's window selection) ──
  // The pen drives its own word-granular "selection" rendered via
  // ::highlight(pen-selection). This avoids invoking Android's native text
  // selection (drag handles + the system Copy/Share toolbar), which otherwise
  // fights our own action bar.
  _penRange() {
    if (!this._penSel) return null;
    const r1 = wordRange(this.state, this._penSel.lo);
    const r2 = wordRange(this.state, this._penSel.hi);
    if (!r1 || !r2) return null;
    try {
      const range = document.createRange();
      range.setStart(r1.startContainer, r1.startOffset);
      range.setEnd(r2.endContainer, r2.endOffset);
      return range;
    } catch (_) { return null; }
  }

  _renderPenSelection() {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const range = this._penRange();
    try {
      if (range) CSS.highlights.set('pen-selection', new Highlight(range));
      else CSS.highlights.delete('pen-selection');
    } catch (e) { console.warn('highlights:pen-render', e); }
  }

  // Set/extend the pen selection to span words [a..b]. showBar=false while the
  // pen is still dragging (just paint), true on lift (paint + action bar).
  setPenSelection(a, b, showBar) {
    if (a == null || b == null || a < 0 || b < 0) { this.clearPenSelection(); return; }
    this._penSel = { lo: Math.min(a, b), hi: Math.max(a, b) };
    this._renderPenSelection();
    if (showBar) this._showPenBar();
    else this.dismissPenBar();
  }

  penSelectionActive() { return !!this._penSel; }

  clearPenSelection() {
    const had = !!this._penSel;
    this._penSel = null;
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      try { CSS.highlights.delete('pen-selection'); } catch (_) {}
    }
    this.dismissPenBar();
    return had;
  }

  _showPenBar() {
    this.dismissPenBar();
    const range = this._penRange();
    if (!range) return;
    const text = range.toString();
    const { lo, hi } = this._penSel;

    const bar = document.createElement('div');
    bar.className = 'reader-sel-bar';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = t('btn.copy');
    copy.addEventListener('click', () => {
      try { navigator.clipboard.writeText(text); } catch (_) { document.execCommand('copy'); }
      this.clearPenSelection();
    });
    bar.appendChild(copy);

    const define = document.createElement('button');
    define.type = 'button';
    define.textContent = t('btn.define');
    define.addEventListener('click', () => {
      const rect = range.getBoundingClientRect();
      if (this._hooks.onDefine) {
        this._hooks.onDefine(text, rect);
      } else {
        const word = text.trim().split(/\s+/)[0];
        if (word) window.open('https://en.wiktionary.org/wiki/' + encodeURIComponent(word), '_blank');
      }
      this.clearPenSelection();
    });
    bar.appendChild(define);

    for (const c of HL_COLORS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'reader-hl-swatch hl-' + c;
      sw.setAttribute('aria-label', t('a11y.highlight', { color: c }));
      sw.addEventListener('click', () => {
        this.createFromWords(lo, hi, c);
        this.clearPenSelection();
      });
      bar.appendChild(sw);
    }

    document.body.appendChild(bar);
    this._selBar = bar;

    const rect = range.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    let top = rect.top - barRect.height - 6;
    let left = rect.left + rect.width / 2 - barRect.width / 2;
    if (top < 4) top = rect.bottom + 6;
    if (left < 4) left = 4;
    if (left + barRect.width > window.innerWidth - 4) left = window.innerWidth - barRect.width - 4;
    bar.style.top = top + 'px';
    bar.style.left = left + 'px';
  }

  dismissPenBar() {
    if (this._selBar) { this._selBar.remove(); this._selBar = null; }
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
    const wrap = document.createElement('div');
    wrap.className = 'reader-hl-edit';

    // When the highlight has a note, show it read-only above the actions. The
    // Edit note button below still opens the editor — viewing and editing are
    // separate.
    if (item.note) {
      const view = document.createElement('div');
      view.className = 'reader-hl-note-view';
      view.textContent = item.note;
      wrap.appendChild(view);
    }

    const bar = document.createElement('div');
    bar.className = 'reader-sel-bar reader-hl-bar';

    for (const c of HL_COLORS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'reader-hl-swatch hl-' + c + (item.color === c ? ' active' : '');
      sw.setAttribute('aria-label', t('a11y.highlightColor', { color: c }));
      sw.addEventListener('click', () => {
        this.manager.updateColor(item.id, c);
        this.renderAll();
      });
      bar.appendChild(sw);
    }

    const note = document.createElement('button');
    note.type = 'button';
    note.textContent = item.note ? t('btn.editNote') : t('btn.addNote');
    note.addEventListener('click', () => {
      this.dismissBar();
      this._showNoteEditor(item, x, y);
    });
    bar.appendChild(note);

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = t('btn.remove');
    del.addEventListener('click', () => {
      this.manager.remove(item.id);
      this.renderAll();
    });
    bar.appendChild(del);

    wrap.appendChild(bar);
    document.body.appendChild(wrap);
    this._bar = wrap;

    const rect = wrap.getBoundingClientRect();
    let top = y - rect.height - 10;
    let left = x - rect.width / 2;
    if (top < 4) top = y + 14;
    if (left < 4) left = 4;
    if (left + rect.width > window.innerWidth - 4) left = window.innerWidth - rect.width - 4;
    wrap.style.top = top + 'px';
    wrap.style.left = left + 'px';
  }

  dismissBar() {
    if (this._bar) { this._bar.remove(); this._bar = null; }
  }

  // Read/edit a highlight's note in a popover (reuses the footnote popover
  // chrome). Save writes through the store and re-renders (so the dotted-
  // underline note cue updates); Delete clears the note text.
  _showNoteEditor(item, x, y) {
    this._dismissNotePopover();

    const backdrop = document.createElement('div');
    backdrop.className = 'note-popover-backdrop';
    backdrop.addEventListener('click', () => this._dismissNotePopover());

    const pop = document.createElement('div');
    pop.className = 'note-popover hl-note-editor';

    const ta = document.createElement('textarea');
    ta.className = 'hl-note-textarea';
    ta.placeholder = t('msg.addNotePlaceholder');
    ta.setAttribute('aria-label', t('a11y.highlightNote'));
    ta.value = item.note || '';
    pop.appendChild(ta);

    const actions = document.createElement('div');
    actions.className = 'hl-note-actions';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'hl-note-save';
    save.textContent = t('btn.save');
    save.addEventListener('click', () => {
      this.manager.updateNote(item.id, ta.value.trim());
      this._dismissNotePopover();
      this.renderAll(); // refresh the dotted-underline note cue
    });
    actions.appendChild(save);

    if (item.note) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'hl-note-clear';
      clear.textContent = t('btn.delete');
      clear.addEventListener('click', () => {
        this.manager.updateNote(item.id, '');
        this._dismissNotePopover();
        this.renderAll();
      });
      actions.appendChild(clear);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'hl-note-cancel';
    cancel.textContent = t('btn.cancel');
    cancel.addEventListener('click', () => this._dismissNotePopover());
    actions.appendChild(cancel);

    pop.appendChild(actions);

    document.body.appendChild(backdrop);
    document.body.appendChild(pop);
    this._notePop = { backdrop, popover: pop };

    const popRect = pop.getBoundingClientRect();
    const vpW = window.innerWidth, vpH = window.innerHeight;
    let top = y + 12;
    let left = x - popRect.width / 2;
    if (left < 8) left = 8;
    if (left + popRect.width > vpW - 8) left = vpW - popRect.width - 8;
    if (top + popRect.height > vpH - 8) top = Math.max(8, y - popRect.height - 12);
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';

    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }

  _dismissNotePopover() {
    if (this._notePop) {
      this._notePop.backdrop.remove();
      this._notePop.popover.remove();
      this._notePop = null;
    }
  }
}
