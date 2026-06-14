import { safeSetItem } from './safe-storage.js';

export const HIGHLIGHTS_KEY_PREFIX = 'reader:highlights:';
const KEY_PREFIX = HIGHLIGHTS_KEY_PREFIX;

// Per-book highlight store. Mirrors BookmarkManager: a flat array persisted to
// localStorage under reader:highlights:<bookId>. Each item addresses its span
// with two portable locators ({s,b,w}) — never live DOM ranges — so highlights
// survive repagination, font/theme changes, and reload (see plans/stylus-
// support.md §2.5). Rendering re-resolves the locators to ranges on demand.
export class HighlightManager {
  constructor() {
    this.bookId = null;
    this._items = [];
    // Bumped on every mutation so consumers can cheaply detect changes.
    this.generation = 0;
  }

  setBook(bookId) {
    this.bookId = bookId;
    this.load();
  }

  load() {
    if (!this.bookId) return;
    this.generation++;
    try {
      const raw = localStorage.getItem(KEY_PREFIX + this.bookId);
      this._items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this._items)) this._items = [];
    } catch (e) {
      console.warn('highlights:load', e);
      this._items = [];
    }
  }

  _save() {
    this.generation++;
    if (!this.bookId) return;
    try {
      safeSetItem(KEY_PREFIX + this.bookId, JSON.stringify(this._items));
    } catch (e) {
      console.warn('highlights:save', e);
    }
  }

  // start/end are inclusive-word locators {s,b,w}; color is a palette key.
  add({ start, end, color = 'yellow', text = '', note = '' }) {
    if (!start || !end) return null;
    const id = 'hl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const item = {
      id,
      createdAt: Date.now(),
      start,
      end,
      color: color || 'yellow',
      text: (text || '').slice(0, 120),
      note: note || '',
    };
    this._items.push(item);
    this._save();
    return item;
  }

  updateColor(id, color) {
    const item = this._items.find(i => i.id === id);
    if (item) { item.color = color || 'yellow'; this._save(); }
  }

  updateNote(id, note) {
    const item = this._items.find(i => i.id === id);
    if (item) { item.note = note || ''; this._save(); }
  }

  remove(id) {
    const idx = this._items.findIndex(i => i.id === id);
    if (idx !== -1) { this._items.splice(idx, 1); this._save(); }
  }

  getAll() {
    return this._items.slice();
  }

  count() { return this._items.length; }
}
