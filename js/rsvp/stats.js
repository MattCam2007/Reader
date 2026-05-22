export class StatsTracker {
  constructor(els) {
    this.els = els;
    this.sessionWords = 0;
    this.sessionPlayMs = 0;
    this.sessionPlayStart = null;
    this._interval = null;
  }

  onPlayStart() {
    if (!this.sessionPlayStart) this.sessionPlayStart = Date.now();
    if (!this._interval) this._interval = setInterval(() => this.update(), 1000);
  }

  onPlayStop() {
    if (this.sessionPlayStart) {
      this.sessionPlayMs += Date.now() - this.sessionPlayStart;
      this.sessionPlayStart = null;
    }
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this.update();
  }

  addWords(count) {
    this.sessionWords += count;
  }

  reset(isPlaying) {
    this.sessionWords = 0;
    this.sessionPlayMs = 0;
    this.sessionPlayStart = isPlaying ? Date.now() : null;
    this.update();
  }

  update() {
    const totalMs = this.sessionPlayMs + (this.sessionPlayStart ? Date.now() - this.sessionPlayStart : 0);
    const totalSec = Math.floor(totalMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (this.els.statWords) this.els.statWords.textContent = this.sessionWords.toLocaleString() + " words";
    if (this.els.statTime) this.els.statTime.textContent = m + ":" + String(s).padStart(2, "0");
    if (this.els.statAvg) {
      this.els.statAvg.textContent = totalMs > 2000
        ? Math.round(this.sessionWords / totalMs * 60000) + " avg wpm"
        : "\u2014 avg wpm";
    }
  }

  destroy() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }
}
