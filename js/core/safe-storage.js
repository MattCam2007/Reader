// Quota-aware localStorage writes.
//
// Every storage write used to swallow quota errors silently (`catch (_) {}`),
// so a full localStorage meant *positions silently stopped saving* — the least
// premium failure imaginable. safeSetItem keeps the graceful degradation but:
//   1. logs once per session instead of never, and
//   2. on quota error, prunes the least-recently-read `book:pos:*` entry
//      (positions carry a `la` last-accessed timestamp — see position.js) and
//      retries, so the book being read right now always wins over one last
//      opened months ago.
//
// Pruning is strictly by last-accessed time, never by key name: alphabetical
// pruning would evict books whose titles sort early, which is arbitrary wrong.

export const POS_KEY_PREFIX = 'book:pos:';

// How many prune-and-retry rounds to attempt before giving up. Each round
// frees one stored position.
const MAX_PRUNE_ROUNDS = 5;

let _quotaWarned = false;

export function safeSetItem(key, value) {
  for (let attempt = 0; ; attempt++) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      if (!_quotaWarned) {
        _quotaWarned = true;
        console.warn('storage: write failed (quota?) — pruning least-recently-read position', err);
      }
      if (attempt >= MAX_PRUNE_ROUNDS) return false;
      if (!pruneLeastRecentPosition(key)) return false;
    }
  }
}

// Remove the book:pos:* entry with the oldest last-accessed timestamp —
// never the key currently being written. Entries without a parseable `la`
// count as oldest (they predate the field). Returns true if one was removed.
export function pruneLeastRecentPosition(excludeKey) {
  let oldestKey = null;
  let oldestLa = Infinity;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(POS_KEY_PREFIX) || k === excludeKey) continue;
      let la = 0;
      try {
        const pos = JSON.parse(localStorage.getItem(k));
        if (pos && typeof pos.la === 'number') la = pos.la;
      } catch (_) { /* unparseable counts as oldest */ }
      if (la < oldestLa) { oldestLa = la; oldestKey = k; }
    }
    if (!oldestKey) return false;
    localStorage.removeItem(oldestKey);
    return true;
  } catch (_) {
    return false;
  }
}
