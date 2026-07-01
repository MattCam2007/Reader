import { THEME_COLORS, THEME_TEXT_COLORS } from '../core/constants.js';

const CHEVRON = `<svg class="theme-picker-chevron" viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,1 5,5 9,1"/></svg>`;
const CHECK = `<svg class="theme-picker-check" viewBox="0 0 16 12" width="14" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,6 5,10 15,1"/></svg>`;

function swatch(key) {
  return { bg: THEME_COLORS[key], fg: THEME_TEXT_COLORS[key] };
}

// Builds the list of option buttons, each rendered IN ITS OWN theme colors so
// the menu previews every theme, mirroring how the font picker renders each
// option in its own typeface. `options` is [[key, label], ...].
function itemsHTML(options, currentVal) {
  const cur = String(currentVal);
  return options.map(([val, label]) => {
    const { bg, fg } = swatch(val);
    const active = val === cur;
    return (
      `<button class="theme-picker-item${active ? ' theme-picker-item--active' : ''}" ` +
      `role="option" data-theme="${val}" style="background:${bg};color:${fg}" ` +
      `aria-selected="${active}" type="button">` +
        `<span class="theme-picker-item-label">${label}</span>` +
        (active ? CHECK : '') +
      `</button>`
    );
  }).join('');
}

export function renderThemePickerHTML(id, options, currentVal) {
  const cur = String(currentVal);
  const label = (options.find(([val]) => val === cur) || options[0])[1];
  const { bg, fg } = swatch(cur);
  return (
    `<div class="theme-picker" id="${id}">` +
      `<button class="theme-picker-btn" type="button" ` +
      `aria-haspopup="listbox" aria-expanded="false" ` +
      `style="background:${bg};color:${fg}">` +
        `<span class="theme-picker-label">${label}</span>` +
        CHEVRON +
      `</button>` +
      `<div class="theme-picker-panel" role="listbox" hidden>` +
        itemsHTML(options, currentVal) +
      `</div>` +
    `</div>`
  );
}

// Mount the interactive behaviour on an already-rendered theme-picker element.
// Returns { update(key), destroy() }.
export function mountThemePicker(el, onChange) {
  if (!el) return null;

  const btn   = el.querySelector('.theme-picker-btn');
  const panel = el.querySelector('.theme-picker-panel');
  if (!btn || !panel) return null;

  // Read back [key, label] pairs from the rendered items rather than passing
  // them separately — they're already in the DOM, and the labels are i18n
  // strings resolved by the caller at render time.
  const options = [...panel.querySelectorAll('.theme-picker-item')].map(
    (item) => [item.dataset.theme, item.querySelector('.theme-picker-item-label').textContent]
  );

  // Relocate the panel to <body> so it can never be trapped/clipped by an
  // ancestor that establishes a containing block for position:fixed, matching
  // the font picker's approach.
  document.body.appendChild(panel);

  let isOpen = false;

  function position() {
    const rect = btn.getBoundingClientRect();
    panel.style.left  = rect.left + 'px';
    panel.style.width = rect.width + 'px';
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const maxH = 340;
    if (spaceBelow >= 180 || spaceBelow >= spaceAbove) {
      panel.style.top    = (rect.bottom + 4) + 'px';
      panel.style.bottom = '';
      panel.style.maxHeight = Math.min(maxH, spaceBelow) + 'px';
    } else {
      panel.style.top    = '';
      panel.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      panel.style.maxHeight = Math.min(maxH, spaceAbove) + 'px';
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    position();
    panel.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      const active = panel.querySelector('[aria-selected="true"]');
      if (active) active.scrollIntoView({ block: 'nearest' });
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', () => { isOpen ? close() : open(); });

  panel.addEventListener('click', (e) => {
    const item = e.target.closest('[data-theme]');
    if (!item) return;
    const key = item.dataset.theme;
    update(key);
    close();
    onChange(key);
  });

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); btn.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...panel.querySelectorAll('.theme-picker-item')];
    const idx   = items.indexOf(document.activeElement);
    const next  = e.key === 'ArrowDown'
      ? Math.min(idx + 1, items.length - 1)
      : Math.max(idx - 1, 0);
    items[next]?.focus();
  });

  function update(key) {
    const { bg, fg } = swatch(key);
    const opt = options.find(([val]) => val === key);
    const label = btn.querySelector('.theme-picker-label');
    if (label && opt) label.textContent = opt[1];
    btn.style.background = bg;
    btn.style.color = fg;
    panel.querySelectorAll('.theme-picker-item').forEach(item => {
      const active = item.dataset.theme === key;
      item.classList.toggle('theme-picker-item--active', active);
      item.setAttribute('aria-selected', String(active));
      const check = item.querySelector('.theme-picker-check');
      if (active && !check) item.insertAdjacentHTML('beforeend', CHECK);
      else if (!active && check) check.remove();
    });
    if (isOpen) position();
  }

  // The panel lives in <body>, so "outside" means outside BOTH the trigger and
  // the panel itself; selections inside the panel are handled by its own click.
  const onOutside = (e) => {
    if (!el.contains(e.target) && !panel.contains(e.target)) close();
  };
  const onScroll  = () => { if (isOpen) position(); };

  document.addEventListener('click',  onOutside, { capture: true });
  document.addEventListener('scroll', onScroll,  { capture: true, passive: true });
  window.addEventListener('resize',   onScroll);

  return {
    update,
    destroy() {
      document.removeEventListener('click',  onOutside, { capture: true });
      document.removeEventListener('scroll', onScroll,  { capture: true });
      window.removeEventListener('resize',   onScroll);
      close();
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    },
  };
}
