import { FONT_REGISTRY, fontByKey } from '../core/fonts.js';

const CHEVRON = `<svg class="font-picker-chevron" viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,1 5,5 9,1"/></svg>`;

// Font stacks contain double quotes (e.g. "SF Mono"). When embedded in a
// double-quoted HTML attribute they must be entity-escaped or the inner quote
// terminates the attribute early and the font-family is silently dropped.
function escAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

// The list of option buttons (with the serif/sans/mono → separator → A-Z order).
// Each option is rendered IN ITS OWN typeface so the menu previews the font.
// Shared by the settings screen and the reader quick drawer.
export function fontPickerItemsHTML(currentKey) {
  const cur = fontByKey(currentKey);
  const items = [];
  let addedSep = false;

  for (const f of FONT_REGISTRY) {
    if (!addedSep && f.group === 'named') {
      items.push('<hr class="font-picker-sep" role="separator" aria-hidden="true">');
      addedSep = true;
    }
    const active = f.key === cur.key;
    items.push(
      `<button class="font-picker-item${active ? ' font-picker-item--active' : ''}" ` +
      `role="option" data-font="${f.key}" ` +
      `style="font-family:${escAttr(f.stack)}" ` +
      `aria-selected="${active}" type="button">${f.label}</button>`
    );
  }
  return items.join('');
}

export function renderFontPickerHTML(id, currentKey) {
  const cur = fontByKey(currentKey);
  return (
    `<div class="font-picker" id="${id}">` +
      `<button class="font-picker-btn" type="button" ` +
      `aria-haspopup="listbox" aria-expanded="false" ` +
      `style="font-family:${escAttr(cur.stack)}">` +
        `<span class="font-picker-label">${cur.label}</span>` +
        CHEVRON +
      `</button>` +
      `<div class="font-picker-panel" role="listbox" hidden>` +
        fontPickerItemsHTML(currentKey) +
      `</div>` +
    `</div>`
  );
}

// Mount the interactive behaviour on an already-rendered font-picker element.
// Returns { update(key), destroy() }.
export function mountFontPicker(el, onChange) {
  if (!el) return null;

  const btn   = el.querySelector('.font-picker-btn');
  const panel = el.querySelector('.font-picker-panel');
  if (!btn || !panel) return null;

  // Relocate the panel to <body> so it can never be trapped/clipped by an
  // ancestor that establishes a containing block for position:fixed — e.g. the
  // quick drawer's backdrop-filter — or an overflow:hidden parent. It is
  // positioned via fixed viewport coordinates computed from the button.
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
    const item = e.target.closest('[data-font]');
    if (!item) return;
    const key = item.dataset.font;
    update(key);
    close();
    onChange(key);
  });

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); btn.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...panel.querySelectorAll('.font-picker-item')];
    const idx   = items.indexOf(document.activeElement);
    const next  = e.key === 'ArrowDown'
      ? Math.min(idx + 1, items.length - 1)
      : Math.max(idx - 1, 0);
    items[next]?.focus();
  });

  function update(key) {
    const font = fontByKey(key);
    const label = btn.querySelector('.font-picker-label');
    if (label) label.textContent = font.label;
    btn.style.fontFamily = font.stack;
    panel.querySelectorAll('.font-picker-item').forEach(item => {
      const active = item.dataset.font === key;
      item.classList.toggle('font-picker-item--active', active);
      item.setAttribute('aria-selected', String(active));
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
