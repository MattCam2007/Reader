const TICK_PX = 18;

export function createPicker(opts) {
  const { stripId, trackId, valueId, min, max, step, majorEvery, initial, onChange } = opts;
  const stripEl = document.getElementById(stripId);
  const trackEl = document.getElementById(trackId);
  const valueEl = document.getElementById(valueId);
  let current = initial;

  function buildTrack() {
    const frag = document.createDocumentFragment();
    for (let v = min; v <= max; v += step) {
      const t = document.createElement("div");
      const major = v % majorEvery === 0;
      t.className = major ? "tick major" : "tick";
      t.dataset.value = v;
      if (major) {
        const label = document.createElement("div");
        label.className = "tick-label";
        label.textContent = v;
        t.appendChild(label);
      }
      frag.appendChild(t);
    }
    trackEl.appendChild(frag);
  }

  function setEdgePadding() {
    const pad = (stripEl.clientWidth - TICK_PX) / 2;
    trackEl.style.paddingLeft = pad + "px";
    trackEl.style.paddingRight = pad + "px";
  }

  function valueToScrollLeft(v) {
    return ((v - min) / step) * TICK_PX;
  }

  function scrollLeftToValue(sl) {
    const i = Math.round(sl / TICK_PX);
    const v = min + i * step;
    return Math.max(min, Math.min(max, v));
  }

  function syncFromScroll() {
    const v = scrollLeftToValue(stripEl.scrollLeft);
    if (v !== current) {
      current = v;
      valueEl.textContent = v;
      if (onChange) onChange(v);
    }
  }

  function scrollToValue(v, smooth) {
    stripEl.scrollTo({
      left: valueToScrollLeft(v),
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function relayout() {
    setEdgePadding();
    scrollToValue(current, false);
  }

  buildTrack();
  valueEl.textContent = current;
  requestAnimationFrame(relayout);

  stripEl.addEventListener("scroll", syncFromScroll, { passive: true });
  stripEl.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      stripEl.scrollLeft += e.deltaY;
    }
  }, { passive: false });
  trackEl.addEventListener("click", (e) => {
    const tick = e.target.closest(".tick");
    if (!tick) return;
    scrollToValue(parseInt(tick.dataset.value, 10), true);
  });
  window.addEventListener("resize", relayout);

  return {
    relayout,
    scrollTo: (v) => { current = v; scrollToValue(v, true); },
    getValue: () => current,
  };
}
