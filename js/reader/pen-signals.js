// Map analog tip pressure (0..1) to a discrete highlight weight. Pure.
// Bands: light rest → 'light', normal writing → 'medium', deliberate press → 'heavy'.
// pressure 0/undefined (PE level-2 engines or synthetic events) defaults to 'medium'.
export function pressureToWeight(pressure) {
  if (pressure == null || pressure === 0) return 'medium';
  if (pressure < 0.34) return 'light';
  if (pressure < 0.67) return 'medium';
  return 'heavy';
}
