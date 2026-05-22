import { DEFAULT_PREFS, MIN_SIZE, MAX_SIZE } from './constants.js';
import { EventBus } from './events.js';

export class PrefsManager extends EventBus {
  constructor({ storageKey = 'reader:prefs', defaults = DEFAULT_PREFS, version = 1 } = {}) {
    super();
    this.storageKey = storageKey;
    this.defaults = defaults;
    this.version = version;
    this.data = Object.assign({}, defaults);
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { console.warn("prefs:load", e); }
    if (this.data.size !== undefined) {
      this.data.size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, this.data.size | 0 || 19));
    }
    if (!this.data.v) this.data.v = this.version;
  }

  save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.data)); }
    catch (e) { console.warn("prefs:save", e); }
  }

  set(key, value) {
    const old = this.data[key];
    this.data[key] = value;
    if (old !== value) {
      this.emit(key, value, old);
      this.emit("change", key, value, old);
    }
  }

  get(key) {
    return this.data[key];
  }

  applyAll() {
    for (const key of Object.keys(this.data)) {
      this.emit(key, this.data[key]);
    }
  }
}
