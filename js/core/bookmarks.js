export const BOOKMARKS_KEY_PREFIX = 'reader:bookmarks:';
const KEY_PREFIX = BOOKMARKS_KEY_PREFIX;

export class BookmarkManager {
  constructor() {
    this.bookId = null;
    this._items = [];
  }

  setBook(bookId) {
    this.bookId = bookId;
    this.load();
  }

  load() {
    if (!this.bookId) return;
    try {
      const raw = localStorage.getItem(KEY_PREFIX + this.bookId);
      this._items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this._items)) this._items = [];
    } catch (e) {
      console.warn('bookmarks:load', e);
      this._items = [];
    }
  }

  _save() {
    if (!this.bookId) return;
    try {
      localStorage.setItem(KEY_PREFIX + this.bookId, JSON.stringify(this._items));
    } catch (e) {
      console.warn('bookmarks:save', e);
    }
  }

  add({ position, fraction, chapterLabel, text, note = '', color = '' }) {
    const id = 'bm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const item = {
      id,
      createdAt: Date.now(),
      position: position || null,
      fraction: typeof fraction === 'number' ? fraction : 0,
      chapterLabel: chapterLabel || '',
      text: (text || '').slice(0, 120),
      note: note || '',
      color: color || '',
    };
    this._items.push(item);
    this._save();
    return item;
  }

  updateNote(id, note) {
    const item = this._items.find(i => i.id === id);
    if (item) { item.note = note; this._save(); }
  }

  updateColor(id, color) {
    const item = this._items.find(i => i.id === id);
    if (item) { item.color = color || ''; this._save(); }
  }

  // Migrate-on-read: legacy bookmarks (fraction only) get a canonical position
  // written back the first time they are navigated to, so the fraction stops
  // being a navigation input (it remains the display/marker metric).
  updatePosition(id, position) {
    const item = this._items.find(i => i.id === id);
    if (item) { item.position = position || null; this._save(); }
  }

  remove(id) {
    const idx = this._items.findIndex(i => i.id === id);
    if (idx !== -1) { this._items.splice(idx, 1); this._save(); }
  }

  getAll() {
    return this._items.slice().sort((a, b) => a.fraction - b.fraction);
  }

  count() { return this._items.length; }
}
