// FormatAdapter for CBZ (Comic Book ZIP). Each image in the archive becomes one
// page-section in the canonical IR. JSZip (loaded globally for EPUB) is reused
// here — no extra library download needed for CBZ.

import { makeCapabilities } from '../capabilities.js';
import { startsWith, ZIP_MAGIC } from '../detect.js';
import { registerAdapter } from '../registry.js';
import { isImageFile, buildComicIR } from './comic-utils.js';
import { checkArchiveEntry, isUnsafeArchivePath } from '../../core/archive-guard.js';

export const cbzAdapter = {
  id: 'cbz',
  label: 'CBZ',
  extensions: ['.cbz'],
  mimeTypes: ['application/vnd.comicbook+zip', 'application/x-cbz'],
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

  // CBZ is a ZIP; disambiguate from EPUB by extension/MIME.
  detect(bytes, fileName, mimeType) {
    const isZip = startsWith(bytes, ZIP_MAGIC);
    const byName = fileName.endsWith('.cbz');
    const byMime = mimeType === 'application/vnd.comicbook+zip'
                || mimeType === 'application/x-cbz';
    return (isZip && (byName || byMime)) || byName;
  },

  async loadLibs() {
    if (typeof globalThis.JSZip !== 'function') {
      throw new Error('JSZip library not loaded. Check your connection.');
    }
  },

  async parse(buffer, fileName, opts = {}) {
    const { onProgress } = opts;
    await this.loadLibs();

    const zip = await new globalThis.JSZip().loadAsync(buffer);
    const entries = [];
    const totals = { bytes: 0 };

    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir || !isImageFile(path)) continue;
      // Skip names that escape the archive root; cap per-entry and total
      // decompressed size so a zip bomb errors gracefully instead of
      // exhausting the tab's memory (see core/archive-guard.js).
      if (isUnsafeArchivePath(path)) continue;
      const bytes = await file.async('uint8array');
      checkArchiveEntry(path, bytes.length, totals);
      // Use basename only so natural sort ignores directory prefixes.
      const name = path.split('/').pop().split('\\').pop();
      entries.push({ name, bytes });
    }

    return buildComicIR(entries, fileName, onProgress);
  },
};

registerAdapter(cbzAdapter);
