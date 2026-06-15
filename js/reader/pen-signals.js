// Classify an S Pen contact from its PointerEvent fields. Pure.
// buttons bitmask: 1=tip, 2=barrel, 32=eraser. Eraser wins over barrel wins over tip.
// Samsung Galaxy S Pen (S21 Ultra+) quirk: the side button sets bit 0 (value 1) with
// pressure=0 while hovering — same bit as a tip contact but without any pressure.
export function classifyPenSignal(buttons, pressure) {
  if (buttons & 32) return 'eraser';
  if (buttons & 2)  return 'barrel';
  // Samsung: side button held while hovering = bit 0 set, pressure stays 0
  if ((buttons & 1) && pressure === 0) return 'barrel';
  if ((buttons & 1) || pressure > 0) return 'tip';
  return 'hover';
}
