import { COLUMN_GAP } from '../core/constants.js';
import { columnLayout } from './pagination.js';
import { loadPageCache, savePageCache } from '../core/page-cache.js';

function scheduleIdle(fn) {
  if (typeof requestIdleCallback === 'function') return { id: requestIdleCallback(fn), type: 'ric' };
  return { id: setTimeout(() => fn({ timeRemaining: () => 50 }), 1), type: 'timeout' };
}
function cancelIdle(h) {
  if (!h) return;
  if (h.type === 'ric' && typeof cancelIdleCallback === 'function') cancelIdleCallback(h.id);
  else clearTimeout(h.id);
}

export class PageCounter {
  constructor(state, els, prefs) {
    this.state = state;
    this.els = els;
    this.prefs = prefs;
    this._host = null;   // { viewport, clip, content }
    this._idle = null;   // scheduleIdle handle
    this._onUpdate = null;
    this._gen = 0;       // incremented on each begin() to invalidate in-flight callbacks
  }

  // ---- Signature ----

  computeSignature() {
    const { els, prefs } = this;
    const box = els.content.getBoundingClientRect();
    const vpBox = els.viewport.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(vpBox.height);
    const p = prefs.data;
    const cols = (p.columns === "2" || (p.columns === "auto" && w > 700)) ? 2 : 1;
    return [w, h, p.font, p.size, p.weight, p.lineHeight, p.margin, p.paraSpacing, p.align, p.hyphens, p.images, cols].join('|');
  }

  // ---- Lifecycle ----

  // Call once windowed mode is set up and the first paginateWindow has run.
  // Adopts cache if the layout signature matches; otherwise schedules the idle pass.
  begin(onUpdate) {
    // Cancel any in-flight idle pass and tear down the offscreen host before
    // resetting state. Without this, a second begin() call (e.g. from a
    // double-rAF after mode switch) leaves the old step closure running
    // concurrently, fighting over this._idle and writing stale counts.
    cancelIdle(this._idle);
    this._idle = null;
    this._removeHost();
    this._gen++;         // invalidate any _measureChapter promises still in-flight
    this._onUpdate = onUpdate;
    const sig = this.computeSignature();
    this.state.pageCountSig = sig;
    const n = this.state.doc.sections.length;
    this.state.pageCounts = new Array(n).fill(undefined);
    this.state.pageCountsComplete = false;

    this.recordCurrent();

    const cached = loadPageCache(this.state.bookId);
    if (cached && cached.sig === sig && cached.counts.length === n) {
      this.state.pageCounts = cached.counts.slice();
      this.state.pageCountsComplete = true;
      if (this._onUpdate) this._onUpdate();
      return;
    }
    this._schedulePass();
  }

  // Capture the live chapter's exact page count. Free — just reads state.total.
  // Call from updateWindowedProgress on every turn/layout.
  recordCurrent() {
    const i = this.state.curChap;
    const counts = this.state.pageCounts;
    if (counts && this.state.total > 0 && counts[i] !== this.state.total) {
      counts[i] = this.state.total;
      this._maybeComplete();
    }
  }

  // Cancel any in-flight pass, clear counts, and restart with the current layout.
  invalidate(onUpdate) {
    cancelIdle(this._idle);
    this._idle = null;
    this._removeHost();
    this.begin(onUpdate || this._onUpdate);
  }

  // Cancel pass and remove offscreen host. Call on teardown or windowed→scroll switch.
  destroy() {
    cancelIdle(this._idle);
    this._idle = null;
    this._removeHost();
  }

  // ---- Overall page math (no layout; safe on the hot path) ----

  // Returns { page, total, approx }.
  // Unknown chapters use a self-calibrating words/page estimate from measured chapters.
  overall(curChap, pageInChap) {
    const counts = this.state.pageCounts || [];
    const secs = this.state.doc.sections;

    let measuredPages = 0, measuredWords = 0;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] != null) {
        measuredPages += counts[i];
        measuredWords += (secs[i].wsEnd - secs[i].wsStart);
      }
    }
    const wpp = measuredWords > 0 ? measuredWords / measuredPages : 300;
    const est = (i) => Math.max(1, Math.round((secs[i].wsEnd - secs[i].wsStart) / wpp));
    const pages = (i) => (counts[i] != null ? counts[i] : est(i));

    let before = 0;
    for (let i = 0; i < curChap; i++) before += pages(i);
    let total = 0;
    for (let i = 0; i < counts.length; i++) total += pages(i);

    const page = before + pageInChap + 1;  // pageInChap is 0-based
    const approx = !this.state.pageCountsComplete;
    return { page, total, approx };
  }

  // ---- Offscreen measuring host ----

  _buildHost() {
    const { els } = this;
    const vp = els.viewport.cloneNode(false);
    const clip = els.contentClip.cloneNode(false);
    const content = els.content.cloneNode(false);
    const vpRect = els.viewport.getBoundingClientRect();
    vp.style.cssText += ';position:absolute;left:-99999px;top:0;visibility:hidden;contain:strict;';
    vp.style.width = vpRect.width + 'px';
    vp.style.height = vpRect.height + 'px';
    content.id = '';
    content.style.setProperty('--page-offset', '0px');
    clip.appendChild(content);
    vp.appendChild(clip);
    document.body.appendChild(vp);
    this._host = { viewport: vp, clip, content };
  }

  _removeHost() {
    if (this._host) {
      if (this._host.viewport.parentNode) this._host.viewport.parentNode.removeChild(this._host.viewport);
      this._host = null;
    }
  }

  // ---- Image decode guard ----

  async _awaitImages(el) {
    if (!this.prefs.data.images) return;
    const imgs = Array.from(el.querySelectorAll('img')).filter(im => !im.complete);
    if (!imgs.length) return;
    await Promise.race([
      Promise.all(imgs.map(im => new Promise(res => {
        im.addEventListener('load', res, { once: true });
        im.addEventListener('error', res, { once: true });
      }))),
      new Promise(res => setTimeout(res, 500)),
    ]);
  }

  // ---- Measure one chapter in the offscreen host ----

  async _measureChapter(i) {
    if (i === this.state.curChap) return this.state.total;
    const w = this.state.chapWindows[i];
    if (!w || !w.el) return undefined;
    const host = this._host.content;
    host.appendChild(w.el);
    try {
      const vpW = host.getBoundingClientRect().width;
      const { cols, stride } = columnLayout(vpW, this.prefs.data);
      host.style.columnCount = cols === 2 ? '2' : '';
      host.style.columnWidth = cols === 2 ? '' : vpW + 'px';
      host.style.columnGap = COLUMN_GAP + 'px';
      await this._awaitImages(w.el);
      void host.offsetWidth;
      return Math.max(1, Math.round(host.scrollWidth / stride));
    } finally {
      if (w.el.parentNode === host) host.removeChild(w.el);
    }
  }

  // ---- Idle measuring pass ----

  _schedulePass() {
    const n = this.state.pageCounts.length;
    // chapWindows must cover every section. If setupWindow() was called a second
    // time while chapters were already detached (double-init race), it produces a
    // 1-entry array and every chapter beyond the first returns undefined forever.
    // Bail out here rather than silently leaving pageCounts full of undefined.
    if (this.state.chapWindows.length < n) {
      console.warn('page-counter: chapWindows has', this.state.chapWindows.length,
        'entries but doc has', n, 'sections — skipping pass');
      return;
    }

    if (!this._host) this._buildHost();

    // Measure chapters before curChap first (makes current page exact sooner),
    // then chapters after curChap.
    const order = [];
    for (let i = 0; i < this.state.curChap; i++) order.push(i);
    for (let i = this.state.curChap + 1; i < n; i++) order.push(i);

    let orderIdx = 0;
    const gen = this._gen;

    const step = (deadline) => {
      this._idle = null;
      if (gen !== this._gen) return;
      if (this.state.pageCountsComplete) return;

      // Advance past already-measured chapters
      while (orderIdx < order.length && this.state.pageCounts[order[orderIdx]] != null) orderIdx++;
      if (orderIdx >= order.length) { this._maybeComplete(); return; }

      // Defer if the browser needs the time
      if (deadline.timeRemaining() < 5) {
        this._idle = scheduleIdle(step);
        return;
      }

      const i = order[orderIdx++];
      this._measureChapter(i).then(count => {
        if (gen !== this._gen) return;
        if (count !== undefined) {
          this.state.pageCounts[i] = count;
          this._maybeComplete();
          if (this._onUpdate) this._onUpdate();
        }
        if (!this.state.pageCountsComplete && this._idle === null) {
          this._idle = scheduleIdle(step);
        }
      }).catch(() => {
        if (gen !== this._gen) return;
        if (!this.state.pageCountsComplete && this._idle === null) {
          this._idle = scheduleIdle(step);
        }
      });
    };

    this._idle = scheduleIdle(step);
  }

  _maybeComplete() {
    if (this.state.pageCountsComplete) return;
    if (!this.state.pageCounts) return;
    if (this.state.pageCounts.some(c => c == null)) return;
    this.state.pageCountsComplete = true;
    savePageCache(this.state.bookId, this.state.pageCountSig, this.state.pageCounts.slice());
    this._removeHost();
  }
}
