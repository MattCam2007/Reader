// Guard for the ?src= URL that all three app shells pass to fetch().
//
// Without validation, ?src= is an open fetch proxy: javascript:/data: URLs,
// credential-bearing URLs (http://user:pass@host — a phishing/SSRF helper), or
// any non-http scheme the browser happens to support. Books are only ever
// served over http(s) — same-origin library paths ("books/…") resolve against
// the page URL and pass naturally.
//
// Returns the resolved absolute URL string, or null when the value is unusable.
export function validateBookSrcUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  let url;
  try {
    url = new URL(s, typeof location !== 'undefined' ? location.href : undefined);
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}
