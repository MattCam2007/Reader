// Decompression guards for archive formats (CBZ/CBR). Archives inflate fully
// client-side, so without caps a zip bomb (or a hostile RAR) can exhaust the
// tab's memory; entry names can also smuggle path traversal. These limits turn
// both into a graceful "file too large" error instead.

export const MAX_ARCHIVE_ENTRY_BYTES = 50 * 1024 * 1024;   // 50 MB per entry
export const MAX_ARCHIVE_TOTAL_BYTES = 500 * 1024 * 1024;  // 500 MB uncompressed
export const ARCHIVE_EXTRACT_TIMEOUT_MS = 60_000;

// An entry name that escapes the archive root via a `..` path segment.
export function isUnsafeArchivePath(name) {
  return /(^|[\\/])\.\.([\\/]|$)/.test(name || '');
}

// Account one decompressed entry against the per-entry and running-total caps.
// `totals` is a caller-owned accumulator: { bytes: 0 }. Throws a user-facing
// Error when a cap is exceeded — adapters surface err.message directly.
export function checkArchiveEntry(name, size, totals) {
  if (size > MAX_ARCHIVE_ENTRY_BYTES) {
    throw new Error(
      'This file is too large to open: "' + name + '" decompresses to over ' +
      Math.round(MAX_ARCHIVE_ENTRY_BYTES / 1024 / 1024) + ' MB.');
  }
  totals.bytes += size;
  if (totals.bytes > MAX_ARCHIVE_TOTAL_BYTES) {
    throw new Error(
      'This file is too large to open: its contents decompress to over ' +
      Math.round(MAX_ARCHIVE_TOTAL_BYTES / 1024 / 1024) + ' MB.');
  }
}

// Race a promise against a timeout. Used around CBR's WebAssembly extraction,
// which otherwise can spin indefinitely on a hostile archive.
export function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
