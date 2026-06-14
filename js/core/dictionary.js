// Offline dictionary subsystem.
//
// Dictionaries are downloadable content, like books: the catalog lists what's
// available (data/dictionaries/catalog.json), the user downloads the ones they
// want, and from then on every lookup is served from IndexedDB with no network
// — fully offline and in-house. Source data is bundled same-origin under
// data/dictionaries/<id>/<bucket>.json.gz and built by tools/build-dictionaries.mjs.
//
// Each shard is a gzipped JSON map { "<lcword>": { w: display, s: [sense] } }
// where a sense is { p: partOfSpeech, d: definition, e?: example, y?: [synonym] }.
// Shards are bucketed by first letter ('0' holds non-alphabetic headwords).

const DATA_BASE = 'data/dictionaries';
const DB_NAME = 'reader-dictionaries';
const DB_VERSION = 1;
const STORE_SHARDS = 'shards';   // { key: '<dict>:<bucket>', map }
const STORE_META = 'meta';       // { key: 'installed:<dict>', dict, words, bytes, installedAt }

function bucketOf(lcword) {
  const c = lcword[0];
  return c >= 'a' && c <= 'z' ? c : '0';
}

// Decompress a gzipped ArrayBuffer to a parsed object via the platform's
// DecompressionStream (no JS gzip dependency needed).
async function gunzipJSON(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

export class DictionaryManager {
  constructor() {
    this._db = null;
    this._catalog = null;
    this._shardCache = new Map();   // in-memory LRU-ish: '<dict>:<bucket>' -> map
    this._installed = null;          // Set<dictId>, lazily loaded
  }

  // ---- IndexedDB plumbing ----
  _open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SHARDS)) db.createObjectStore(STORE_SHARDS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  }

  async _tx(store, mode, fn) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let out;
      Promise.resolve(fn(os)).then((v) => { out = v; }).catch(reject);
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  _req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- Catalog ----
  async catalog() {
    if (this._catalog) return this._catalog;
    const res = await fetch(`${DATA_BASE}/catalog.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    const data = await res.json();
    this._catalog = data.dictionaries || [];
    return this._catalog;
  }

  _catalogEntry(dict) {
    return (this._catalog || []).find((d) => d.id === dict);
  }

  // ---- Installed state ----
  async installed() {
    if (this._installed) return this._installed;
    const metas = await this._tx(STORE_META, 'readonly', (os) => this._req(os.getAll()));
    this._installed = new Set(
      metas.filter((m) => m.key.startsWith('installed:')).map((m) => m.dict)
    );
    return this._installed;
  }

  async isInstalled(dict) {
    return (await this.installed()).has(dict);
  }

  async meta(dict) {
    return this._tx(STORE_META, 'readonly', (os) => this._req(os.get(`installed:${dict}`)));
  }

  // ---- Download ----
  // onProgress({ dict, done, total, bytes, totalBytes }) is called as buckets land.
  async download(dict, onProgress) {
    await this.catalog();
    const entry = this._catalogEntry(dict);
    if (!entry) throw new Error(`unknown dictionary: ${dict}`);
    const buckets = Object.keys(entry.buckets || {});
    const totalBytes = entry.bytes || 0;
    let done = 0;
    let bytes = 0;

    for (const b of buckets) {
      const res = await fetch(`${DATA_BASE}/${dict}/${b}.json.gz`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${dict}/${b} ${res.status}`);
      const map = await gunzipJSON(await res.arrayBuffer());
      await this._tx(STORE_SHARDS, 'readwrite', (os) => os.put({ key: `${dict}:${b}`, map }));
      this._shardCache.set(`${dict}:${b}`, map);
      done++;
      bytes += entry.buckets[b] || 0;
      if (onProgress) onProgress({ dict, done, total: buckets.length, bytes, totalBytes });
    }

    await this._tx(STORE_META, 'readwrite', (os) => os.put({
      key: `installed:${dict}`, dict,
      words: entry.words, bytes: entry.bytes, installedAt: Date.now(),
    }));
    (await this.installed()).add(dict);
    return entry;
  }

  async downloadAll(onEachProgress) {
    const cat = await this.catalog();
    for (const d of cat) {
      if (!(await this.isInstalled(d.id))) await this.download(d.id, onEachProgress);
    }
  }

  // ---- Remove ----
  async remove(dict) {
    await this.catalog();
    const entry = this._catalogEntry(dict);
    const buckets = entry ? Object.keys(entry.buckets || {}) : 'abcdefghijklmnopqrstuvwxyz0'.split('');
    await this._tx(STORE_SHARDS, 'readwrite', (os) => {
      for (const b of buckets) { os.delete(`${dict}:${b}`); this._shardCache.delete(`${dict}:${b}`); }
    });
    await this._tx(STORE_META, 'readwrite', (os) => os.delete(`installed:${dict}`));
    (await this.installed()).delete(dict);
  }

  // ---- Lookup ----
  async _shard(dict, bucket) {
    const key = `${dict}:${bucket}`;
    if (this._shardCache.has(key)) return this._shardCache.get(key);
    const rec = await this._tx(STORE_SHARDS, 'readonly', (os) => this._req(os.get(key)));
    const map = rec ? rec.map : null;
    // Keep the cache small — drop the oldest entry past a soft cap.
    if (this._shardCache.size > 16) this._shardCache.delete(this._shardCache.keys().next().value);
    this._shardCache.set(key, map);
    return map;
  }

  // Normalise a raw selection to a candidate headword.
  static normalizeQuery(text) {
    return String(text || '')
      .trim()
      .split(/\s+/)[0]            // first word of a selection
      .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')  // strip surrounding punctuation
      .toLowerCase();
  }

  // Cheap morphological fallbacks so plurals / inflections resolve.
  static _candidates(word) {
    const out = [word];
    const add = (w) => { if (w && w !== word && !out.includes(w)) out.push(w); };
    if (word.endsWith('ies') && word.length > 4) add(word.slice(0, -3) + 'y');
    if (word.endsWith('es') && word.length > 3) add(word.slice(0, -2));
    if (word.endsWith('s') && word.length > 2) add(word.slice(0, -1));
    if (word.endsWith('ing') && word.length > 5) { add(word.slice(0, -3)); add(word.slice(0, -3) + 'e'); }
    if (word.endsWith('ed') && word.length > 4) { add(word.slice(0, -2)); add(word.slice(0, -1)); }
    return out;
  }

  // Returns [{ dict, name, word, senses }] across all installed dictionaries,
  // in catalog order. Empty array when nothing matches.
  async lookup(rawText) {
    const word = DictionaryManager.normalizeQuery(rawText);
    if (!word) return [];
    await this.catalog();
    const installed = await this.installed();
    const candidates = DictionaryManager._candidates(word);
    const results = [];
    for (const d of this._catalog) {
      if (!installed.has(d.id)) continue;
      const map = await this._shard(d.id, bucketOf(word));
      if (!map) continue;
      for (const cand of candidates) {
        // Object.hasOwn guards against inherited members ("constructor" etc.)
        // since shard maps are plain objects after JSON.parse.
        const hit = Object.hasOwn(map, cand) ? map[cand] : null;
        if (hit) { results.push({ dict: d.id, name: d.name, word: hit.w, senses: hit.s }); break; }
      }
    }
    return results;
  }
}

// Single shared instance for the app.
export const dictionaries = new DictionaryManager();
