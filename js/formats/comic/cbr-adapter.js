// FormatAdapter for CBR (Comic Book RAR). Each image in the archive becomes one
// page-section in the canonical IR. libarchive.js (WebAssembly) is lazy-loaded
// the first time a CBR is opened — readers who only open EPUB/PDF/CBZ never
// download it.

import { makeCapabilities } from '../capabilities.js';
import { startsWith } from '../detect.js';
import { registerAdapter } from '../registry.js';
import { isImageFile, buildComicIR } from './comic-utils.js';
import {
  checkArchiveEntry, isUnsafeArchivePath, withTimeout, ARCHIVE_EXTRACT_TIMEOUT_MS,
} from '../../core/archive-guard.js';

// npm package: "libarchive.js" (with a dot). Both dist files are ES modules.
const LIB_VERSION    = '2.0.2';
const LIB_BASE       = `https://cdn.jsdelivr.net/npm/libarchive.js@${LIB_VERSION}/dist`;
const LIB_JS_URL     = `${LIB_BASE}/libarchive.js`;
const LIB_WORKER_URL = `${LIB_BASE}/worker-bundle.js`;

// RAR magic: first 6 bytes common to RAR 1.5-4.x and RAR 5.x.
const RAR_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];

export const cbrAdapter = {
  id: 'cbr',
  label: 'CBR',
  extensions: ['.cbr'],
  mimeTypes: ['application/vnd.comicbook-rar', 'application/x-cbr'],
  priority: 5,

  capabilities: makeCapabilities({
    reflow: false,
    richText: false,
    textStream: false,
    images: true,
    toc: false,
    search: false,
    pageFidelity: true,
  }),

  detect(bytes, fileName, mimeType) {
    const isRar = startsWith(bytes, RAR_MAGIC);
    const byName = fileName.endsWith('.cbr');
    const byMime = mimeType === 'application/vnd.comicbook-rar'
                || mimeType === 'application/x-cbr';
    // Require CBR intent (extension or MIME) when RAR magic alone isn't enough,
    // to avoid claiming generic RAR archives.
    return (isRar && (byName || byMime)) || byName || byMime;
  },

  // Lazy-load libarchive.js (WebAssembly). Cache the Archive class on globalThis
  // so repeat opens do not re-import.
  //
  // Worker shim: cross-origin *module* workers frequently fail to construct
  // (same restriction pdf.js hits). We create a same-origin blob that does a
  // single `import` of the CDN worker URL. The shim is same-origin so the
  // Worker constructor succeeds; the actual worker code still runs from the CDN
  // module, preserving its import.meta.url so relative WASM paths resolve correctly.
  async loadLibs() {
    if (globalThis._cbrArchive) return;
    let mod;
    try {
      mod = await import(/* @vite-ignore */ LIB_JS_URL);
    } catch (e) {
      throw new Error('CBR library failed to load. Check your connection.');
    }
    const Archive = mod.Archive || mod.default;
    if (!Archive) throw new Error('CBR library loaded but Archive class not found.');

    const shimCode = `import '${LIB_WORKER_URL}';`;
    const workerUrl = URL.createObjectURL(
      new Blob([shimCode], { type: 'application/javascript' })
    );
    Archive.init({ workerUrl });
    globalThis._cbrArchive = Archive;
  },

  async parse(buffer, fileName, opts = {}) {
    const { onProgress } = opts;
    await this.loadLibs();
    const Archive = globalThis._cbrArchive;

    let archive;
    try {
      archive = await Archive.open(new File([buffer], fileName));
    } catch (e) {
      throw new Error('Could not open CBR file: ' + (e.message || e));
    }

    let extracted;
    try {
      // The WASM extractor can spin indefinitely on a hostile archive — bound it.
      extracted = await withTimeout(
        archive.extractFiles(),
        ARCHIVE_EXTRACT_TIMEOUT_MS,
        'This CBR took too long to extract — it may be corrupt.');
    } catch (e) {
      throw new Error('Failed to extract CBR archive: ' + (e.message || e));
    }

    // Flatten the directory tree returned by extractFiles() into a list of
    // { name, bytes } objects.  Leaf values with an arrayBuffer() method are
    // File-like objects; plain objects are subdirectories to recurse into.
    // Names with `..` segments are skipped; sizes are checked against the
    // per-entry/total caps BEFORE the bytes are read (File-like leaves carry
    // .size) so a decompression bomb errors out gracefully.
    const entries = [];
    const totals = { bytes: 0 };
    function flatten(obj) {
      if (!obj || typeof obj !== 'object') return;
      for (const [name, value] of Object.entries(obj)) {
        if (value && typeof value.arrayBuffer === 'function') {
          if (!isImageFile(name) || isUnsafeArchivePath(name)) continue;
          checkArchiveEntry(name, value.size || 0, totals);
          entries.push({ name, _file: value });
        } else if (value && typeof value === 'object') {
          flatten(value);
        }
      }
    }
    flatten(extracted);

    const imageEntries = await Promise.all(
      entries.map(async ({ name, _file }) => ({
        name,
        bytes: new Uint8Array(await _file.arrayBuffer()),
      }))
    );

    return buildComicIR(imageEntries, fileName, onProgress);
  },
};

registerAdapter(cbrAdapter);
