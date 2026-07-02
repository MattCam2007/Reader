// Smart-home webhook bridge.
//
// Pushes reading events (book/chapter/page start+finish, playback, theme, …)
// as rich JSON payloads to a user-configured webhook URL — designed for Home
// Assistant's `/api/webhook/<id>` endpoint but usable by anything that accepts
// an HTTP POST. The full event catalog, payload schema, Home Assistant recipes
// and the "adding a new event" developer flow live in docs/SMART-HOME.md.
//
// Design notes:
//   - One module-level singleton (`smarthome`). Mode apps import it and call
//     the thin notify methods (bookOpened / positionTick / pageTurned / …);
//     everything else — gating, throttling, payload enrichment, chapter and
//     milestone derivation, queueing, retry — happens in here, so a mode
//     never pays more than a method call on its hot paths.
//   - Events are derived from POSITION, not from mode internals. Each mode
//     already computes a canonical position (js/core/position.js) on its
//     debounced save path; positionTick() piggybacks on that, and chapter
//     start/finish, progress milestones and book.finished all fall out of
//     comparing consecutive positions against the book's chapter word table.
//   - Delivery is fire-and-forget with retry. Failures must never affect
//     reading; everything is wrapped and the queue is bounded.
//   - Two delivery formats (see docs/SMART-HOME.md → "Delivery formats"):
//       'json'  POST application/json — Home Assistant exposes the body as
//               `trigger.json`. Cross-origin, this needs the reader's origin
//               in HA's `http: cors_allowed_origins` (the browser preflights).
//       'form'  POST application/x-www-form-urlencoded — a CORS "simple
//               request" (no preflight, sent no-cors), works with a stock HA
//               config; HA exposes fields as `trigger.data`, with the nested
//               sections JSON-stringified per field.

import { PrefsManager } from './prefs.js';
import { safeSetItem } from './safe-storage.js';

export const SMARTHOME_PREFS_KEY = 'smarthome:prefs';
const BOOK_STATE_PREFIX = 'smarthome:book:'; // per-book latches (finished, milestone)
const OUTBOX_KEY = 'smarthome:outbox';        // undelivered events, restored next launch

// Progress milestones (percent). Each fires once per book (persisted latch).
const MILESTONES = [10, 25, 50, 75, 90];
// A book counts as finished at this fraction; re-armed if the reader drops
// back below MILESTONE_REARM (e.g. they restart the book).
const FINISH_FRACTION = 0.995;
const REARM_FRACTION = 0.9;
// A chapter counts as "completed" (vs merely left) when this fraction of it
// was reached before moving on.
const CHAPTER_COMPLETE_FRACTION = 0.98;
// Words-read heuristic for Reader/TTS: a forward ordinal jump bigger than this
// is a seek (TOC, bookmark, scrubber), not reading, and isn't counted.
const READ_DELTA_MAX = 600;
// Fallback words-per-minute for time-remaining estimates when the session has
// not yet read enough to compute a real rate.
const DEFAULT_WPM = 230;
const MIN_RATED_WORDS = 200;   // session must have read this much…
const MIN_RATED_SECS = 60;     // …over this long before its own rate is used
const QUEUE_MAX = 100;
const RETRY_DELAYS_MS = [0, 2000, 8000];

// ── Event catalog ────────────────────────────────────────────────────────────
// THE registry of every event the app can emit. The Smart Home settings tab
// renders its toggles from this list, payloads carry these ids, and
// docs/SMART-HOME.md documents them one-to-one. To add a new event:
//   1. Add an entry here (id, group, label, description, enabled default).
//   2. Call `smarthome.emit('<id>', { …event data… })` from the app code that
//      observes the moment (or add a notify method here if derivation/state
//      is involved).
//   3. Document the event and its `data` fields in docs/SMART-HOME.md.
//   4. Extend the smarthome selftest block if the event involves derivation.
// Labels/descriptions are looked up via i18n keys `sh.ev.<id>` /
// `sh.evd.<id>` with these strings as the English source (see js/i18n/en.js).
export const EVENT_CATALOG = [
  { id: 'session.start',      group: 'session',  enabled: true,
    label: 'Session started',   description: 'A reading session began (first book of this app launch)' },
  { id: 'session.end',        group: 'session',  enabled: true,
    label: 'Session ended',     description: 'The app was closed or hidden — carries full session stats' },
  { id: 'book.opened',        group: 'book',     enabled: true,
    label: 'Book opened',       description: 'A book was loaded (fresh open or resume)' },
  { id: 'book.started',       group: 'book',     enabled: true,
    label: 'Book started',      description: 'A book was opened at (or near) the very beginning' },
  { id: 'book.finished',      group: 'book',     enabled: true,
    label: 'Book finished',     description: 'Reading reached the end of the book (once per book)' },
  { id: 'progress.milestone', group: 'book',     enabled: true,
    label: 'Progress milestone', description: 'Crossed 10 / 25 / 50 / 75 / 90% of the book (once each)' },
  { id: 'chapter.started',    group: 'chapter',  enabled: true,
    label: 'Chapter started',   description: 'Reading position entered a new chapter' },
  { id: 'chapter.finished',   group: 'chapter',  enabled: true,
    label: 'Chapter finished',  description: 'Left a chapter — flags whether it was read to the end' },
  { id: 'page.turned',        group: 'chapter',  enabled: true,
    label: 'Page turned',       description: 'A page turn in the paginated reader (throttle below)' },
  { id: 'playback.started',   group: 'playback', enabled: true,
    label: 'Playback started',  description: 'RSVP speed-reading or TTS narration started playing' },
  { id: 'playback.paused',    group: 'playback', enabled: true,
    label: 'Playback paused',   description: 'RSVP or TTS playback paused/stopped — carries play stats' },
  { id: 'mode.switched',      group: 'app',      enabled: true,
    label: 'Mode switched',     description: 'Switched between Read / Speed / Listen modes' },
  { id: 'theme.changed',      group: 'app',      enabled: true,
    label: 'Theme changed',     description: 'The app theme changed (dark, sepia, OLED, …)' },
  { id: 'bookmark.added',     group: 'app',      enabled: true,
    label: 'Bookmark added',    description: 'A bookmark was placed' },
];

export const EVENT_GROUPS = [
  { id: 'session',  label: 'Session' },
  { id: 'book',     label: 'Book' },
  { id: 'chapter',  label: 'Chapters & pages' },
  { id: 'playback', label: 'Playback' },
  { id: 'app',      label: 'App' },
];

function defaultEventToggles() {
  const out = {};
  for (const ev of EVENT_CATALOG) out[ev.id] = ev.enabled;
  return out;
}

export const SMARTHOME_DEFAULTS = {
  v: 1,
  enabled: false,
  url: '',
  format: 'json',          // 'json' | 'form' — see delivery notes above
  includeDevice: true,     // device block in payloads (UA, screen, …)
  includeSettings: true,   // full prefs snapshot in payloads
  pageTurnThrottleSec: 0,  // min seconds between page.turned events (0 = every turn)
  events: defaultEventToggles(),
};

// Accept only http(s) URLs — anything else (javascript:, file:, …) is refused
// at save time and at send time.
export function validWebhookUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch (_) { return ''; }
}

// ── Client ───────────────────────────────────────────────────────────────────
// All state and logic in a class so the selftest can construct an isolated
// instance with an injected transport + clock; the app uses the singleton.
export class SmartHomeClient {
  constructor({ send, now, storage } = {}) {
    // Injection points (tests): transport, clock, latch storage.
    this._send = send || null;
    this._now = now || (() => Date.now());
    this._storage = storage || null;

    this.prefs = new PrefsManager({ storageKey: SMARTHOME_PREFS_KEY, defaults: SMARTHOME_DEFAULTS });
    this.prefs.load();
    // Merge newly-added catalog events into a stored toggle map from an older
    // version, so new events show up (with their defaults) after an update.
    this.prefs.data.events = Object.assign(defaultEventToggles(), this.prefs.data.events || {});

    this._seq = 0;
    this._mode = 'read';
    this._book = null;        // { id, title, fileName, format, isSample, totalWords, chapters[] }
    this._pos = null;         // last posLite { ord, words, f, page, pageTotal }
    this._page = null;        // { page, total } (paginated reader only)
    this._lastPageTurnMs = 0;
    this._lastTheme = null;   // baseline set on first apply; only changes emit
    this._sessionStarted = false;
    this._session = this._newSession();

    this._queue = [];
    this._draining = false;
    this._restoreOutbox();
  }

  _newSession() {
    return {
      startedAt: this._now(),
      pagesTurned: 0,
      wordsRead: 0,
      chaptersCompleted: 0,
      booksOpened: 0,
      bookmarksAdded: 0,
      modesUsed: [],
    };
  }

  // ── Config ────────────────────────────────────────────────────────────────
  getConfig() { return this.prefs.data; }

  setConfig(key, value) {
    if (key === 'url') value = String(value || '').trim();
    this.prefs.data[key] = value;
    this.prefs.save();
  }

  setEventEnabled(id, on) {
    this.prefs.data.events = Object.assign({}, this.prefs.data.events, { [id]: !!on });
    this.prefs.save();
  }

  isActive() {
    return !!(this.prefs.data.enabled && validWebhookUrl(this.prefs.data.url));
  }

  eventEnabled(id) {
    const ev = this.prefs.data.events || {};
    return ev[id] !== false;
  }

  // ── Notify methods (called from app code) ────────────────────────────────
  setMode(mode) {
    this._mode = mode || 'read';
    const s = this._session;
    if (!s.modesUsed.includes(this._mode)) s.modesUsed.push(this._mode);
  }

  modeSwitched(from, to) {
    this.setMode(to);
    this.emit('mode.switched', { from, to });
  }

  themeChanged(theme) {
    // First application per launch is the baseline (booting isn't a change);
    // re-applying the same theme (mode switches re-init) is not a change.
    if (this._lastTheme === null) { this._lastTheme = theme; return; }
    if (theme === this._lastTheme) return;
    const previous = this._lastTheme;
    this._lastTheme = theme;
    this.emit('theme.changed', { theme, previous });
  }

  // `chapters`: [{ href, label, wordStart, wordCount }] in reading order, in
  // the SAME word units as positions this mode reports (whitespace words).
  bookOpened({ bookId, title, fileName, format, isSample, totalWords, chapters, position }) {
    // A mode switch re-opens the same book in the new mode — context refresh
    // only, not a new "opened" moment.
    const sameBook = this._book && this._book.id === bookId;
    this._book = {
      id: bookId || '',
      title: title || bookId || '',
      fileName: fileName || '',
      format: format || '',
      isSample: !!isSample,
      totalWords: totalWords || 0,
      chapters: Array.isArray(chapters) ? chapters : [],
    };
    this._page = null;
    const pos = this._normalizePos(position);
    if (pos) this._pos = pos; else if (!sameBook) this._pos = null;
    if (sameBook) return;

    this._session.booksOpened++;
    if (!this._sessionStarted) {
      this._sessionStarted = true;
      this.emit('session.start', {});
    }
    const f = pos ? pos.f : 0;
    this.emit('book.opened', { resumed: f > 0.02, resumedAtPercent: Math.round(f * 1000) / 10 });
    if (f <= 0.02) this.emit('book.started', {});
    const ch = this._chapterAt(pos ? pos.ord : 0);
    if (ch) {
      this.emit('chapter.started', {
        chapter: this._chapterData(ch, pos ? pos.ord : 0), resumed: f > 0.02,
      });
    }
  }

  // posLite: { ord, words, f } (+ optional { page, pageTotal }). Called from
  // each mode's (already debounced) position-save path — this is the engine
  // that derives chapter transitions, milestones and book.finished.
  positionTick(posLite) {
    const pos = this._normalizePos(posLite);
    if (!pos || !this._book) return;
    // Reading resumed after a session.end (tab was hidden/restored): a fresh
    // session was already opened by sessionEnd(); announce it.
    if (!this._sessionStarted && this._session.booksOpened === 0) {
      this._sessionStarted = true;
      this._session.booksOpened = 1;
      this.emit('session.start', { resumed: true });
    }
    const prev = this._pos;
    this._pos = pos;
    if (!prev) return;

    const delta = pos.ord - prev.ord;
    if (delta > 0 && delta <= READ_DELTA_MAX) this._session.wordsRead += delta;

    // Chapter transition?
    const prevCh = this._chapterAt(prev.ord);
    const ch = this._chapterAt(pos.ord);
    if (prevCh && ch && prevCh !== ch) {
      const intoPrev = prev.ord - prevCh.wordStart;
      const completed = prevCh.wordCount > 0
        && (intoPrev / prevCh.wordCount) >= CHAPTER_COMPLETE_FRACTION
        // Any forward move out of a chapter you were at the end of counts;
        // jumping backwards never "completes" the chapter you left.
        && pos.ord > prev.ord;
      if (completed) this._session.chaptersCompleted++;
      this.emit('chapter.finished', { chapter: this._chapterData(prevCh, prev.ord), completed });
      this.emit('chapter.started', { chapter: this._chapterData(ch, pos.ord), resumed: false });
    }

    // Milestones + finished (persisted per-book latches).
    const st = this._bookState();
    const pct = pos.f * 100;
    let milestone = 0;
    for (const m of MILESTONES) {
      if (pct >= m && (st.milestone || 0) < m) milestone = m;
    }
    if (milestone) {
      st.milestone = milestone;
      this._saveBookState(st);
      this.emit('progress.milestone', { milestone });
    }
    if (pos.f >= FINISH_FRACTION && !st.finished) {
      st.finished = true;
      this._saveBookState(st);
      this.emit('book.finished', {});
    } else if (st.finished && pos.f < REARM_FRACTION) {
      st.finished = false;         // restarted the book — re-arm the latch
      st.milestone = Math.min(st.milestone || 0, Math.floor(pos.f * 100));
      this._saveBookState(st);
    }
  }

  // Cheap page-turn notification (paginated reader only). Dedupes repeats of
  // the same page and honours the configured throttle. `info` may carry a
  // chapter label so the event is useful even before the debounced position
  // save has refreshed the word-accurate context.
  pageTurned({ page, total, chapterLabel }) {
    const prev = this._page;
    this._page = { page, total };
    // Same page (even if the page COUNT changed — a relayout renumbers pages
    // without the reader turning anything) is not a turn.
    if (prev && prev.page === page) return;
    if (!prev) return; // first sighting after load is a landing, not a turn
    this._session.pagesTurned++;
    const throttleMs = (this.prefs.data.pageTurnThrottleSec || 0) * 1000;
    const now = this._now();
    if (throttleMs && now - this._lastPageTurnMs < throttleMs) return;
    this._lastPageTurnMs = now;
    this.emit('page.turned', {
      page: page + 1, pageCount: total,
      direction: page > prev.page ? 'forward' : 'back',
      chapterLabel: chapterLabel || '',
    });
  }

  playbackStarted(data) { this.emit('playback.started', data || {}); }
  playbackStopped(data) { this.emit('playback.paused', data || {}); }

  bookmarkAdded(item) {
    this._session.bookmarksAdded++;
    this.emit('bookmark.added', {
      chapterLabel: (item && item.chapterLabel) || '',
      text: (item && item.text) || '',
      percent: item && typeof item.fraction === 'number' ? Math.round(item.fraction * 1000) / 10 : null,
      color: (item && item.color) || '',
    });
  }

  // session.end fires from pagehide (and hidden-tab) via beacon-capable flush.
  sessionEnd() {
    if (!this._sessionStarted) return;
    this._sessionStarted = false; // re-arms if the tab comes back and reads on
    this.emit('session.end', {});
    const s = this._session;
    this._session = this._newSession();
    // Keep cumulative context sensible if the tab resumes: new session starts
    // fresh but the book/position context is retained.
    this._session.modesUsed = s.modesUsed.slice(-1);
  }

  // ── Generic emit ──────────────────────────────────────────────────────────
  emit(type, data, { force } = {}) {
    try {
      if (!force && (!this.isActive() || !this.eventEnabled(type))) return;
      this._queue.push(this._envelope(type, data));
      if (this._queue.length > QUEUE_MAX) this._queue.splice(0, this._queue.length - QUEUE_MAX);
      this._drain();
    } catch (e) { console.warn('smarthome:emit', e); }
  }

  // Test button: bypasses enabled/toggle gating (but not URL validation) and
  // reports delivery back to the caller.
  async sendTest() {
    const url = validWebhookUrl(this.prefs.data.url);
    if (!url) return { ok: false, detail: 'invalid-url' };
    const payload = this._envelope('test.ping', { hello: 'from Reader' });
    try {
      const res = await this._transport(url, payload, { beacon: false });
      if (res && res.opaque) return { ok: true, detail: 'opaque' };
      if (res && res.ok) return { ok: true, detail: 'http-' + res.status };
      return { ok: false, detail: res ? 'http-' + res.status : 'no-response' };
    } catch (e) {
      return { ok: false, detail: (e && e.message) || 'network-error' };
    }
  }

  // Flush synchronously-ish on page hide: try to hand every queued event to a
  // beacon (form mode) or keepalive fetch (json mode); persist whatever could
  // not be handed off so the next launch retries it.
  flush({ beacon = false } = {}) {
    try {
      while (this._queue.length) {
        const payload = this._queue.shift();
        const url = validWebhookUrl(this.prefs.data.url);
        if (!url) break;
        const handed = beacon ? this._beacon(url, payload) : false;
        if (!handed) {
          this._transport(url, payload, { beacon }).catch(() => this._stash(payload));
        }
      }
      this._persistOutbox();
    } catch (e) { console.warn('smarthome:flush', e); }
  }

  // ── Payload assembly ──────────────────────────────────────────────────────
  _normalizePos(p) {
    if (!p || typeof p !== 'object') return null;
    const words = Math.max(1, Math.trunc(p.words) || (this._book ? this._book.totalWords : 0) || 1);
    let ord = Math.trunc(p.ord);
    if (!Number.isFinite(ord)) {
      ord = typeof p.f === 'number' ? Math.round(p.f * (words - 1)) : 0;
    }
    ord = Math.max(0, Math.min(ord, words - 1));
    const f = typeof p.f === 'number' ? Math.max(0, Math.min(1, p.f))
      : (words > 1 ? ord / (words - 1) : 0);
    return { ord, words, f };
  }

  _chapterAt(ord) {
    const chs = this._book && this._book.chapters;
    if (!chs || !chs.length) return null;
    let chosen = null;
    for (const c of chs) {
      if (!c || c.wordCount <= 0) continue;
      if (c.wordStart <= ord) chosen = c; else break;
    }
    return chosen || chs[0];
  }

  _chapterData(ch, ord) {
    if (!ch) return null;
    const chs = this._book ? this._book.chapters : [];
    const index = chs.indexOf(ch);
    const into = Math.max(0, ord - ch.wordStart);
    return {
      index,
      count: chs.length,
      label: ch.label || '',
      href: ch.href || '',
      wordCount: ch.wordCount,
      wordsInto: into,
      percent: ch.wordCount > 0 ? Math.round((into / ch.wordCount) * 1000) / 10 : 0,
    };
  }

  _sessionWpm() {
    const s = this._session;
    const secs = Math.max(1, (this._now() - s.startedAt) / 1000);
    if (s.wordsRead >= MIN_RATED_WORDS && secs >= MIN_RATED_SECS) {
      return Math.round(s.wordsRead / (secs / 60));
    }
    return 0;
  }

  _readPrefsSnapshot(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return {};
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') { delete data.v; return data; }
    } catch (_) {}
    return {};
  }

  _envelope(type, data) {
    const now = this._now();
    const cfg = this.prefs.data;
    const s = this._session;
    const pos = this._pos;
    const book = this._book;

    const payload = {
      event: type,
      ts: new Date(now).toISOString(),
      epochMs: now,
      seq: this._seq++,
      app: {
        name: 'Reader',
        mode: this._mode,
        language: (typeof navigator !== 'undefined' && navigator.language) || '',
        standalone: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(display-mode: standalone)').matches : false,
      },
      session: {
        startedAt: new Date(s.startedAt).toISOString(),
        durationSec: Math.round((now - s.startedAt) / 1000),
        pagesTurned: s.pagesTurned,
        wordsRead: s.wordsRead,
        chaptersCompleted: s.chaptersCompleted,
        booksOpened: s.booksOpened,
        bookmarksAdded: s.bookmarksAdded,
        modesUsed: s.modesUsed.slice(),
        avgWpm: this._sessionWpm() || null,
      },
      data: data || {},
    };

    if (cfg.includeDevice && typeof navigator !== 'undefined') {
      payload.device = {
        userAgent: navigator.userAgent || '',
        platform: navigator.platform || '',
        online: navigator.onLine !== false,
        touch: 'ontouchstart' in (typeof window !== 'undefined' ? window : {}),
        screenWidth: (typeof screen !== 'undefined' && screen.width) || 0,
        screenHeight: (typeof screen !== 'undefined' && screen.height) || 0,
        pixelRatio: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      };
    }

    if (cfg.includeSettings) {
      payload.settings = {
        general: this._readPrefsSnapshot('general:prefs'),
        reader: this._readPrefsSnapshot('reader:prefs'),
        rsvp: this._readPrefsSnapshot('rsvp:prefs'),
        tts: this._readPrefsSnapshot('tts:prefs'),
      };
      payload.settings.theme = payload.settings.general.theme || 'dark';
    }

    if (book) {
      payload.book = {
        id: book.id,
        title: book.title,
        fileName: book.fileName,
        format: book.format,
        isSample: book.isSample,
        totalWords: book.totalWords,
        chapterCount: book.chapters.length,
      };
    }

    if (pos && book) {
      const wordsRemaining = Math.max(0, pos.words - 1 - pos.ord);
      const wpm = this._sessionWpm() || DEFAULT_WPM;
      const ch = this._chapterAt(pos.ord);
      payload.position = {
        wordOrdinal: pos.ord,
        totalWords: pos.words,
        fraction: Math.round(pos.f * 10000) / 10000,
        percent: Math.round(pos.f * 1000) / 10,
        wordsRemaining,
        minutesRemaining: Math.round(wordsRemaining / wpm),
        chapter: this._chapterData(ch, pos.ord),
        page: this._page ? { number: this._page.page + 1, count: this._page.total } : null,
      };
    }

    return payload;
  }

  // ── Per-book latches ──────────────────────────────────────────────────────
  _bookStateKey() { return BOOK_STATE_PREFIX + (this._book ? this._book.id : ''); }

  _bookState() {
    if (this._storage) return this._storage.state || (this._storage.state = {});
    try {
      const raw = localStorage.getItem(this._bookStateKey());
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (_) { return {}; }
  }

  _saveBookState(st) {
    if (this._storage) { this._storage.state = st; return; }
    try { safeSetItem(this._bookStateKey(), JSON.stringify(st)); } catch (_) {}
  }

  // ── Delivery ──────────────────────────────────────────────────────────────
  async _drain() {
    if (this._draining) return;
    this._draining = true;
    try {
      while (this._queue.length) {
        const payload = this._queue[0];
        const url = validWebhookUrl(this.prefs.data.url);
        if (!url) { this._queue.length = 0; break; }
        let delivered = false;
        for (const delay of RETRY_DELAYS_MS) {
          if (delay) await new Promise(r => setTimeout(r, delay));
          try {
            const res = await this._transport(url, payload, {});
            // no-cors form posts return opaque responses — assume delivered.
            if (!res || res.ok || res.opaque || res.type === 'opaque') { delivered = true; break; }
            // A definitive HTTP error (4xx) will not improve on retry.
            if (res.status >= 400 && res.status < 500) { delivered = true; break; }
          } catch (_) { /* network error — retry */ }
        }
        this._queue.shift();
        if (!delivered) this._stash(payload);
      }
    } finally {
      this._draining = false;
      this._persistOutbox();
    }
  }

  _transport(url, payload, { beacon }) {
    if (this._send) return Promise.resolve(this._send(url, payload));
    if (typeof fetch !== 'function') return Promise.resolve(null);
    if (this.prefs.data.format === 'form') {
      // Simple request: no preflight, works against a stock Home Assistant.
      // The response is opaque (no-cors), so delivery is fire-and-forget.
      return fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        body: this._formBody(payload),
        keepalive: !!beacon,
      }).then(res => ({ ok: true, opaque: true, status: res.status || 0 }));
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: !!beacon,
    }).then(res => ({ ok: res.ok, status: res.status }));
  }

  // Flatten the envelope for form delivery: scalar top-level fields stay
  // plain, nested sections become JSON strings — in HA:
  //   {{ trigger.data.event }}                       → "page.turned"
  //   {{ (trigger.data.position | from_json).percent }}
  _formBody(payload) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      params.set(k, (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v));
    }
    return params;
  }

  _beacon(url, payload) {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    try {
      // Form body is a CORS-simple type, so the beacon needs no preflight.
      // In json mode a Blob('application/json') beacon would preflight (and
      // fail against a stock HA), so json mode falls back to keepalive fetch.
      if (this.prefs.data.format !== 'form') return false;
      return navigator.sendBeacon(url, this._formBody(payload));
    } catch (_) { return false; }
  }

  // ── Outbox persistence (survives app close with undelivered events) ──────
  _stash(payload) { this._outbox().push(payload); }

  _outbox() {
    if (!this.__outbox) this.__outbox = [];
    return this.__outbox;
  }

  _persistOutbox() {
    if (this._storage) return;
    try {
      // Only failed deliveries are persisted; the live queue still belongs to
      // _drain (persisting it too would redeliver duplicates next launch).
      const box = this._outbox().slice(-QUEUE_MAX);
      if (box.length) safeSetItem(OUTBOX_KEY, JSON.stringify(box));
      else localStorage.removeItem(OUTBOX_KEY);
      this.__outbox = [];
    } catch (_) {}
  }

  _restoreOutbox() {
    if (this._storage) return;
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      if (!raw) return;
      localStorage.removeItem(OUTBOX_KEY);
      const box = JSON.parse(raw);
      if (Array.isArray(box) && box.length && this.isActive()) {
        this._queue.push(...box.slice(-QUEUE_MAX));
        // Delay the redelivery a little so app boot isn't competing with it.
        setTimeout(() => this._drain(), 4000);
      }
    } catch (_) {}
  }
}

// ── App singleton + lifecycle wiring ─────────────────────────────────────────
export const smarthome = new SmartHomeClient();

if (typeof window !== 'undefined') {
  // session.end must go out while the page can still hand off a request.
  // pagehide is the reliable mobile signal; visibilitychange→hidden covers
  // app-switch on iOS where pagehide may never fire.
  window.addEventListener('pagehide', () => {
    smarthome.sessionEnd();
    smarthome.flush({ beacon: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') smarthome.flush({ beacon: true });
  });
}
