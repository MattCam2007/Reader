// Low-level byte-detection helpers. No adapter knowledge here — adapters declare
// their own detect() functions and use these utilities.

// Read the first n bytes of an ArrayBuffer as a Uint8Array (safe for small files).
export function magicBytes(buffer, n = 64) {
  return new Uint8Array(buffer.slice(0, Math.min(n, buffer.byteLength)));
}

// Return true if `bytes` begins with the given byte-value signature array.
export function startsWith(bytes, sig) {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

// ZIP container magic: 'PK\x03\x04'
// EPUB, some MOBI/AZW, and ODT are all ZIP-based — adapters must disambiguate
// by combining ZIP_MAGIC with extension or MIME type.
export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
