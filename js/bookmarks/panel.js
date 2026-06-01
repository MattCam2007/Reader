// Bookmarks panel UI — shared across all three reading modes.
// Call initBookmarksPanel() once per mode init; use returned handle to open/render.

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
      <div class="bm-note-show" data-show-id="${item.id}">${note ? note : '<span class="bm-note-hint">Add note…</span>'}</div>
      <div class="bm-note-editor" id="bm-editor-${item.id}" hidden>
        <textarea class="bm-textarea" placeholder="Add a note…" aria-label="Note">${note}</textarea>
        <div class="bm-editor-actions">
          <button class="bm-save-btn" data-id="${item.id}" type="button">Save</button>
          <button class="bm-cancel-btn" type="button">Cancel</button>
        </div>
      </div>
    </div>
    <div class="bm-item-foot">
      <button class="bm-go-btn" data-id="${item.id}" type="button">Go to</button>
      <button class="bm-del-btn" data-id="${item.id}" type="button" aria-label="Delete bookmark">✕</button>
    </div>`;
}

export function initBookmarksPanel({ panelEl, listEl, addBtnEl }, signal) {
  let _bm = null;
  let _getContext = null;
  let _onNavigate = null;
  let _closePanel = null;

  function setBook(bm) { _bm = bm; }

  function setCallbacks({ getContext, onNavigate, closePanel }) {
    _getContext = getContext;
    _onNavigate = onNavigate;
    _closePanel = closePanel;
  }

  function render() {
    if (!listEl || !_bm) return;
    const items = _bm.getAll();
    if (!items.length) {
      listEl.innerHTML = '<div class="bm-empty">No bookmarks yet. Tap <b>+ Add</b> above to save your place.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'bm-item';
      div.dataset.id = item.id;
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
  }

  function handleListClick(e) {
    if (!_bm) return;

    const goBtn = e.target.closest('.bm-go-btn');
    const delBtn = e.target.closest('.bm-del-btn');
    const showNote = e.target.closest('.bm-note-show');
    const saveBtn = e.target.closest('.bm-save-btn');
    const cancelBtn = e.target.closest('.bm-cancel-btn');

    if (goBtn) {
      const id = goBtn.dataset.id;
      const item = _bm.getAll().find(i => i.id === id);
      if (item && _onNavigate) { _onNavigate(item); }
      if (_closePanel) _closePanel();
    } else if (delBtn) {
      _bm.remove(delBtn.dataset.id);
      render();
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

  return { setBook, setCallbacks, render };
}
