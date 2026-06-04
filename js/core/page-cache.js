export const PAGE_KEY_PREFIX = 'book:pages:';

// Stored shape: { v: 1, sig: string, counts: number[] }
// counts[i] = exact page count for section i under the given layout signature.

export function loadPageCache(bookId) {
  if (!bookId) return null;
  try {
    const raw = localStorage.getItem(PAGE_KEY_PREFIX + bookId);
    const o = raw ? JSON.parse(raw) : null;
    return (o && o.v === 1 && typeof o.sig === 'string' && Array.isArray(o.counts)) ? o : null;
  } catch (_) { return null; }
}

export function savePageCache(bookId, sig, counts) {
  if (!bookId) return;
  try { localStorage.setItem(PAGE_KEY_PREFIX + bookId, JSON.stringify({ v: 1, sig, counts })); }
  catch (_) {}
}
