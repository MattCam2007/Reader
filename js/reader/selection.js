import { SELECTION_DEBOUNCE_MS } from '../core/constants.js';

export class SelectionManager {
  constructor(state, signal) {
    this.state = state;
    this._signal = signal;
    this._selBar = null;
    this._timer = null;
    this._bindEvents();
  }

  _bindEvents() {
    document.addEventListener("selectionchange", () => {
      if (!this.state._prefs.data.selection) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { this.dismiss(); return; }
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._show(), SELECTION_DEBOUNCE_MS);
    }, { signal: this._signal });
  }

  _show() {
    this.dismiss();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    this._selBar = document.createElement("div");
    this._selBar.className = "reader-sel-bar";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.type = "button";
    copyBtn.addEventListener("click", () => {
      try { navigator.clipboard.writeText(sel.toString()); } catch (_) {
        document.execCommand("copy");
      }
      this.dismiss();
    });
    this._selBar.appendChild(copyBtn);

    const defineBtn = document.createElement("button");
    defineBtn.textContent = "Define";
    defineBtn.type = "button";
    defineBtn.addEventListener("click", () => {
      const text = sel.toString().trim().split(/\s+/)[0];
      if (text) window.open("https://en.wiktionary.org/wiki/" + encodeURIComponent(text), "_blank");
      this.dismiss();
    });
    this._selBar.appendChild(defineBtn);

    document.body.appendChild(this._selBar);

    const barRect = this._selBar.getBoundingClientRect();
    let top = rect.top - barRect.height - 6;
    let left = rect.left + rect.width / 2 - barRect.width / 2;
    if (top < 4) top = rect.bottom + 6;
    if (left < 4) left = 4;
    if (left + barRect.width > window.innerWidth - 4) left = window.innerWidth - barRect.width - 4;
    this._selBar.style.top = top + "px";
    this._selBar.style.left = left + "px";
  }

  dismiss() {
    if (this._selBar) { this._selBar.remove(); this._selBar = null; }
  }
}
