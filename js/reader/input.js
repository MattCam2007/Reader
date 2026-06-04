import {
  SWIPE_THRESHOLD_MAX_PX, SWIPE_THRESHOLD_VP_FRACTION,
  TAP_ZONE_LEFT, TAP_ZONE_RIGHT,
  SYNTHETIC_CLICK_GUARD_MS, TAP_TIMEOUT_MS
} from '../core/constants.js';
import * as perf from '../core/perf.js';

export class InputHandler {
  constructor(state, els, pagination, callbacks, signal) {
    this.state = state;
    this.els = els;
    this.pagination = pagination;
    this.callbacks = callbacks; // { toggleChrome, dismissCoach, closePanels, dismissSelBar, dismissNotePopover, activePopoverRef }
    this._signal = signal;

    // Private touch state
    this._dragging = false;
    this._decided = null;
    this._startX = 0;
    this._startY = 0;
    this._baseTx = 0;
    this._startT = 0;
    this._lastTouchEnd = 0;

    this._bindEvents();
  }

  _bindEvents() {
    const { viewport, content } = this.els;
    const signal = this._signal;

    viewport.addEventListener("touchstart", (e) => {
      this.callbacks.dismissCoach();
      if (this.state.isScrollMode || e.touches.length !== 1 || this.state.total <= 1) return;
      const t = e.touches[0];
      this._startX = t.clientX;
      this._startY = t.clientY;
      this._startT = Date.now();
      this._baseTx = -(this.state.page * this.state.stride);
      this._decided = null;
      this._dragging = true;
    }, { passive: true, signal });

    viewport.addEventListener("touchmove", (e) => {
      if (!this._dragging) return;
      const t = e.touches[0];
      const dx = t.clientX - this._startX;
      const dy = t.clientY - this._startY;
      if (this._decided === null) {
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) this._decided = "h";
        else if (Math.abs(dy) > 12) this._decided = "v";
      }
      if (this._decided === "h") {
        content.style.transition = "none";
        e.preventDefault();
        let tx = this._baseTx + dx;
        const min = -((this.state.total - 1) * this.state.stride);
        const max = 0;
        if (tx > max) tx = max + (tx - max) * 0.3;
        if (tx < min) tx = min + (tx - min) * 0.3;
        content.style.setProperty("--page-offset", tx + "px");
      }
    }, { passive: false, signal });

    viewport.addEventListener("touchend", (e) => {
      if (!this._dragging) return;
      this._dragging = false;
      this._lastTouchEnd = Date.now();
      const t = e.changedTouches && e.changedTouches[0];
      const dx = t ? t.clientX - this._startX : 0;
      const dy = t ? t.clientY - this._startY : 0;
      if (this._decided === "h") {
        const threshold = Math.min(SWIPE_THRESHOLD_MAX_PX, viewport.clientWidth * SWIPE_THRESHOLD_VP_FRACTION);
        if (dx <= -threshold) perf.latencyToPaint("turn-latency", () => this.pagination.goTo(this.state.page + 1, true), { via: "swipe", dir: "next" });
        else if (dx >= threshold) perf.latencyToPaint("turn-latency", () => this.pagination.goTo(this.state.page - 1, true), { via: "swipe", dir: "prev" });
        else this.pagination.goTo(this.state.page, true);
      } else if (this._decided !== "v" && Math.abs(dx) < 10 && Math.abs(dy) < 10 && (Date.now() - this._startT) < TAP_TIMEOUT_MS) {
        this._handleTap(this._startX);
      }
    }, { passive: true, signal });

    viewport.addEventListener("click", (e) => {
      this.callbacks.dismissCoach();
      if (Date.now() - this._lastTouchEnd < SYNTHETIC_CLICK_GUARD_MS) return;
      this._handleTap(e.clientX);
    }, { signal });

    document.addEventListener("keydown", (e) => {
      if (this.callbacks.activePopoverRef() && e.key === "Escape") {
        this.callbacks.dismissNotePopover();
        return;
      }
      // Don't capture navigation keys when an input/textarea has focus
      const tag = document.activeElement && document.activeElement.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.code === "Space") {
        if (inInput) return;
        e.preventDefault();
        perf.latencyToPaint("turn-latency", () => this.pagination.next(), { via: "key", dir: "next" });
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        if (inInput) return;
        e.preventDefault();
        perf.latencyToPaint("turn-latency", () => this.pagination.prev(), { via: "key", dir: "prev" });
      } else if (e.key === "Escape") {
        this.callbacks.dismissCoach();
        this.callbacks.closePanels();
      }
    }, { signal });
  }

  _handleTap(x) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      this.callbacks.dismissSelBar();
      sel.removeAllRanges();
      return;
    }
    if (this.callbacks.activePopoverRef()) {
      this.callbacks.dismissNotePopover();
      return;
    }
    if (!document.body.classList.contains("chrome-hidden") &&
        (document.body.classList.contains("show-toc") || document.body.classList.contains("show-search") || document.getElementById("settingsScreen"))) {
      this.callbacks.closePanels();
      return;
    }
    if (this.state.isScrollMode) {
      this.callbacks.toggleChrome();
      return;
    }
    const w = this.els.viewport.clientWidth;
    if (x < w * TAP_ZONE_LEFT) perf.latencyToPaint("turn-latency", () => this.pagination.prev(), { via: "tap", dir: "prev" });
    else if (x > w * TAP_ZONE_RIGHT) perf.latencyToPaint("turn-latency", () => this.pagination.next(), { via: "tap", dir: "next" });
    else this.callbacks.toggleChrome();
  }
}
