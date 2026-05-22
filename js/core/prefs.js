import { DEFAULT_PREFS, MIN_SIZE, MAX_SIZE } from './constants.js';
import { EventBus } from './events.js';

export class PrefsManager extends EventBus {
  constructor() {
    super();
    this.data = Object.assign({}, DEFAULT_PREFS);
  }

  load() {
    try {
      const raw = localStorage.getItem("reader:prefs");
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { console.warn("prefs:load", e); }
    this.data.size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, this.data.size | 0 || 19));
    if (!this.data.v) this.data.v = 1;
  }

  save() {
    try { localStorage.setItem("reader:prefs", JSON.stringify(this.data)); }
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
