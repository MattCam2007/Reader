import { classifyPenSignal } from './pen-signals.js';

// Live diagnostic overlay for S Pen / stylus input. Activated with ?pendebug=1.
//
// Purpose: many Samsung S Pens expose their side button ONLY over Bluetooth LE
// ("Air Actions"), which a web page cannot see — pressing it does NOT change
// PointerEvent.buttons. Others report it through the digitizer as
// MotionEvent.BUTTON_STYLUS_PRIMARY, which Chrome maps to buttons & 2. This
// overlay shows exactly which fields move when you interact, so we can tell
// whether the web-layer (Phase 2) approach can work on a given device or
// whether the native bridge (Phase 4) is required.
//
// It is purely passive: it never preventDefaults, never mutates content, and is
// removed when the param is absent. Wired from reader-app init.
export function initPenDebug(signal) {
  const panel = document.createElement('div');
  panel.id = 'pen-debug';
  panel.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:8px', 'z-index:99999',
    'background:rgba(0,0,0,0.85)', 'color:#0f0', 'font:12px/1.5 monospace',
    'padding:8px 10px', 'border-radius:6px', 'pointer-events:none',
    'max-width:90vw', 'white-space:pre', 'border:1px solid #0f0',
  ].join(';');
  panel.textContent = 'pen-debug ready — touch/hover the screen with your S Pen';
  document.body.appendChild(panel);

  // Remember the strongest button bitmask seen during a single contact, so a
  // button press that only appears for one frame is still visible after lift.
  let maxButtons = 0;
  let lastType = '';

  const fmt = (e, kind) => {
    if (e.pointerType === 'pen') maxButtons |= e.buttons;
    if (e.pointerType) lastType = e.pointerType;
    const cls = classifyPenSignal(e.buttons, e.pressure);
    return [
      `event:    ${kind}`,
      `type:     ${e.pointerType}`,
      `buttons:  ${e.buttons}   (bit1=tip2 bit2=barrel32 bit5=eraser)`,
      `button:   ${e.button}`,
      `pressure: ${e.pressure.toFixed(3)}`,
      `tiltX/Y:  ${e.tiltX}/${e.tiltY}`,
      `classify: ${cls}`,
      `--`,
      `maxButtons seen this session: ${maxButtons}`,
      `barrel bit ever seen (2): ${(maxButtons & 2) ? 'YES' : 'no'}`,
      `eraser bit ever seen (32): ${(maxButtons & 32) ? 'YES' : 'no'}`,
    ].join('\n');
  };

  const onEvt = (kind) => (e) => {
    // Show pen and mouse (some emulators report stylus as mouse); ignore touch noise.
    if (e.pointerType === 'touch') return;
    panel.textContent = fmt(e, kind);
  };

  for (const [type, kind] of [
    ['pointerdown', 'down'],
    ['pointermove', 'move'],
    ['pointerup', 'up'],
    ['pointercancel', 'cancel'],
    ['pointerleave', 'leave'],
  ]) {
    document.addEventListener(type, onEvt(kind), { passive: true, capture: true, signal });
  }
}
