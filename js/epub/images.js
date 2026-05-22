export async function resolveImageUrls(imgEntries, book, blobUrls) {
  // Build a Map<basename, fullPath> from manifest for O(1) lookup (Phase 8a)
  let manifestPaths = [];
  try {
    const manifest = book.packaging && book.packaging.manifest;
    if (manifest) {
      Object.values(manifest).forEach(item => {
        if (item.href) manifestPaths.push(item.href);
      });
    }
  } catch (e) { console.warn("images:manifest", e); }
  try {
    const arc = book.archive;
    if (arc && arc.urlCache) {
      Object.keys(arc.urlCache).forEach(k => {
        if (manifestPaths.indexOf(k) < 0) manifestPaths.push(k);
      });
    }
  } catch (e) { console.warn("images:archive", e); }

  // Build basename map for O(1) lookup instead of O(n*m)
  const basenameMap = new Map();
  manifestPaths.forEach(p => {
    const base = p.split("/").pop().toLowerCase();
    if (!basenameMap.has(base)) basenameMap.set(base, p);
  });

  for (const entry of imgEntries) {
    try {
      let blob = null;
      const pathsToTry = [entry.resolvedSrc];
      const basename = entry.src.split("/").pop().toLowerCase();
      const mapped = basenameMap.get(basename);
      if (mapped && pathsToTry.indexOf(mapped) < 0) pathsToTry.push(mapped);

      for (const tryPath of pathsToTry) {
        if (blob && blob.size > 0) break;
        blob = await tryLoadBlob(book, tryPath);
      }
      if (blob && blob.size > 0) {
        const url = URL.createObjectURL(blob);
        blobUrls.push(url);
        entry.img.setAttribute("src", url);
      } else {
        console.warn("Image not found in archive:", entry.src, "tried:", pathsToTry);
        entry.img.removeAttribute("src");
      }
    } catch (err) {
      console.warn("Image resolve failed:", entry.src, err);
      entry.img.removeAttribute("src");
    }
  }
}

async function tryLoadBlob(book, path) {
  let blob = null;
  try {
    if (book.archive && typeof book.archive.getBlob === "function") {
      blob = await book.archive.getBlob(path);
    }
  } catch (_) {}
  if (!blob || !blob.size) {
    try {
      if (book.archive && typeof book.archive.request === "function") {
        const data = await book.archive.request(path, "blob");
        if (data instanceof Blob) blob = data;
      }
    } catch (_) {}
  }
  if (!blob || !blob.size) {
    try {
      if (typeof book.load === "function") {
        const data = await book.load(path);
        if (data instanceof Blob) blob = data;
      }
    } catch (_) {}
  }
  return blob;
}

export async function findCoverImage(book) {
  const tryBlob = async (path) => {
    const variants = [path];
    if (!path.startsWith("/")) variants.push("/" + path);
    else variants.push(path.slice(1));
    for (const p of variants) {
      try {
        if (book.archive && typeof book.archive.getBlob === "function") {
          const b = await book.archive.getBlob(p);
          if (b && b.size) return URL.createObjectURL(b);
        }
      } catch (_) {}
      try {
        if (book.archive && typeof book.archive.request === "function") {
          const b = await book.archive.request(p, "blob");
          if (b instanceof Blob && b.size) return URL.createObjectURL(b);
        }
      } catch (_) {}
    }
    return null;
  };
  // 1. EPUB3: manifest item with cover-image property
  try {
    const manifest = book.packaging && book.packaging.manifest;
    if (manifest) {
      for (const item of Object.values(manifest)) {
        if (item.properties && item.properties.indexOf("cover-image") >= 0 && item.href) {
          const url = await tryBlob(item.href);
          if (url) return url;
        }
      }
    }
  } catch (e) { console.warn("cover:epub3", e); }
  // 2. EPUB2: <meta name="cover" content="id"/>
  try {
    const meta = book.packaging && book.packaging.metadata;
    const manifest = book.packaging && book.packaging.manifest;
    if (meta && meta.cover && manifest && manifest[meta.cover]) {
      const url = await tryBlob(manifest[meta.cover].href);
      if (url) return url;
    }
  } catch (e) { console.warn("cover:epub2", e); }
  // 3. Manifest item keyed as "cover"
  try {
    const manifest = book.packaging && book.packaging.manifest;
    if (manifest && manifest.cover && manifest.cover.href) {
      const url = await tryBlob(manifest.cover.href);
      if (url) return url;
    }
  } catch (e) { console.warn("cover:manifest", e); }
  // 4. Filename fallback
  const names = ["cover.jpeg", "cover.jpg", "cover.png", "images/cover.jpeg", "images/cover.jpg", "images/cover.png", "OEBPS/cover.jpeg", "OEBPS/cover.jpg", "OEBPS/cover.png", "OEBPS/images/cover.jpeg", "OEBPS/images/cover.jpg", "OEBPS/images/cover.png"];
  for (const name of names) {
    const url = await tryBlob(name);
    if (url) return url;
  }
  return null;
}
