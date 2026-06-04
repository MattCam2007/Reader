export function flattenToc(nodes, depth, acc) {
  (nodes || []).forEach((n) => {
    acc.push({ label: (n.label || "").trim() || "Untitled", href: n.href || "", depth });
    if (n.subitems && n.subitems.length) flattenToc(n.subitems, depth + 1, acc);
  });
  return acc;
}

export function buildTOC(epubToc, headingToc, tocListEl, sectionEls, goToPageFn, closePanelsFn, resolveHrefFn) {
  const items = [];
  if (epubToc && epubToc.length) {
    epubToc.forEach((it) => items.push({ label: it.label, href: it.href, depth: it.depth }));
  } else if (headingToc.length > 1) {
    headingToc.forEach((h) => items.push({ label: h.label, el: h.el, depth: h.depth }));
  }
  tocListEl.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "reader-toc-empty";
    // TEMP diagnostic: surface why it's empty (epub nav count + heading count).
    empty.textContent = `No contents available. [nav=${epubToc ? epubToc.length : -1} h=${headingToc ? headingToc.length : -1}]`;
    tocListEl.appendChild(empty);
    return;
  }
  items.forEach((it) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-toc-item depth-" + Math.min(2, it.depth || 0);
    btn.textContent = it.label || "Untitled";
    btn.addEventListener("click", () => {
      const el = it.el || resolveHrefFn(it.href);
      if (el) goToPageFn(el);
      closePanelsFn();
    });
    tocListEl.appendChild(btn);
  });
}

export function resolveHref(href, content, sectionEls) {
  if (!href) return null;
  const parts = href.split("#");
  const frag = parts[1];
  if (frag) {
    try {
      const sel = "#" + CSS.escape(frag);
      // Attached content first (the common, fast path).
      const e = content.querySelector(sel);
      if (e) return e;
      // Windowed rendering detaches all but the current chapter, so the target
      // may live in a detached .chap subtree — search those too (querySelector
      // works on detached elements). sectionEls holds every chapter element.
      for (const sectionEl of sectionEls.values()) {
        if (sectionEl.isConnected) continue; // already covered by content query
        const d = sectionEl.querySelector(sel);
        if (d) return d;
      }
    } catch (e) { console.warn("toc:resolveHref", e); }
  }
  const base = parts[0].split("/").pop();
  return sectionEls.get(base) || null;
}
