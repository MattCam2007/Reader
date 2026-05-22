export class FootnoteManager {
  constructor(state, els, goToPageFn) {
    this.state = state;
    this.els = els;
    this.goToPageFn = goToPageFn;
    this._active = null;
  }

  get activePopover() { return this._active; }

  handleContentClick(e) {
    const { content } = this.els;
    const anchor = e.target.closest("a[href]");
    if (!anchor || !content.contains(anchor)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.state._prefs.data.notePopovers) {
      const target = this._findTarget(anchor);
      if (target) this.goToPageFn(target);
      return;
    }
    if (this._isNoteRef(anchor)) {
      const target = this._findTarget(anchor);
      if (target) {
        this._show(anchor, target);
        return;
      }
    }
    const target = this._findTarget(anchor);
    if (target) this.goToPageFn(target);
  }

  dismiss() {
    if (!this._active) return;
    this._active.backdrop.remove();
    this._active.popover.remove();
    this._active = null;
  }

  _isNoteRef(anchor) {
    if (!anchor || anchor.tagName !== "A") return false;
    const href = anchor.getAttribute("href") || "";
    if (!href.startsWith("#") && !href.includes("#")) return false;
    const epubType = anchor.getAttribute("epub:type") || anchor.getAttribute("data-epub-type") || "";
    if (epubType.includes("noteref")) return true;
    return href.includes("#");
  }

  _findTarget(anchor) {
    const href = anchor.getAttribute("href") || "";
    const hashIdx = href.indexOf("#");
    if (hashIdx < 0) return null;
    const frag = href.slice(hashIdx + 1);
    if (!frag) return null;
    try {
      return this.els.content.querySelector("#" + CSS.escape(frag));
    } catch (e) {
      console.warn("footnote:findTarget", e);
      return null;
    }
  }

  _show(anchor, target) {
    this.dismiss();
    const text = (target.textContent || "").trim();
    if (!text) return;

    const rect = anchor.getBoundingClientRect();
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    const backdropEl = document.createElement("div");
    backdropEl.className = "note-popover-backdrop";
    backdropEl.addEventListener("click", () => this.dismiss());

    const pop = document.createElement("div");
    pop.className = "note-popover";
    pop.textContent = text;
    const closeBtn = document.createElement("button");
    closeBtn.className = "note-close";
    closeBtn.textContent = "Dismiss";
    closeBtn.type = "button";
    closeBtn.addEventListener("click", () => this.dismiss());
    pop.appendChild(closeBtn);

    document.body.appendChild(backdropEl);
    document.body.appendChild(pop);

    const popRect = pop.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = Math.max(8, rect.left - popRect.width / 2 + rect.width / 2);
    if (left + popRect.width > vpW - 8) left = vpW - popRect.width - 8;
    if (left < 8) left = 8;
    if (top + popRect.height > vpH - 8) top = rect.top - popRect.height - 8;
    if (top < 8) top = 8;

    pop.style.top = top + "px";
    pop.style.left = left + "px";

    this._active = { backdrop: backdropEl, popover: pop };
  }
}
