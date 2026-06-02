import { SAVE_DEBOUNCE_MS } from './constants.js';
import { loadStoredPosition, saveStoredPosition } from './position.js';

export class StorageManager {
  constructor(state) {
    this.state = state;
    this._saveTimer = null;
  }

  _writePosNow(getPosFn) {
    const { state } = this;
    if (!state.bookId) return;
    let pos;
    try { pos = getPosFn(); } catch (e) { console.warn('storage:getPos', e); return; }
    if (pos) saveStoredPosition(state.bookId, pos);
  }

  savePos(getPosFn) {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._writePosNow(getPosFn), SAVE_DEBOUNCE_MS);
  }

  flushPos(getPosFn) {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._writePosNow(getPosFn);
  }

  restorePos(applyPosFn) {
    const pos = loadStoredPosition(this.state.bookId);
    if (pos) {
      try { applyPosFn(pos); } catch (e) { console.warn('storage:applyPos', e); }
    }
  }
}
