// Lightweight performance instrumentation.
//
// A no-op unless the page is loaded with `?perf=1`. When enabled it wraps the
// User Timing API (performance.mark/measure) so spans show up on the DevTools
// Performance track, and also keeps its own records so a labelled summary table
// can be printed from the console (`__perf.report()`).
//
// This is Phase 0 of the performance refactor: replace inference with numbers so
// every later optimisation can be proven against a committed baseline. It adds
// zero cost on a normal load — every entry point short-circuits when disabled.

const _params = (typeof location !== 'undefined' && location.search)
  ? new URLSearchParams(location.search)
  : null;

export const PERF_ENABLED = !!(_params && _params.get('perf') === '1');

const _records = [];          // { label, dur, meta, ts }
const _open = new Map();      // label -> start timestamp

function _now() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
}

function _record(label, dur, meta) {
  _records.push({ label, dur, meta: meta == null ? null : meta, ts: _now() });
  const ms = dur.toFixed(1);
  // Dim the label, accent the number, append any structured meta.
  console.log(
    `%c⏱ ${label} %c${ms}ms`,
    'color:#888',
    'color:#16a34a;font-weight:bold',
    meta == null ? '' : meta,
  );
  _scheduleOverlay();
}

// Open a span. Pair with measure(label) using the same label.
export function mark(label) {
  if (!PERF_ENABLED) return;
  _open.set(label, _now());
  try { performance.mark(`${label}:start`); } catch (_) {}
}

// Close a span opened with mark(label); records and returns its duration (ms).
export function measure(label, meta) {
  if (!PERF_ENABLED) return 0;
  const t0 = _open.get(label);
  if (t0 === undefined) return 0;
  _open.delete(label);
  const dur = _now() - t0;
  try {
    performance.mark(`${label}:end`);
    performance.measure(label, `${label}:start`, `${label}:end`);
  } catch (_) {}
  _record(label, dur, meta);
  return dur;
}

// Time a synchronous function. Returns whatever fn returns.
export function time(label, fn, meta) {
  if (!PERF_ENABLED) return fn();
  mark(label);
  try { return fn(); }
  finally { measure(label, meta); }
}

// Time an async function — awaits the returned promise before recording.
export async function timeAsync(label, fn, meta) {
  if (!PERF_ENABLED) return fn();
  mark(label);
  try { return await fn(); }
  finally { measure(label, meta); }
}

// Aggregate records into per-label rows (count / min / avg / max in ms).
export function summary() {
  const by = new Map();
  for (const r of _records) {
    if (!by.has(r.label)) by.set(r.label, []);
    by.get(r.label).push(r.dur);
  }
  const rows = [];
  for (const [label, durs] of by) {
    const n = durs.length;
    const sum = durs.reduce((a, b) => a + b, 0);
    rows.push({
      label,
      count: n,
      min: +Math.min(...durs).toFixed(1),
      avg: +(sum / n).toFixed(1),
      max: +Math.max(...durs).toFixed(1),
    });
  }
  return rows;
}

// Print the summary table (console.table when available).
export function report() {
  if (!PERF_ENABLED) return [];
  const rows = summary();
  if (console.table) console.table(rows);
  else console.log(rows);
  return rows;
}

// Drop all recorded spans — useful to isolate a single mode switch or page turn.
export function reset() {
  _records.length = 0;
  _open.clear();
}

// ---------- On-screen panel ----------
// No DevTools needed: when ?perf=1 is on, draw a live summary panel right in the
// app, with a Copy button that puts a Markdown table on the clipboard (paste it
// straight into the plan's Appendix A) and a Reset button to isolate a run.

let _overlayEl = null;
let _overlayBody = null;
let _overlayRaf = 0;

// Render the current summary as a Markdown table (what Copy puts on the clipboard).
function markdownTable() {
  const rows = summary();
  const lines = [
    '| Operation | count | avg ms | min ms | max ms |',
    '|-----------|------:|-------:|-------:|-------:|',
  ];
  for (const r of rows) {
    lines.push(`| ${r.label} | ${r.count} | ${r.avg} | ${r.min} | ${r.max} |`);
  }
  return lines.join('\n');
}

function _buildOverlay() {
  if (_overlayEl || typeof document === 'undefined' || !document.body) return;
  const wrap = document.createElement('div');
  wrap.id = 'perfPanel';
  wrap.style.cssText = [
    'position:fixed', 'right:8px', 'bottom:8px', 'z-index:2147483647',
    'max-width:min(92vw,420px)', 'max-height:60vh', 'overflow:auto',
    'background:rgba(17,17,17,0.92)', 'color:#e5e5e5', 'font:11px/1.4 ui-monospace,Menlo,Consolas,monospace',
    'border:1px solid #333', 'border-radius:8px', 'padding:8px 10px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.4)', 'pointer-events:auto', 'user-select:text',
  ].join(';');

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
  const title = document.createElement('strong');
  title.textContent = '⏱ perf';
  title.style.cssText = 'color:#22c55e;flex:1';

  const mkBtn = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:11px ui-monospace,monospace;background:#222;color:#e5e5e5;border:1px solid #444;border-radius:5px;padding:2px 8px;cursor:pointer';
    return b;
  };
  const copyBtn = mkBtn('Copy');
  const resetBtn = mkBtn('Reset');
  const hideBtn = mkBtn('×');

  copyBtn.addEventListener('click', () => {
    const md = markdownTable();
    const done = () => { copyBtn.textContent = 'Copied'; setTimeout(() => (copyBtn.textContent = 'Copy'), 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(done, () => _fallbackCopy(md, done));
    } else {
      _fallbackCopy(md, done);
    }
  });
  resetBtn.addEventListener('click', () => { reset(); _renderOverlay(); });
  hideBtn.addEventListener('click', () => { wrap.style.display = 'none'; });

  head.append(title, copyBtn, resetBtn, hideBtn);

  _overlayBody = document.createElement('div');
  wrap.append(head, _overlayBody);
  document.body.appendChild(wrap);
  _overlayEl = wrap;
  _renderOverlay();
}

function _fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch (_) { /* leave the markdown selectable in the panel */ }
}

function _renderOverlay() {
  if (!_overlayBody) return;
  const rows = summary();
  if (!rows.length) {
    _overlayBody.textContent = 'Load a book, turn pages, switch modes…';
    return;
  }
  const cells = (r) =>
    `<td style="padding:1px 6px">${r.label}</td>` +
    `<td style="padding:1px 6px;text-align:right;color:#22c55e">${r.avg}</td>` +
    `<td style="padding:1px 6px;text-align:right;color:#888">${r.min}</td>` +
    `<td style="padding:1px 6px;text-align:right;color:#888">${r.max}</td>` +
    `<td style="padding:1px 6px;text-align:right;color:#888">${r.count}</td>`;
  _overlayBody.innerHTML =
    '<table style="border-collapse:collapse;width:100%">' +
    '<thead><tr style="color:#aaa;text-align:left">' +
    '<th style="padding:1px 6px">op</th>' +
    '<th style="padding:1px 6px;text-align:right">avg</th>' +
    '<th style="padding:1px 6px;text-align:right">min</th>' +
    '<th style="padding:1px 6px;text-align:right">max</th>' +
    '<th style="padding:1px 6px;text-align:right">n</th>' +
    '</tr></thead><tbody>' +
    rows.map((r) => `<tr>${cells(r)}</tr>`).join('') +
    '</tbody></table>' +
    '<div style="color:#666;margin-top:4px">ms · avg/min/max · n=samples</div>';
}

// Coalesce rapid records into one paint.
function _scheduleOverlay() {
  if (!PERF_ENABLED || typeof requestAnimationFrame === 'undefined') return;
  if (_overlayRaf) return;
  _overlayRaf = requestAnimationFrame(() => {
    _overlayRaf = 0;
    if (!_overlayEl) _buildOverlay();
    else _renderOverlay();
  });
}

// Expose a console handle too (for anyone who does have DevTools).
if (PERF_ENABLED && typeof window !== 'undefined') {
  window.__perf = { summary, report, reset, markdownTable, records: _records };
  console.log(
    '%c⏱ perf instrumentation ON (?perf=1) — see the on-screen panel (or run __perf.report())',
    'color:#16a34a;font-weight:bold',
  );
  // Build the panel as soon as the DOM is ready.
  if (document.body) _buildOverlay();
  else document.addEventListener('DOMContentLoaded', _buildOverlay, { once: true });
}

export default { PERF_ENABLED, mark, measure, time, timeAsync, summary, report, reset, markdownTable };
