// Resolve `..` and `.` segments in an archive path.
function normalizePath(path) {
  const out = [];
  for (const p of path.split('/')) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

// Load an image from the EPUB archive as a Blob, trying several path variants
// and return types (epubjs 0.3.x exposes archive.request; book.load returns
// text/binary-string, not Blob, so we handle all cases).
async function tryLoadBlob(book, path) {
  // Normalize the path and produce slash variants epubjs may need.
  const norm = normalizePath(path);
  const noLeading = norm.replace(/^\//, '');
  const withLeading = '/' + noLeading;

  const paths = [...new Set([path, norm, noLeading, withLeading])];

  for (const p of paths) {
    if (!p) continue;
    // Primary: archive.request(path, "blob") — JSZip returns a real Blob.
    try {
      if (book.archive && typeof book.archive.request === 'function') {
        const data = await book.archive.request(p, 'blob');
        if (data instanceof Blob && data.size > 0) return data;
      }
    } catch (_) {}
    // Fallback: archive.request with arraybuffer, convert to Blob.
    try {
      if (book.archive && typeof book.archive.request === 'function') {
        const data = await book.archive.request(p, 'arraybuffer');
        if (data instanceof ArrayBuffer && data.byteLength > 0) return new Blob([data]);
      }
    } catch (_) {}
  }

  // Last resort: book.load — may return string, ArrayBuffer, or Blob.
  try {
    if (typeof book.load === 'function') {
      const data = await book.load(noLeading);
      if (data instanceof Blob && data.size > 0) return data;
      if (data instanceof ArrayBuffer && data.byteLength > 0) return new Blob([data]);
      if (typeof data === 'string' && data.length > 0) {
        // Binary string (epubjs "binary" request type) → Uint8Array → Blob.
        const bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
        return new Blob([bytes]);
      }
    }
  } catch (_) {}

  return null;
}

// Resolve image src attributes in imgEntries to blob URLs.
// Returns the array of created blob URLs (caller tracks them for cleanup).
// Call this BEFORE renderBook so the img elements have their src set when
// inserted into the DOM, but do NOT add the returned URLs to state.blobUrls
// until AFTER renderBook has revoked the previous book's blob URLs.
export async function resolveImageUrls(imgEntries, book) {
  const createdUrls = [];

  // Build a Map<basename, fullPath> from manifest for O(1) lookup.
  let manifestPaths = [];
  try {
    const manifest = book.packaging && book.packaging.manifest;
    if (manifest) {
      Object.values(manifest).forEach(item => {
        if (item.href) manifestPaths.push(item.href);
      });
    }
  } catch (e) { console.warn('images:manifest', e); }
  try {
    const arc = book.archive;
    if (arc && arc.urlCache) {
      Object.keys(arc.urlCache).forEach(k => {
        if (manifestPaths.indexOf(k) < 0) manifestPaths.push(k);
      });
    }
  } catch (e) {}

  const basenameMap = new Map();
  manifestPaths.forEach(p => {
    const base = p.split('/').pop().toLowerCase();
    if (!basenameMap.has(base)) basenameMap.set(base, p);
  });

  for (const entry of imgEntries) {
    try {
      const pathsToTry = [normalizePath(entry.resolvedSrc)];
      const basename = entry.src.split('/').pop().toLowerCase();
      const mapped = basenameMap.get(basename);
      if (mapped && pathsToTry.indexOf(mapped) < 0) pathsToTry.push(mapped);

      let blob = null;
      for (const p of pathsToTry) {
        if (blob && blob.size > 0) break;
        blob = await tryLoadBlob(book, p);
      }
      if (blob && blob.size > 0) {
        const url = URL.createObjectURL(blob);
        createdUrls.push(url);
        entry.img.setAttribute('src', url);
      } else {
        console.warn('Image not found in archive:', entry.src, 'tried:', pathsToTry);
        entry.img.removeAttribute('src');
      }
    } catch (err) {
      console.warn('Image resolve failed:', entry.src, err);
      entry.img.removeAttribute('src');
    }
  }

  return createdUrls;
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
