export class RsvpChapters {
  constructor(state, els) {
    this.state = state;
    this.els = els;
  }

  update() {
    const { state, els } = this;
    const nav = els.chapterNav;
    const sel = els.chSelect;
    if (!state.isEpubLoaded || !state.chapters.length) {
      if (nav) nav.hidden = true;
      return;
    }
    if (nav) nav.hidden = false;
    if (sel) {
      sel.innerHTML = "";
      state.chapters.forEach((ch, i) => {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = ch.title;
        sel.appendChild(opt);
      });
    }
  }

  currentIndex() {
    const pos = this.state.currentWordIdx(this.state.currentIdx);
    let ci = 0;
    for (let i = this.state.chapters.length - 1; i >= 0; i--) {
      if (this.state.chapters[i].tokenIdx <= pos) { ci = i; break; }
    }
    return ci;
  }
}
