import { HOVER_SETTLE_MS } from '../core/constants.js';

// On-screen diagnostic for the S Pen hover-preview timing. Activated with
// ?hoverdebug=1. It prints the HOVER_SETTLE_MS value baked into the *loaded*
// constants module (so a stale, service-worker-cached build is immediately
// obvious) plus the measured arm→fire delay of each definition popup.
//
// Returns an onDebug(kind, key, n) callback to hand to HoverPreview:
//   ('arm',  key, settleMs)  — a timer was scheduled for `key`
//   ('fire', key, elapsedMs) — the timer fired after `elapsedMs` real ms
//
// Purely passive: it never mutates content or input. Removed when the param is
// absent (it is only constructed then).
export function initHoverDebug() {
  const panel = document.createElement('div');
  panel.id = 'hover-debug';
  panel.style.cssText = [
    'position:fixed', 'left:8px', 'top:8px', 'z-index:99999',
    'background:rgba(0,0,0,0.85)', 'color:#0ff', 'font:12px/1.5 monospace',
    'padding:8px 10px', 'border-radius:6px', 'pointer-events:none',
    'max-width:90vw', 'white-space:pre', 'border:1px solid #0ff',
  ].join(';');
  document.body.appendChild(panel);

  let arms = 0, fires = 0, lastLine = 'waiting for an S Pen hover…';
  const render = () => {
    panel.textContent = [
      `HOVER_SETTLE_MS (loaded module) = ${HOVER_SETTLE_MS}`,
      `arms: ${arms}   fires: ${fires}`,
      `--`,
      lastLine,
    ].join('\n');
  };
  render();

  return (kind, key, n) => {
    if (kind === 'arm') {
      arms++;
      lastLine = `ARMED  ${key}  (settle ${n}ms) …`;
    } else if (kind === 'fire') {
      fires++;
      lastLine = `FIRED  ${key}  after ${n}ms`;
    }
    render();
  };
}
