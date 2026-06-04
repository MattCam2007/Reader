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

// Expose a console handle for manual baseline capture.
if (PERF_ENABLED && typeof window !== 'undefined') {
  window.__perf = { summary, report, reset, records: _records };
  console.log(
    '%c⏱ perf instrumentation ON (?perf=1) — run __perf.report() for a summary',
    'color:#16a34a;font-weight:bold',
  );
}

export default { PERF_ENABLED, mark, measure, time, timeAsync, summary, report, reset };
