import {
  SWIPE_THRESHOLD_MAX_PX, SWIPE_THRESHOLD_VP_FRACTION,
  TAP_ZONE_LEFT, TAP_ZONE_RIGHT,
  SYNTHETIC_CLICK_GUARD_MS, TAP_TIMEOUT_MS
} from '../core/constants.js';
import * as perf from '../core/perf.js';

function pinchDist(touches) {
  const dx = touches[1].clientX - touches[0].clientX;
  const dy = touches[1].clientY - touches[0].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

export class InputHandler {
  constructor(state, els, pagination, callbacks, signal) {
    this.state = state;
    this.els = els;
    this.pagination = pagination;
    this.callbacks = callbacks; // { toggleChrome, dismissCoach, closePanels, dismissSelBar, dismissNotePopover, activePopoverRef }
    this._signal = signal;

    // Single-touch drag (page turn) state
    this._dragging = false;
    this._decided = null;
    this._startX = 0;
    this._startY = 0;
    this._baseTx = 0;
    this._startT = 0;
    this._lastTouchEnd = 0;

    // Pinch-zoom state
    this._zoomScale = 1;
    this._zoomTx = 0;
    this._zoomTy = 0;
    this._pinching = false;
    this._pinchStartDist = 0;
    this._pinchStartScale = 1;
    this._pinchElX = 0; // contentClip-local point under initial pinch midpoint
    this._pinchElY = 0;

    // Pan-while-zoomed state (1 finger when scale > 1)
    this._zoomPanning = false;
    this._panStartX = 0;
    this._panStartY = 0;
    this._panBaseTx = 0;
    this._panBaseTy = 0;

    // Double-tap to reset zoom
    this._lastTapTime = 0;

    // Fix zoom transform anchor at the top-left of contentClip so all math uses
    // a consistent origin. offsetLeft/Top give the natural (untransformed) position.
    if (els.contentClip) els.contentClip.style.transformOrigin = '0 0';

    this._bindEvents();
  }

  _bindEvents() {
    const { viewport, content } = this.els;
    const signal = this._signal;

    viewport.addEventListener("touchstart", (e) => {
      this.callbacks.dismissCoach();

      // ── Two-finger pinch: start zoom ──────────────────────────────────────
      if (e.touches.length === 2 && !this.state.isScrollMode) {
        this._dragging = false;
        this._decided = null;
        this._zoomPanning = false;
        this._pinching = true;
        this._pinchStartDist = pinchDist(e.touches);
        this._pinchStartScale = this._zoomScale;
        const clip = this.els.contentClip;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        // Map pinch midpoint from screen to contentClip local (pre-transform) coords.
        // offsetLeft/Top are unaffected by the transform we apply to contentClip.
        this._pinchElX = (mx - clip.offsetLeft - this._zoomTx) / this._zoomScale;
        this._pinchElY = (my - clip.offsetTop  - this._zoomTy) / this._zoomScale;
        return;
      }

      // ── One finger while zoomed: pan ──────────────────────────────────────
      if (this._zoomScale > 1 && e.touches.length === 1) {
        this._zoomPanning = true;
        this._panStartX  = e.touches[0].clientX;
        this._panStartY  = e.touches[0].clientY;
        this._panBaseTx  = this._zoomTx;
        this._panBaseTy  = this._zoomTy;
        this._startX = e.touches[0].clientX; // for tap detection in touchend
        this._startY = e.touches[0].clientY;
        this._startT = Date.now();
        return;
      }

      // ── Normal single-touch: page turn ────────────────────────────────────
      if (this.state.isScrollMode || e.touches.length !== 1) return;
      const s = this.state;
      const canSwipe = s.total > 1 ||
        (s.windowed && s.chapWindows && (s.curChap > 0 || s.curChap < s.chapWindows.length - 1));
      if (!canSwipe) return;
      const t = e.touches[0];
      this._startX = t.clientX;
      this._startY = t.clientY;
      this._startT = Date.now();
      this._baseTx = -(this.state.page * this.state.stride);
      this._decided = null;
      this._dragging = true;
    }, { passive: true, signal });

    viewport.addEventListener("touchmove", (e) => {
      // ── Pinch: update scale keeping the pinch centre fixed ────────────────
      if (this._pinching && e.touches.length >= 2) {
        e.preventDefault();
        const dist     = pinchDist(e.touches);
        const newScale = Math.max(1, Math.min(5, this._pinchStartScale * dist / this._pinchStartDist));
        const clip     = this.els.contentClip;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        this._zoomScale = newScale;
        this._zoomTx    = mx - clip.offsetLeft - this._pinchElX * newScale;
        this._zoomTy    = my - clip.offsetTop  - this._pinchElY * newScale;
        this._clampZoomPan();
        this._applyZoom();
        return;
      }

      // ── Pan while zoomed ──────────────────────────────────────────────────
      if (this._zoomPanning && e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0];
        this._zoomTx = this._panBaseTx + t.clientX - this._panStartX;
        this._zoomTy = this._panBaseTy + t.clientY - this._panStartY;
        this._clampZoomPan();
        this._applyZoom();
        return;
      }

      // ── Normal drag ───────────────────────────────────────────────────────
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
      // ── Pinch end ─────────────────────────────────────────────────────────
      if (this._pinching) {
        this._pinching = false;
        if (this._zoomScale < 1.05) {
          this._resetZoom();
        } else if (e.touches.length === 1) {
          // One finger still down: smoothly transition into pan mode
          this._zoomPanning = true;
          this._panStartX  = e.touches[0].clientX;
          this._panStartY  = e.touches[0].clientY;
          this._panBaseTx  = this._zoomTx;
          this._panBaseTy  = this._zoomTy;
        }
        this._lastTouchEnd = Date.now();
        return;
      }

      // ── Pan-while-zoomed end ──────────────────────────────────────────────
      if (this._zoomPanning) {
        this._zoomPanning = false;
        this._lastTouchEnd = Date.now();
        const t  = e.changedTouches && e.changedTouches[0];
        const dx = t ? t.clientX - this._startX : 0;
        const dy = t ? t.clientY - this._startY : 0;
        // Small/fast lift = tap: route through _handleTap for double-tap zoom reset
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && (Date.now() - this._startT) < TAP_TIMEOUT_MS) {
          this._handleTap(this._startX);
        }
        return;
      }

      // ── Normal drag end ───────────────────────────────────────────────────
      if (!this._dragging) return;
      this._dragging = false;
      this._lastTouchEnd = Date.now();
      const t  = e.changedTouches && e.changedTouches[0];
      const dx = t ? t.clientX - this._startX : 0;
      const dy = t ? t.clientY - this._startY : 0;
      if (this._decided === "h") {
        const threshold = Math.min(SWIPE_THRESHOLD_MAX_PX, viewport.clientWidth * SWIPE_THRESHOLD_VP_FRACTION);
        if (dx <= -threshold) perf.latencyToPaint("turn-latency", () => this.pagination.next(), { via: "swipe", dir: "next" });
        else if (dx >= threshold) perf.latencyToPaint("turn-latency", () => this.pagination.prev(), { via: "swipe", dir: "prev" });
        else this.pagination.goTo(this.state.page, true);
      } else if (this._decided !== "v" && Math.abs(dx) < 10 && Math.abs(dy) < 10 && (Date.now() - this._startT) < TAP_TIMEOUT_MS) {
        this._handleTap(this._startX);
      }
    }, { passive: true, signal });

    viewport.addEventListener("touchcancel", () => {
      this._pinching = false;
      this._zoomPanning = false;
      this._dragging = false;
      this._decided = null;
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
      const tag = document.activeElement && document.activeElement.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.code === "Space") {
        if (inInput) return;
        e.preventDefault();
        this._resetZoom();
        perf.latencyToPaint("turn-latency", () => this.pagination.next(), { via: "key", dir: "next" });
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        if (inInput) return;
        e.preventDefault();
        this._resetZoom();
        perf.latencyToPaint("turn-latency", () => this.pagination.prev(), { via: "key", dir: "prev" });
      } else if (e.key === "Escape") {
        if (this._zoomScale > 1) { this._resetZoom(); return; }
        this.callbacks.dismissCoach();
        this.callbacks.closePanels();
      }
    }, { signal });
  }

  _handleTap(x) {
    // Double-tap resets zoom. Single tap while zoomed is ignored (no page turn).
    if (this._zoomScale > 1) {
      const now = Date.now();
      if (now - this._lastTapTime < 300) {
        this._resetZoom();
        this._lastTapTime = 0;
      } else {
        this._lastTapTime = now;
      }
      return;
    }

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

  // Apply or clear the zoom transform on contentClip. When scale > 1 the clip's
  // overflow is opened so the zoomed content can fill the viewport margins; the
  // outer viewport (overflow: hidden, inset: 0) still clips at screen edges.
  _applyZoom() {
    const { contentClip } = this.els;
    if (!contentClip) return;
    if (this._zoomScale <= 1) {
      contentClip.style.transform = '';
      contentClip.style.overflow  = '';
    } else {
      contentClip.style.transform = `translate(${this._zoomTx}px,${this._zoomTy}px) scale(${this._zoomScale})`;
      contentClip.style.overflow  = 'visible';
    }
  }

  // Animate zoom back to 1× and restore normal overflow.
  _resetZoom() {
    if (this._zoomScale === 1) return;
    const { contentClip } = this.els;
    this._zoomScale    = 1;
    this._zoomTx       = 0;
    this._zoomTy       = 0;
    this._pinching     = false;
    this._zoomPanning  = false;
    if (!contentClip) return;
    // Animate the scale-out; overflow stays visible during transition so the
    // shrinking image isn't clipped at the clip boundary mid-animation.
    contentClip.style.transition = 'transform 200ms ease';
    contentClip.style.transform  = '';
    setTimeout(() => {
      contentClip.style.transition = '';
      contentClip.style.overflow   = '';
    }, 220);
  }

  // Keep the zoomed content from being panned so far that the viewport shows
  // empty space. Clamps so the content always covers the full clip dimensions.
  _clampZoomPan() {
    const { contentClip } = this.els;
    if (!contentClip) return;
    const W = contentClip.clientWidth;
    const H = contentClip.clientHeight;
    const s = this._zoomScale;
    this._zoomTx = Math.max(W * (1 - s), Math.min(0, this._zoomTx));
    this._zoomTy = Math.max(H * (1 - s), Math.min(0, this._zoomTy));
  }
}
