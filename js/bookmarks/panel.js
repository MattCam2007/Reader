// Bookmarks panel UI — shared across all three reading modes.
// Call initBookmarksPanel() once per mode init; use returned handle to open/render.

import { t } from '../core/i18n.js';

const BM_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5'];

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildColorSwatches(item) {
  return BM_COLORS.map(c => `<button class="bm-color-swatch${item.color === c ? ' active' : ''}" data-id="${item.id}" data-color="${c}" style="--swatch:var(--bm-${c})" aria-label="${esc(t('a11y.bookmarkColor', { color: c }))}" type="button"></button>`).join('');
}

function buildItemHTML(item) {
  const pct = Math.round(item.fraction * 100);
  const chap = esc(item.chapterLabel || '');
  const text = esc(item.text || '');
  const note = esc(item.note || '');
  return `
    <div class="bm-item-head">
      ${chap ? `<span class="bm-chap">${chap}</span>` : ''}
      <span class="bm-pct">${pct}%</span>
    </div>
    ${text ? `<div class="bm-preview">${text}</div>` : ''}
    <div class="bm-note-area">
      <div class="bm-note-show" data-show-id="${item.id}">${note ? note : `<span class="bm-note-hint">${esc(t('msg.addNote'))}</span>`}</div>
      <div class="bm-note-editor" id="bm-editor-${item.id}" hidden>
        <textarea class="bm-textarea" placeholder="${esc(t('msg.addNotePlaceholder'))}" aria-label="${esc(t('a11y.note'))}">${note}</textarea>
        <div class="bm-editor-actions">
          <button class="bm-save-btn" data-id="${item.id}" type="button">${esc(t('btn.save'))}</button>
          <button class="bm-cancel-btn" type="button">${esc(t('btn.cancel'))}</button>
        </div>
      </div>
    </div>
    <div class="bm-item-foot">
      <button class="bm-go-btn" data-id="${item.id}" type="button">${esc(t('btn.goTo'))}</button>
      <div class="bm-colors">${buildColorSwatches(item)}</div>
      <button class="bm-del-btn" data-id="${item.id}" type="button" aria-label="${esc(t('a11y.removeBookmark'))}">✕</button>
    </div>`;
}

export function initBookmarksPanel({ panelEl, listEl, addBtnEl, closeBtnEl }, signal) {
  let _bm = null;
  let _getContext = null;
  let _onNavigate = null;
  let _closePanel = null;
  let _onBookmarksChange = null;

  function setBook(bm) { _bm = bm; }

  function setCallbacks({ getContext, onNavigate, closePanel, onBookmarksChange }) {
    _getContext = getContext;
    _onNavigate = onNavigate;
    _closePanel = closePanel;
    _onBookmarksChange = onBookmarksChange || null;
  }

  function render() {
    if (!listEl || !_bm) return;
    const items = _bm.getAll();
    if (!items.length) {
      listEl.innerHTML = `<div class="bm-empty">${t('msg.noBookmarks')}</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'bm-item';
      div.dataset.id = item.id;
      if (item.color) div.style.setProperty('--bm-item-color', `var(--bm-${item.color})`);
      div.innerHTML = buildItemHTML(item);
      frag.appendChild(div);
    });
    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  function handleAdd() {
    if (!_bm || !_getContext) return;
    const ctx = _getContext();
    if (!ctx) return;
    _bm.add(ctx);
    render();
    if (_onBookmarksChange) _onBookmarksChange();
  }

  function handleListClick(e) {
    if (!_bm) return;

    const goBtn = e.target.closest('.bm-go-btn');
    const delBtn = e.target.closest('.bm-del-btn');
    const showNote = e.target.closest('.bm-note-show');
    const saveBtn = e.target.closest('.bm-save-btn');
    const cancelBtn = e.target.closest('.bm-cancel-btn');
    const colorSwatch = e.target.closest('.bm-color-swatch');

    if (goBtn) {
      const id = goBtn.dataset.id;
      const item = _bm.getAll().find(i => i.id === id);
      if (item && _onNavigate) { _onNavigate(item); }
      if (_closePanel) _closePanel();
    } else if (delBtn) {
      _bm.remove(delBtn.dataset.id);
      render();
      if (_onBookmarksChange) _onBookmarksChange();
    } else if (colorSwatch) {
      _bm.updateColor(colorSwatch.dataset.id, colorSwatch.dataset.color);
      render();
      if (_onBookmarksChange) _onBookmarksChange();
    } else if (showNote) {
      const id = showNote.dataset.showId;
      const editor = document.getElementById('bm-editor-' + id);
      if (editor) {
        editor.hidden = false;
        const ta = editor.querySelector('.bm-textarea');
        if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
      }
    } else if (saveBtn) {
      const id = saveBtn.dataset.id;
      const editor = document.getElementById('bm-editor-' + id);
      if (editor) {
        const ta = editor.querySelector('.bm-textarea');
        if (ta) _bm.updateNote(id, ta.value.trim());
      }
      render();
    } else if (cancelBtn) {
      render();
    }
  }

  if (addBtnEl) addBtnEl.addEventListener('click', handleAdd, { signal });
  if (listEl) listEl.addEventListener('click', handleListClick, { signal });
  if (closeBtnEl) closeBtnEl.addEventListener('click', () => { if (_closePanel) _closePanel(); }, { signal });

  return { setBook, setCallbacks, render };
}
