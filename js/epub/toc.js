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
    empty.textContent = "No contents available.";
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
      const e = content.querySelector("#" + CSS.escape(frag));
      if (e) return e;
    } catch (e) { console.warn("toc:resolveHref", e); }
  }
  const base = parts[0].split("/").pop();
  return sectionEls.get(base) || null;
}
