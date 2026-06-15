// Classify an S Pen contact from its PointerEvent fields. Pure.
// buttons bitmask: 1=tip, 2=barrel, 32=eraser. Eraser wins over barrel wins over tip.
export function classifyPenSignal(buttons, pressure) {
  if (buttons & 32) return 'eraser';
  if (buttons & 2)  return 'barrel';
  if ((buttons & 1) || pressure > 0) return 'tip';
  return 'hover';
}
