import { RSVP } from './constants.js';
import { PARAGRAPH_BREAK, orpIndex, lastIndexAtMost } from './tokenizer.js';

export class RsvpDisplay {
  constructor(state, prefs, els) {
    this.state = state;
    this.prefs = prefs;
    this.els = els;
    this._lastSentenceIdx = -1;
    this._toastTimer = null;
  }

  render(token) {
    const { wordEl, beforeEl, orpEl, afterEl } = this.els;
    if (token === PARAGRAPH_BREAK) {
      wordEl.classList.add("break");
      wordEl.classList.remove("countdown");
      beforeEl.textContent = "";
      orpEl.textContent = "\u2014";
      afterEl.textContent = "";
      return;
    }
    wordEl.classList.remove("break", "countdown");
    const i = orpIndex(token);
    beforeEl.textContent = token.slice(0, i);
    orpEl.textContent = token.charAt(i);
    afterEl.textContent = token.slice(i + 1);
  }

  renderChunk(chunk, pivotPos) {
    const { wordEl, beforeEl, orpEl, afterEl } = this.els;
    if (chunk.length === 1 && chunk[0].token === PARAGRAPH_BREAK) {
      this.render(PARAGRAPH_BREAK);
      return;
    }
    wordEl.classList.remove("break", "countdown");
    const pivotToken = chunk[pivotPos].token;
    const oi = orpIndex(pivotToken);
    const wordsBefore = chunk.slice(0, pivotPos).map(c => c.token);
    const wordsAfter = chunk.slice(pivotPos + 1).map(c => c.token);
    const bPart = pivotToken.slice(0, oi);
    const oPart = pivotToken.charAt(oi);
    const aPart = pivotToken.slice(oi + 1);
    beforeEl.textContent = wordsBefore.length ? wordsBefore.join(" ") + " " + bPart : bPart;
    orpEl.textContent = oPart;
    afterEl.textContent = wordsAfter.length ? aPart + " " + wordsAfter.join(" ") : aPart;
  }

  renderCountdown(num) {
    const { wordEl, beforeEl, orpEl, afterEl } = this.els;
    wordEl.classList.remove("break");
    wordEl.classList.add("countdown");
    beforeEl.textContent = "";
    orpEl.textContent = String(num);
    afterEl.textContent = "";
  }

  renderWordAt(idx) {
    const token = this.state.tokens[idx];
    if (token !== undefined) this.render(token);
    this.updateContext(idx);
  }

  updateContext(tokenIdx) {
    const { state } = this;
    const contextEl = this.els.contextLine;
    if (!this.prefs.data.contextEnabled || !contextEl) {
      if (contextEl) contextEl.textContent = "";
      return;
    }
    if (tokenIdx < 0 || tokenIdx >= state.tokens.length || state.tokens[tokenIdx] === PARAGRAPH_BREAK) {
      contextEl.textContent = "";
      this._lastSentenceIdx = -1;
      return;
    }
    const si = lastIndexAtMost(state.sentenceStarts, state.currentWordIdx(tokenIdx));
    if (si !== this._lastSentenceIdx) {
      this._lastSentenceIdx = si;
      const start = state.sentenceStarts[si];
      const end = si + 1 < state.sentenceStarts.length ? state.sentenceStarts[si + 1] : state.tokens.length;
      const frag = document.createDocumentFragment();
      for (let i = start; i < end; i++) {
        if (state.tokens[i] === PARAGRAPH_BREAK) continue;
        const el = document.createElement(i === tokenIdx ? 'b' : 'span');
        el.dataset.i = i;
        el.textContent = state.tokens[i];
        frag.appendChild(el);
        frag.appendChild(document.createTextNode(' '));
      }
      contextEl.replaceChildren(frag);
    } else {
      const prevBold = contextEl.querySelector("b");
      if (prevBold) {
        const span = document.createElement("span");
        span.dataset.i = prevBold.dataset.i;
        span.textContent = prevBold.textContent;
        prevBold.replaceWith(span);
      }
      const target = contextEl.querySelector('[data-i="' + tokenIdx + '"]');
      if (target) {
        const b = document.createElement("b");
        b.dataset.i = target.dataset.i;
        b.textContent = target.textContent;
        target.replaceWith(b);
      }
    }
  }

  updateSeek() {
    const { state, prefs } = this;
    const { seekSlider, seekReadout, stepPrevBtn, stepNextBtn, playLabel } = this.els;
    const total = state.totalWords;
    const wOrd = state.wordOrdinalAt(state.currentIdx);
    const frac = total > 1 ? wOrd / (total - 1) : 0;
    const pi = state.getParagraphIndex(state.currentIdx);

    const wordsLeft = Math.max(0, total - wOrd - 1);
    const etaSec = Math.max(0, Math.round(wordsLeft * 60 / prefs.data.wpm));
    let etaStr;
    if (etaSec >= 3600) {
      const h = Math.floor(etaSec / 3600);
      const m = Math.floor((etaSec % 3600) / 60);
      etaStr = "~" + h + "h " + m + "m left";
    } else if (etaSec >= 60) {
      const m = Math.floor(etaSec / 60);
      const s = etaSec % 60;
      etaStr = "~" + m + "m " + s + "s left";
    } else {
      etaStr = "~" + etaSec + "s left";
    }

    if (seekReadout) {
      seekReadout.textContent =
        "word " + (total ? wOrd + 1 : 0).toLocaleString() + " / " + total.toLocaleString() +
        "   \u00b7   \u00b6 " + (pi + 1) + " / " + state.paragraphs.length +
        "   \u00b7   " + Math.round(frac * 100) + "%" +
        "   \u00b7   " + etaStr;
    }

    if (seekSlider) {
      seekSlider.style.setProperty("--progress", (frac * 100).toFixed(1) + "%");
      const granularity = prefs.data.granularity || 'word';
      const uList = this._unitList(granularity);
      const uMax = Math.max(0, uList.length - 1);
      if (+seekSlider.max !== uMax) seekSlider.max = uMax;
      if (!state.sliderDragging) seekSlider.value = this._unitIndexAt(state.currentIdx, granularity);
      seekSlider.setAttribute("aria-valuetext",
        "word " + (wOrd + 1) + " of " + total + ", " + Math.round(frac * 100) + "% complete");
    }

    if (stepPrevBtn) stepPrevBtn.disabled = wOrd <= 0;
    if (stepNextBtn) stepNextBtn.disabled = wOrd >= total - 1;
    if (playLabel) {
      playLabel.textContent = (state.playState === 'playing' || state.playState === 'countdown') ? "Pause" : "Play";
    }

  }

  showToast(msg) {
    const el = this.els.wpmToast;
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.classList.remove("show"); this._toastTimer = null; }, RSVP.TOAST_DURATION_MS);
  }

  _unitList(granularity) {
    if (granularity === "sentence") return this.state.sentenceStarts;
    if (granularity === "paragraph") return this.state.paragraphStarts;
    return this.state.wordTokenIndices;
  }

  _unitIndexAt(idx, granularity) {
    const list = this._unitList(granularity);
    if (!list.length) return 0;
    return lastIndexAtMost(list, this.state.currentWordIdx(idx));
  }

  resetSentenceCache() {
    this._lastSentenceIdx = -1;
  }
}
