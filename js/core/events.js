export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const fns = this._listeners.get(event);
    if (!fns) return;
    const i = fns.indexOf(fn);
    if (i >= 0) fns.splice(i, 1);
  }

  emit(event, ...args) {
    const fns = this._listeners.get(event);
    if (fns) fns.forEach(fn => fn(...args));
    // Also fire wildcard listeners
    const wild = this._listeners.get("*");
    if (wild) wild.forEach(fn => fn(event, ...args));
  }
}
