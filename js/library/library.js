// Library bookshelf. Extracted from the former library.html monolith into the
// module system (Phase 7). Theme + meta-color come from the shared app shell;
// reading progress reads the canonical book:pos:{bookId} key.

import { SAMPLE } from './data.js';
import { applyTheme } from '../base-reader-app.js';
import { POS_KEY_PREFIX } from '../core/position.js';


// ---------- Sample library (used until data/library.json exists) ----------
// Mirrors the shape scan.js will emit. cover:null => generated placeholder.

// ---------- DOM ----------
const scroll      = document.getElementById("scroll");
const crumbsEl    = document.getElementById("crumbs");
const searchBtn   = document.getElementById("searchBtn");
const themeBtn    = document.getElementById("themeBtn");
const searchRow   = document.getElementById("searchRow");
const searchInput = document.getElementById("searchInput");
const backdrop    = document.getElementById("backdrop");
const sheet       = document.getElementById("sheet");

// ---------- State ----------
let LIB = SAMPLE.items;
let path = [];        // current folder path, e.g. ["Fiction","Jane Austen"]
let query = "";
const THEMES = ["dark", "sepia", "light"];
let theme = "dark";

// ---------- Helpers ----------
function hueOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function genCoverStyle(seed) {
  const h = hueOf(seed);
  return `background:linear-gradient(150deg, hsl(${h} 45% 38%), hsl(${(h + 38) % 360} 50% 24%));`;
}
function progressOf(item) {
  try {
    const raw = localStorage.getItem(POS_KEY_PREFIX + item.id);
    if (raw) { const f = JSON.parse(raw).f; if (typeof f === "number") return f; }
  } catch (_) {}
  return typeof item.progress === "number" ? item.progress : 0;
}
function startsWith(folders, prefix) {
  if (folders.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (folders[i] !== prefix[i]) return false;
  return true;
}
function booksUnder(prefix) { return LIB.filter((b) => startsWith(b.folders, prefix)); }
function booksAt(prefix) {
  return LIB.filter((b) => b.folders.length === prefix.length && startsWith(b.folders, prefix));
}
function subfoldersAt(prefix) {
  const names = new Set();
  LIB.forEach((b) => { if (b.folders.length > prefix.length && startsWith(b.folders, prefix)) names.add(b.folders[prefix.length]); });
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ---------- Element builders ----------
function coverEl(item, showProgress) {
  const wrap = document.createElement("div");
  wrap.className = "cover";
  if (item.cover) {
    const img = document.createElement("img");
    img.src = item.cover; img.alt = ""; img.loading = "lazy";
    wrap.appendChild(img);
  } else {
    const g = document.createElement("div");
    g.className = "cover-gen";
    g.setAttribute("style", genCoverStyle(item.title + item.author));
    g.innerHTML = `<div class="cg-title">${esc(item.title)}</div><div class="cg-author">${esc(item.author || "")}</div>`;
    wrap.appendChild(g);
  }
  if (showProgress) {
    const f = progressOf(item);
    if (f > 0.001 && f < 0.999) {
      const t = document.createElement("div"); t.className = "progress-track";
      const fl = document.createElement("div"); fl.className = "progress-fill";
      fl.style.width = Math.round(f * 100) + "%";
      t.appendChild(fl); wrap.appendChild(t);
    }
  }
  return wrap;
}

function bookCard(item, showProgress) {
  const c = document.createElement("button");
  c.className = "card";
  c.appendChild(coverEl(item, showProgress));
  const t = document.createElement("div"); t.className = "card-title"; t.textContent = item.title;
  const a = document.createElement("div"); a.className = "card-author"; a.textContent = item.author || "";
  c.appendChild(t); c.appendChild(a);
  c.addEventListener("click", () => openSheet(item));
  return c;
}

function folderTile(name, prefix) {
  const full = prefix.concat(name);
  const inside = booksUnder(full);
  const c = document.createElement("button");
  c.className = "card folder";
  const art = document.createElement("div"); art.className = "folder-art";
  inside.slice(0, 4).forEach((b) => {
    const tile = document.createElement("div"); tile.className = "tile";
    if (b.cover) {
      const img = document.createElement("img"); img.src = b.cover; img.alt = ""; img.loading = "lazy";
      tile.appendChild(img);
    } else {
      const mini = document.createElement("div"); mini.className = "mini";
      mini.setAttribute("style", genCoverStyle(b.title + b.author));
      tile.appendChild(mini);
    }
    art.appendChild(tile);
  });
  for (let i = inside.length; i < 4; i++) {
    const tile = document.createElement("div"); tile.className = "tile"; art.appendChild(tile);
  }
  const tag = document.createElement("div"); tag.className = "folder-tag";
  tag.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const badge = document.createElement("div"); badge.className = "folder-badge";
  badge.textContent = inside.length + (inside.length === 1 ? " book" : " books");
  art.appendChild(tag); art.appendChild(badge);
  c.appendChild(art);
  const t = document.createElement("div"); t.className = "card-title"; t.textContent = name;
  c.appendChild(t);
  c.addEventListener("click", () => { path = full; query = ""; body().classList.remove("searching"); render(); scroll.scrollTop = 0; });
  return c;
}

function section(title, count) {
  const s = document.createElement("section"); s.className = "section";
  const h = document.createElement("div"); h.className = "section-head";
  const ti = document.createElement("div"); ti.className = "section-title"; ti.textContent = title;
  h.appendChild(ti);
  if (count != null) { const c = document.createElement("div"); c.className = "section-count"; c.textContent = count; h.appendChild(c); }
  s.appendChild(h);
  return s;
}

function railOf(items, showProgress) {
  const r = document.createElement("div"); r.className = "rail";
  items.forEach((it) => r.appendChild(bookCard(it, showProgress)));
  return r;
}
function gridEl() { const g = document.createElement("div"); g.className = "grid"; return g; }

// ---------- Render ----------
function render() {
  renderCrumbs();
  scroll.innerHTML = "";

  if (query) { renderSearch(); return; }

  const subs = subfoldersAt(path);
  const here = booksAt(path);

  if (path.length === 0) {
    const cont = LIB.filter((b) => { const f = progressOf(b); return f > 0.001 && f < 0.999; })
                    .sort((a, b) => progressOf(b) - progressOf(a));
    if (cont.length) {
      const s = section("Continue reading");
      s.appendChild(railOf(cont, true));
      scroll.appendChild(s);
    }
    const recent = [...LIB].sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || "")).slice(0, 10);
    const sr = section("Recently added");
    sr.appendChild(railOf(recent, true));
    scroll.appendChild(sr);
  }

  if (subs.length || here.length) {
    const s = section(path.length === 0 ? "Browse" : "In this shelf", (subs.length + here.length) + " items");
    const g = gridEl();
    subs.forEach((name) => g.appendChild(folderTile(name, path)));
    here.forEach((b) => g.appendChild(bookCard(b, true)));
    s.appendChild(g);
    scroll.appendChild(s);
  } else if (path.length > 0) {
    const e = document.createElement("div"); e.className = "empty"; e.textContent = "This shelf is empty.";
    scroll.appendChild(e);
  }
}

function renderSearch() {
  const q = query.toLowerCase();
  const hits = LIB.filter((b) =>
    (b.title || "").toLowerCase().includes(q) ||
    (b.author || "").toLowerCase().includes(q) ||
    (b.tags || []).some((t) => t.toLowerCase().includes(q)) ||
    (b.folders || []).some((f) => f.toLowerCase().includes(q)));
  const s = section("Results", hits.length + (hits.length === 1 ? " match" : " matches"));
  if (!hits.length) {
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = "No books match “" + query + "”.";
    scroll.appendChild(e); return;
  }
  const g = gridEl();
  hits.forEach((b) => g.appendChild(bookCard(b, true)));
  s.appendChild(g);
  scroll.appendChild(s);
}

function renderCrumbs() {
  crumbsEl.innerHTML = "";
  const root = document.createElement("button");
  root.className = "crumb" + (path.length ? " parent" : "");
  root.textContent = "Library";
  root.addEventListener("click", () => { path = []; clearSearch(); render(); });
  crumbsEl.appendChild(root);
  path.forEach((name, i) => {
    const sep = document.createElement("span"); sep.className = "crumb-sep"; sep.textContent = "›";
    crumbsEl.appendChild(sep);
    const b = document.createElement("button");
    const last = i === path.length - 1;
    b.className = "crumb" + (last ? "" : " parent");
    b.textContent = name;
    b.addEventListener("click", () => { path = path.slice(0, i + 1); clearSearch(); render(); });
    crumbsEl.appendChild(b);
  });
}

// ---------- Detail sheet ----------
function openSheet(item) {
  const f = progressOf(item);
  const pct = Math.round(f * 100);
  const stars = item.rating
    ? `<div class="stars">${"★".repeat(item.rating)}<span class="off">${"★".repeat(5 - item.rating)}</span></div>` : "";
  const tags = (item.tags && item.tags.length)
    ? `<div class="tags">${item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : "";
  const series = item.series ? `<div class="sheet-sub">${esc(item.series)}${item.seriesIndex ? " · Book " + item.seriesIndex : ""}</div>` : "";
  const where = (item.folders && item.folders.length)
    ? `<div class="sheet-path">In: ${item.folders.map(esc).join(" › ")}</div>` : "";
  const prog = (f > 0.001 && f < 0.999) ? `<div class="sheet-progress">${pct}% read</div>` : "";

  const coverInner = item.cover
    ? `<img src="${esc(item.cover)}" alt="">`
    : `<div class="cover-gen" style="${genCoverStyle(item.title + item.author)}"><div class="cg-title">${esc(item.title)}</div><div class="cg-author">${esc(item.author || "")}</div></div>`;

  const params = "?src=" + encodeURIComponent(item.path) + "&id=" + encodeURIComponent(item.id) + "&title=" + encodeURIComponent(item.title);

  sheet.innerHTML =
    `<div class="sheet-top">
       <div class="sheet-cover">${coverInner}</div>
       <div class="sheet-meta">
         <div class="sheet-title">${esc(item.title)}</div>
         <div class="sheet-author">${esc(item.author || "Unknown author")}</div>
         ${series}${stars}${tags}
       </div>
     </div>
     ${item.description ? `<p class="sheet-desc">${esc(item.description)}</p>` : ""}
     ${where}${prog}
     <div class="sheet-actions">
       <a class="btn primary" href="reader.html${params}">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7v15H4zM13 5h7v15h-7z"/></svg>
         ${f > 0.001 ? "Continue" : "Read"}
       </a>
       <a class="btn" href="index.html${params}">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
         Speed Read
       </a>
     </div>`;
  body().classList.add("show-sheet");
}
function closeSheet() { body().classList.remove("show-sheet"); }

// ---------- Search toggle ----------
function clearSearch() { query = ""; searchInput.value = ""; body().classList.remove("searching"); }
searchBtn.addEventListener("click", () => {
  const on = body().classList.toggle("searching");
  if (on) { searchInput.focus(); } else { clearSearch(); render(); }
});
searchInput.addEventListener("input", () => { query = searchInput.value.trim(); render(); });

// ---------- Theme ----------
function applyThemeLib() {
  applyTheme(theme); // shared: body class + browser-chrome meta color
  try { localStorage.setItem("library:theme", theme); } catch (_) {}
}
themeBtn.addEventListener("click", () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  applyThemeLib();
});

// ---------- Misc wiring ----------
backdrop.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (body().classList.contains("show-sheet")) closeSheet();
    else if (body().classList.contains("searching")) { clearSearch(); render(); }
    else if (path.length) { path = path.slice(0, -1); render(); }
  }
});

function body() { return document.body; }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- Init: load real manifest if present, else sample ----------
try { theme = localStorage.getItem("library:theme") || "dark"; } catch (_) {}
applyThemeLib();

fetch("data/library.json", { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => { if (data && Array.isArray(data.items) && data.items.length) LIB = data.items; })
  .catch(() => {})
  .finally(render);
