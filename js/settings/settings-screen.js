import { DEFAULT_PREFS, MIN_SIZE, MAX_SIZE, GENERAL_DEFAULTS, ALL_THEME_NAMES } from '../core/constants.js';
import { RSVP_DEFAULTS } from '../rsvp/constants.js';
import { TTS_DEFAULTS } from '../tts/constants.js';
import { PrefsManager } from '../core/prefs.js';
import { createPicker } from '../shared/picker.js';
import { renderFontPickerHTML, mountFontPicker } from '../shared/font-picker.js';
import { renderThemePickerHTML, mountThemePicker } from '../shared/theme-picker.js';
import { BG_IMAGE_STORAGE_KEY, applyBgSettings, clearBgImage } from '../base-reader-app.js';
import { dictionaries, languageName } from '../core/dictionary.js';
import { t, getLang, setLang, availableLanguages } from '../core/i18n.js';

let _screen = null;
let _cleanup = null;

// Survives the page reload triggered by a language change: holds the tab that
// was open so the booting mode can reopen the settings screen there.
const REOPEN_KEY = 'settings:reopenTab';

// Returns the tab to reopen settings on after a language-change reload (and
// clears it so it fires once), or null if no reopen is pending.
export function consumePendingSettingsTab() {
  try {
    const v = sessionStorage.getItem(REOPEN_KEY);
    if (v !== null) { sessionStorage.removeItem(REOPEN_KEY); return v || null; }
  } catch (_) {}
  return null;
}

// Live-preview state: set while settings screen is open.
let _onPreviewStart = null;
let _onPreviewEnd = null;
let _previewActive = false;

function _startPreview() {
  if (_previewActive) return;
  _previewActive = true;
  if (_screen) _screen.classList.add('sscreen--preview');
  if (_onPreviewStart) _onPreviewStart();
}

function _endPreview() {
  if (!_previewActive) return;
  _previewActive = false;
  if (_screen) _screen.classList.remove('sscreen--preview');
  if (_onPreviewEnd) _onPreviewEnd();
}

// Module-level singleton prefs — one instance per scope for the entire app lifetime.
// Created lazily on first settings open; load() called each time to sync with localStorage.
let _generalPrefs = null;
let _readerPrefs = null;
let _rsvpPrefs = null;
let _ttsPrefs = null;

function getOrCreatePrefs(ref, opts) {
  if (!ref) {
    const p = new PrefsManager(opts);
    p.load();
    return p;
  }
  ref.load(); // re-sync in case the app changed values externally
  return ref;
}

// Every settings-screen element lives inside _screen, so lookups are scoped to
// it rather than document.getElementById. Book content is rendered earlier in
// DOM order and the sanitiser preserves element ids (TOC/footnote targets), so
// a book element carrying a matching id would otherwise shadow a control (DOM
// clobbering). Scoped queries are the defence — no global id prefixing, which
// would break epub.js-provided TOC fragment hrefs.
function byId(id) {
  return _screen ? _screen.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(id) : id)) : null;
}

// ── Public API ───────────────────────────────────────────────────────────────

// True while the settings screen is open. Callers must use this instead of
// document.getElementById('settingsScreen'), which book content can shadow.
export function isSettingsScreenOpen() {
  return !!_screen;
}

export function openSettingsScreen(config = {}) {
  if (_screen) return;

  const {
    initialTab = 'read',
    currentMode = 'read',
    onGeneralChange = null,  // fn(key, value)
    onReaderChange = null,   // fn(key, value, needsRepaginate)
    onRsvpChange = null,     // fn(key, value)
    onTtsChange = null,      // fn(key, value)
    onPreviewStart = null,   // fn() — called when a preview-enabled control is held
    onPreviewEnd = null,     // fn() — called when the hold ends
  } = config;

  _onPreviewStart = onPreviewStart;
  _onPreviewEnd = onPreviewEnd;
  _previewActive = false;

  _generalPrefs = getOrCreatePrefs(_generalPrefs, { storageKey: 'general:prefs', defaults: GENERAL_DEFAULTS });
  _readerPrefs  = getOrCreatePrefs(_readerPrefs,  { storageKey: 'reader:prefs',  defaults: DEFAULT_PREFS });
  _rsvpPrefs    = getOrCreatePrefs(_rsvpPrefs,    { storageKey: 'rsvp:prefs',    defaults: RSVP_DEFAULTS });
  _ttsPrefs     = getOrCreatePrefs(_ttsPrefs,     { storageKey: 'tts:prefs',     defaults: TTS_DEFAULTS });

  const generalPrefs = _generalPrefs;
  const readerPrefs  = _readerPrefs;
  const rsvpPrefs    = _rsvpPrefs;
  const ttsPrefs     = _ttsPrefs;

  _screen = document.createElement('div');
  _screen.id = 'settingsScreen';
  _screen.className = 'sscreen';
  _screen.setAttribute('role', 'dialog');
  _screen.setAttribute('aria-modal', 'true');
  _screen.setAttribute('aria-label', t('a11y.settingsDialog'));
  _screen.innerHTML = `
    <div class="sscreen-header">
      <button class="sscreen-close" type="button" aria-label="${t('a11y.closeSettings')}">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15,18 9,12 15,6"/>
        </svg>
      </button>
      <span class="sscreen-title">${t('settings.title')}</span>
      <select class="sscreen-lang" id="ssLang" aria-label="${t('settings.language')}">
        ${availableLanguages().map(l => `<option value="${l.code}"${l.code === getLang() ? ' selected' : ''}>${l.label}</option>`).join('')}
      </select>
    </div>
    <nav class="sscreen-tabs" role="tablist" aria-label="${t('a11y.modeSettings')}">
      <button class="sscreen-tab" role="tab" data-tab="general" type="button">${t('tab.general')}</button>
      <button class="sscreen-tab" role="tab" data-tab="read" type="button">${t('tab.read')}</button>
      <button class="sscreen-tab" role="tab" data-tab="rsvp" type="button">${t('tab.speed')}</button>
      <button class="sscreen-tab" role="tab" data-tab="tts" type="button">${t('tab.listen')}</button>
      <button class="sscreen-tab" role="tab" data-tab="dict" type="button">${t('tab.words')}</button>
    </nav>
    <div class="sscreen-body" id="sscreenBody" role="tabpanel"></div>`;

  document.body.appendChild(_screen);
  requestAnimationFrame(() => _screen && _screen.classList.add('sscreen--open'));

  let rsvpPickers   = null;
  let fontPickerHandle = null;
  let themePickerHandle = null;

  function destroyTabHandles() {
    if (rsvpPickers) { rsvpPickers.forEach(p => p && p.destroy && p.destroy()); rsvpPickers = null; }
    if (fontPickerHandle) { fontPickerHandle.destroy(); fontPickerHandle = null; }
    if (themePickerHandle) { themePickerHandle.destroy(); themePickerHandle = null; }
  }

  function showTab(tab) {
    _screen.querySelectorAll('.sscreen-tab').forEach(t => {
      const active = t.dataset.tab === tab;
      t.classList.toggle('sscreen-tab--active', active);
      t.setAttribute('aria-selected', String(active));
    });

    destroyTabHandles();

    const body = byId('sscreenBody');
    if (!body) return;

    if (tab === 'general') {
      body.innerHTML = generalTabHTML(generalPrefs.data);
      themePickerHandle = wireGeneralTab(generalPrefs, onGeneralChange);
    } else if (tab === 'read') {
      body.innerHTML = readTabHTML(readerPrefs.data);
      fontPickerHandle = wireReadTab(readerPrefs, currentMode === 'read' ? onReaderChange : null);
    } else if (tab === 'rsvp') {
      body.innerHTML = speedTabHTML(rsvpPrefs.data);
      const result = wireSpeedTab(rsvpPrefs, currentMode === 'rsvp' ? onRsvpChange : null);
      rsvpPickers = result.pickers;
      fontPickerHandle = result.fontHandle;
    } else if (tab === 'tts') {
      body.innerHTML = listenTabHTML(ttsPrefs.data);
      fontPickerHandle = wireListenTab(ttsPrefs, currentMode === 'tts' ? onTtsChange : null);
    } else if (tab === 'dict') {
      body.innerHTML = `${section(t('sec.offlineDictionaries'))}<div class="ss-dict" id="ssDict"><div class="ss-dict-loading">${t('msg.loading')}</div></div>`;
      wireDictTab(byId('ssDict'));
    }
  }

  _screen.querySelectorAll('.sscreen-tab').forEach(t => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  });

  showTab(initialTab);

  _screen.querySelector('.sscreen-close').addEventListener('click', closeSettingsScreen);

  // Language switch reloads the page: UI strings are baked into the mode
  // templates at build time, so a reload is the simplest way to re-render every
  // surface in the chosen language.
  const langSel = byId('ssLang');
  if (langSel) {
    langSel.addEventListener('change', () => {
      if (langSel.value === getLang()) return;
      // Remember the open tab so boot can reopen the settings screen right where
      // the user left it, instead of dropping them back to the book.
      const activeTab = _screen.querySelector('.sscreen-tab--active');
      try { sessionStorage.setItem(REOPEN_KEY, activeTab ? activeTab.dataset.tab : ''); } catch (_) {}
      if (setLang(langSel.value)) location.reload();
    });
  }

  const onKey = (e) => { if (e.key === 'Escape') closeSettingsScreen(); };
  document.addEventListener('keydown', onKey);

  _cleanup = () => {
    document.removeEventListener('keydown', onKey);
    destroyTabHandles();
  };
}

export function closeSettingsScreen() {
  if (!_screen) return;
  _endPreview();
  const el = _screen;
  _screen = null;
  _onPreviewStart = null;
  _onPreviewEnd = null;
  if (_cleanup) { _cleanup(); _cleanup = null; }
  el.classList.remove('sscreen--open');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
}

// ── HTML builders ────────────────────────────────────────────────────────────

function row(label, control) {
  return `<div class="ss-row"><span class="ss-label">${label}</span>${control}</div>`;
}

function section(text) {
  return `<div class="ss-section">${text}</div>`;
}

function seg(id, attr, options, currentVal) {
  const cur = String(currentVal);
  const btns = options.map(([val, label]) => {
    const active = cur === val;
    return `<button class="reader-seg-btn${active ? ' active' : ''}" ${attr}="${val}" aria-pressed="${active}" type="button">${label}</button>`;
  }).join('');
  return `<div class="reader-seg" id="${id}">${btns}</div>`;
}

function counter(downId, displayId, upId, val) {
  return `<div class="reader-seg">
    <button class="reader-seg-btn" id="${downId}" type="button">&minus;</button>
    <span class="reader-size-display" id="${displayId}">${val}</span>
    <button class="reader-seg-btn" id="${upId}" type="button">+</button>
  </div>`;
}

function slider(id, min, max, val) {
  return `<div class="reader-slider-row"><input type="range" id="${id}" min="${min}" max="${max}" value="${val}" class="reader-slider" aria-label="${id}"></div>`;
}

function toggleRow(id, label, checked) {
  return `<label class="ss-toggle-row" for="${id}">
    <span class="ss-toggle-label">${label}</span>
    <span class="ss-switch" aria-hidden="true">
      <input type="checkbox" id="${id}"${checked ? ' checked' : ''}>
      <span class="ss-switch-track"></span>
    </span>
  </label>`;
}

function pickerEl(prefix, label, unit) {
  return `<div class="ss-picker-wrap">
    <div class="ss-picker-label">${label}</div>
    <div class="picker">
      <div class="picker-display"><span id="${prefix}-value">0</span><span class="picker-unit">${unit}</span></div>
      <div class="strip-wrap">
        <div class="picker-strip" id="${prefix}-strip"><div class="picker-track" id="${prefix}-track"></div></div>
        <div class="picker-pointer"></div>
      </div>
    </div>
  </div>`;
}

// ── General tab ──────────────────────────────────────────────────────────────

function generalTabHTML(p) {
  const hasBg = !!localStorage.getItem(BG_IMAGE_STORAGE_KEY);
  return [
    section(t('sec.appearance')),
    row(t('lbl.theme'), renderThemePickerHTML('ss-gen-theme', [
      ['dark', t('theme.dark')], ['sepia', t('theme.sepia')], ['light', t('theme.light')], ['oled', t('theme.oled')],
      ['terminal', t('theme.terminal')], ['nebula', t('theme.nebula')], ['forest', t('theme.forest')],
      ['ember', t('theme.ember')], ['nord', t('theme.nord')],
    ], p.theme)),
    row(t('lbl.brightness'), slider('ss-gen-brightness', 30, 100, Math.round((p.brightness || 1) * 100))),
    row(t('lbl.warmth'), slider('ss-gen-warmth', 0, 100, Math.round((p.warmth || 0) * 100))),

    section(t('sec.background')),
    `<div class="ss-row ss-bg-upload-row">
      <span class="ss-label">${t('lbl.image')}</span>
      <div class="ss-bg-actions">
        <label class="ss-bg-upload-btn" for="ss-bg-file">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          ${t('lbl.upload')}
        </label>
        <input type="file" id="ss-bg-file" style="display:none">
        <button class="ss-bg-clear-btn" id="ss-bgClear" type="button"${hasBg ? '' : ' hidden'}>${t('lbl.clear')}</button>
      </div>
    </div>`,
    `<div class="ss-bg-opacity-row" id="ss-bgOpacityRow"${hasBg ? '' : ' hidden'}>`,
    row(t('lbl.imageOpacity'), slider('ss-bgOpacity', 0, 100, Math.round((p.bgImageOpacity ?? 1) * 100))),
    `</div>`,
    row(t('lbl.contentOpacity'), slider('ss-contentOpacity', 0, 100, Math.round((p.contentOpacity ?? 1) * 100))),

    section(t('sec.text')),
    row(t('lbl.outline'), seg('ss-textOutline', 'data-outline', [
      ['none', t('opt.off')], ['dark', t('opt.dark')], ['light', t('opt.light')],
    ], p.textOutline || 'none')),
  ].join('');
}

function wireGeneralTab(prefs, liveApply) {
  const themePickerHandle = mountThemePicker(byId('ss-gen-theme'), (val) => {
    prefs.data.theme = val; prefs.save();
    if (liveApply) liveApply('theme', val);
  });

  const fileInput = byId('ss-bg-file');
  const clearBtn  = byId('ss-bgClear');
  const opacityRow = byId('ss-bgOpacityRow');

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        alert(t('alert.chooseImage'));
        fileInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        try {
          localStorage.setItem(BG_IMAGE_STORAGE_KEY, dataUrl);
        } catch (_) {
          alert(t('alert.imageTooLarge'));
          fileInput.value = '';
          return;
        }
        if (clearBtn) clearBtn.hidden = false;
        if (opacityRow) opacityRow.hidden = false;
        if (liveApply) liveApply('_bgImage', dataUrl);
      };
      reader.readAsDataURL(file);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearBgImage(prefs);
      if (clearBtn) clearBtn.hidden = true;
      if (opacityRow) opacityRow.hidden = true;
      if (liveApply) liveApply('_bgImage', null);
    });
  }

  bindSlider('ss-bgOpacity', (v) => {
    prefs.data.bgImageOpacity = v / 100;
    prefs.save();
    if (liveApply) liveApply('bgImageOpacity', prefs.data.bgImageOpacity);
  }, true);

  bindSlider('ss-contentOpacity', (v) => {
    prefs.data.contentOpacity = v / 100;
    prefs.save();
    if (liveApply) liveApply('contentOpacity', prefs.data.contentOpacity);
  }, true);

  bindSlider('ss-gen-brightness', (v) => {
    prefs.data.brightness = v / 100;
    prefs.save();
    if (liveApply) liveApply('brightness', prefs.data.brightness);
  }, true);

  bindSlider('ss-gen-warmth', (v) => {
    prefs.data.warmth = v / 100;
    prefs.save();
    if (liveApply) liveApply('warmth', prefs.data.warmth);
  }, true);

  wireSeg('ss-textOutline', 'data-outline', (val) => {
    prefs.data.textOutline = val; prefs.save();
    if (liveApply) liveApply('textOutline', val);
  }, true);

  return themePickerHandle;
}

// ── Read tab ─────────────────────────────────────────────────────────────────

function readTabHTML(p) {
  return [
    section(t('sec.layout')),
    row(t('lbl.layout'), seg('ss-layout', 'data-layout', [['paginated', t('opt.paged')],['scroll', t('opt.scroll')]], p.layout)),
    row(t('lbl.columns'), seg('ss-cols', 'data-cols', [['auto', t('opt.auto')],['1','1'],['2','2']], String(p.columns))),
    row(t('lbl.pageTurn'), seg('ss-anim', 'data-anim', [['slide', t('opt.slide')],['fade', t('opt.fade')],['none', t('opt.none')]], p.pageAnim)),

    section(t('sec.content')),
    row(t('lbl.images'), seg('ss-images', 'data-images', [['true', t('opt.on')],['false', t('opt.off')]], String(p.images))),
    row(t('lbl.notePopovers'), seg('ss-notepop', 'data-notepop', [['true', t('opt.on')],['false', t('opt.off')]], String(p.notePopovers))),
    row(t('lbl.textSelection'), seg('ss-sel', 'data-sel', [['true', t('opt.on')],['false', t('opt.off')]], String(p.selection))),
    row(t('lbl.stylusTurnsPage'), seg('ss-pen', 'data-pen', [['false', t('opt.off')],['true', t('opt.on')]], String(p.penTurnsPage))),

    section(t('sec.typography')),
    row(t('lbl.textSize'), counter('ss-sizeDown', 'ss-sizeDisplay', 'ss-sizeUp', p.size)),
    row(t('lbl.typeface'), renderFontPickerHTML('ss-font', p.font)),
    row(t('lbl.margins'), seg('ss-margin', 'data-margin', [['none', t('opt.none')],['fine', t('opt.fine')],['narrow', t('opt.narrow')],['normal', t('opt.normal')],['wide', t('opt.wide')],['wider', t('opt.wider')]], p.margin)),
    row(t('lbl.lineSpacing'), counter('ss-lhDown', 'ss-lhDisplay', 'ss-lhUp', p.lineHeight.toFixed(1))),
    row(t('lbl.paragraphs'), seg('ss-para', 'data-para', [['indent', t('opt.indented')],['spaced', t('opt.spaced')],['both', t('opt.both')]], p.paraSpacing)),
    row(t('lbl.alignment'), seg('ss-align', 'data-align', [['justify', t('opt.justify')],['left', t('opt.left')]], p.align)),
  ].join('');
}

function wireReadTab(prefs, liveApply) {
  const fontHandle = mountFontPicker(byId('ss-font'), (val) => {
    prefs.data.font = val; prefs.save();
    if (liveApply) liveApply('font', val, true);
  });

  const SEGS = [
    { id: 'ss-margin', attr: 'data-margin', pref: 'margin',       repag: true  },
    { id: 'ss-para',   attr: 'data-para',   pref: 'paraSpacing',  repag: true  },
    { id: 'ss-align',  attr: 'data-align',  pref: 'align',        repag: true  },
    { id: 'ss-layout', attr: 'data-layout', pref: 'layout',       repag: true  },
    { id: 'ss-cols',   attr: 'data-cols',   pref: 'columns',      repag: true,  preview: true  },
    { id: 'ss-anim',   attr: 'data-anim',   pref: 'pageAnim',     repag: false },
    { id: 'ss-images', attr: 'data-images', pref: 'images',       repag: true,  xform: v => v === 'true' },
    { id: 'ss-notepop',attr: 'data-notepop',pref: 'notePopovers', repag: false, xform: v => v === 'true' },
    { id: 'ss-sel',    attr: 'data-sel',    pref: 'selection',    repag: false, xform: v => v === 'true' },
    { id: 'ss-pen',    attr: 'data-pen',    pref: 'penTurnsPage', repag: false, xform: v => v === 'true' },
  ];

  for (const s of SEGS) {
    const el = byId(s.id);
    if (!el) continue;

    const applyVal = (btn) => {
      const raw = btn.getAttribute(s.attr);
      const val = s.xform ? s.xform(raw) : raw;
      prefs.data[s.pref] = val;
      prefs.save();
      el.querySelectorAll('.reader-seg-btn').forEach(b => {
        const active = b.getAttribute(s.attr) === String(val);
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      if (liveApply) liveApply(s.pref, val, s.repag);
    };

    if (s.preview) {
      let _timer = null;
      let _appliedByPointer = false;

      el.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest(`[${s.attr}]`);
        if (!btn) return;
        applyVal(btn);
        _appliedByPointer = true;
        clearTimeout(_timer);
        _timer = setTimeout(() => { _timer = null; _startPreview(); }, 500);
      });

      const _cancel = () => {
        clearTimeout(_timer);
        _timer = null;
        _endPreview();
      };
      el.addEventListener('pointerup', _cancel);
      el.addEventListener('pointercancel', _cancel);

      el.addEventListener('click', (e) => {
        if (_appliedByPointer) { _appliedByPointer = false; return; }
        const btn = e.target.closest(`[${s.attr}]`);
        if (btn) applyVal(btn);
      });
    } else {
      el.addEventListener('click', (e) => {
        const btn = e.target.closest(`[${s.attr}]`);
        if (btn) applyVal(btn);
      });
    }
  }

  bindCounter('ss-sizeDown', 'ss-sizeUp', 'ss-sizeDisplay',
    () => prefs.data.size,
    (next) => { prefs.data.size = next; prefs.save(); if (liveApply) liveApply('size', next, true); },
    -2, 2, MIN_SIZE, MAX_SIZE
  );

  bindCounter('ss-lhDown', 'ss-lhUp', 'ss-lhDisplay',
    () => prefs.data.lineHeight,
    (next) => { prefs.data.lineHeight = next; prefs.save(); if (liveApply) liveApply('lineHeight', next, true); },
    -0.1, 0.1, 1.0, 2.4,
    (v) => v.toFixed(1)
  );

  return fontHandle;
}

// ── Speed tab (RSVP) ─────────────────────────────────────────────────────────

function speedTabHTML(p) {
  return [
    section(t('sec.appearance')),
    row(t('lbl.font'), renderFontPickerHTML('ss-rsvp-font', p.font)),

    section(t('sec.display')),
    row(t('lbl.flashSize'), seg('ss-chunk', 'data-chunk', [['1', t('opt.word1')],['2', t('opt.words2')],['3', t('opt.words3')]], String(p.chunkSize))),
    pickerEl('ss-fontSize', t('lbl.fontSize'), t('unit.px')),

    section(t('sec.timing')),
    pickerEl('ss-len', t('lbl.longWordScaling'), t('unit.strength')),
    pickerEl('ss-comma', t('lbl.commaPause'), t('unit.commaPct')),
    pickerEl('ss-period', t('lbl.periodPause'), t('unit.periodPct')),
    pickerEl('ss-parapause', t('lbl.paragraphPause'), t('unit.paraPct')),

    section(t('sec.behavior')),
    toggleRow('ss-startPaused',  t('toggle.startPaused'),  p.startPaused),
    toggleRow('ss-countdown',    t('toggle.countdown'),    p.countdownEnabled),
    toggleRow('ss-context',      t('toggle.contextPage'),  p.contextEnabled),
    toggleRow('ss-autoPause',    t('toggle.pauseHidden'),  p.autoPauseEnabled),

    section(t('sec.training')),
    toggleRow('ss-training', t('toggle.trainingRamp'), p.trainingEnabled),
    `<div class="ss-training-opts" id="ss-trainingOpts"${p.trainingEnabled ? '' : ' hidden'}>`,
    pickerEl('ss-trainInc',  t('lbl.wpmPerBump'),   t('unit.wpmBump')),
    pickerEl('ss-trainInt',  t('lbl.wordsPerBump'), t('unit.wordsBump')),
    pickerEl('ss-trainCeil', t('lbl.maxWpm'),       t('unit.maxWpm')),
    `</div>`,

    `<div class="ss-actions"><button class="ui-chip" id="ss-resetStats" type="button">${t('btn.resetStats')}</button></div>`,
  ].join('');
}

function wireSpeedTab(prefs, liveApply) {
  const pickers = [];

  const fontHandle = mountFontPicker(byId('ss-rsvp-font'), (val) => {
    prefs.data.font = val; prefs.save();
    if (liveApply) liveApply('font', val);
  });

  wireSeg('ss-chunk', 'data-chunk', (val) => {
    const n = parseInt(val, 10);
    prefs.data.chunkSize = n; prefs.save();
    if (liveApply) liveApply('chunkSize', n);
  });

  pickers.push(createPicker({
    stripId: 'ss-fontSize-strip', trackId: 'ss-fontSize-track', valueId: 'ss-fontSize-value',
    min: 24, max: 96, step: 4, majorEvery: 16,
    initial: prefs.data.fontSize,
    onChange: (v) => { prefs.data.fontSize = v; prefs.save(); if (liveApply) liveApply('fontSize', v); },
  }));

  pickers.push(createPicker({
    stripId: 'ss-len-strip', trackId: 'ss-len-track', valueId: 'ss-len-value',
    min: 0, max: 100, step: 5, majorEvery: 25,
    initial: prefs.data.lengthStrength,
    onChange: (v) => { prefs.data.lengthStrength = v; prefs.save(); if (liveApply) liveApply('lengthStrength', v); },
  }));

  pickers.push(createPicker({
    stripId: 'ss-comma-strip', trackId: 'ss-comma-track', valueId: 'ss-comma-value',
    min: 0, max: 200, step: 10, majorEvery: 50,
    initial: prefs.data.commaPause,
    onChange: (v) => { prefs.data.commaPause = v; prefs.save(); if (liveApply) liveApply('commaPause', v); },
  }));

  pickers.push(createPicker({
    stripId: 'ss-period-strip', trackId: 'ss-period-track', valueId: 'ss-period-value',
    min: 0, max: 300, step: 10, majorEvery: 100,
    initial: prefs.data.periodPause,
    onChange: (v) => { prefs.data.periodPause = v; prefs.save(); if (liveApply) liveApply('periodPause', v); },
  }));

  pickers.push(createPicker({
    stripId: 'ss-parapause-strip', trackId: 'ss-parapause-track', valueId: 'ss-parapause-value',
    min: 0, max: 400, step: 10, majorEvery: 100,
    initial: prefs.data.paraPause,
    onChange: (v) => { prefs.data.paraPause = v; prefs.save(); if (liveApply) liveApply('paraPause', v); },
  }));

  bindToggle('ss-startPaused', (val) => {
    prefs.data.startPaused = val; prefs.save();
    if (liveApply) liveApply('startPaused', val);
  });

  bindToggle('ss-countdown', (val) => {
    prefs.data.countdownEnabled = val; prefs.save();
    if (liveApply) liveApply('countdownEnabled', val);
  });

  bindToggle('ss-context', (val) => {
    prefs.data.contextEnabled = val; prefs.save();
    if (liveApply) liveApply('contextEnabled', val);
  });

  bindToggle('ss-autoPause', (val) => {
    prefs.data.autoPauseEnabled = val; prefs.save();
    if (liveApply) liveApply('autoPauseEnabled', val);
  });

  // Training pickers (created lazily when section is shown)
  let trainPickers = null;

  function ensureTrainPickers() {
    if (trainPickers) return;
    trainPickers = [];
    trainPickers.push(createPicker({
      stripId: 'ss-trainInc-strip', trackId: 'ss-trainInc-track', valueId: 'ss-trainInc-value',
      min: 5, max: 50, step: 5, majorEvery: 10,
      initial: prefs.data.trainingIncrement,
      onChange: (v) => { prefs.data.trainingIncrement = v; prefs.save(); if (liveApply) liveApply('trainingIncrement', v); },
    }));
    trainPickers.push(createPicker({
      stripId: 'ss-trainInt-strip', trackId: 'ss-trainInt-track', valueId: 'ss-trainInt-value',
      min: 100, max: 2000, step: 100, majorEvery: 500,
      initial: prefs.data.trainingInterval,
      onChange: (v) => { prefs.data.trainingInterval = v; prefs.save(); if (liveApply) liveApply('trainingInterval', v); },
    }));
    trainPickers.push(createPicker({
      stripId: 'ss-trainCeil-strip', trackId: 'ss-trainCeil-track', valueId: 'ss-trainCeil-value',
      min: 200, max: 800, step: 25, majorEvery: 100,
      initial: prefs.data.trainingCeiling,
      onChange: (v) => { prefs.data.trainingCeiling = v; prefs.save(); if (liveApply) liveApply('trainingCeiling', v); },
    }));
    pickers.push(...trainPickers);
  }

  if (prefs.data.trainingEnabled) ensureTrainPickers();

  bindToggle('ss-training', (val) => {
    prefs.data.trainingEnabled = val; prefs.save();
    const opts = byId('ss-trainingOpts');
    if (opts) {
      opts.hidden = !val;
      if (val) {
        ensureTrainPickers();
        requestAnimationFrame(() => trainPickers && trainPickers.forEach(p => p.relayout()));
      }
    }
    if (liveApply) liveApply('trainingEnabled', val);
  });

  const resetBtn = byId('ss-resetStats');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (liveApply) liveApply('_resetStats', true);
    });
  }

  return { pickers, fontHandle };
}

// ── Listen tab (TTS) ─────────────────────────────────────────────────────────

function listenTabHTML(p) {
  return [
    section(t('sec.playback')),
    row(t('lbl.highlight'), seg('ss-tts-hl', 'data-hl', [['word', t('opt.hlWord')],['sentence', t('opt.hlSentence')],['paragraph', t('opt.hlPara')],['off', t('opt.hlOff')]], p.highlightMode || 'sentence')),
    toggleRow('ss-tts-autoScroll', t('toggle.autoScroll'), p.autoScroll !== false),

    section(t('sec.typography')),
    row(t('lbl.textSize'), counter('ss-tts-sizeDown', 'ss-tts-sizeDisplay', 'ss-tts-sizeUp', p.size)),
    row(t('lbl.typeface'), renderFontPickerHTML('ss-tts-font', p.font)),
    row(t('lbl.margins'), seg('ss-tts-margin', 'data-margin', [['fine', t('opt.fine')],['narrow', t('opt.narrow')],['normal', t('opt.normal')],['wide', t('opt.wide')]], p.margin || 'normal')),
    row(t('lbl.lineSpacing'), counter('ss-tts-lhDown', 'ss-tts-lhDisplay', 'ss-tts-lhUp', p.lineHeight.toFixed(1))),
  ].join('');
}

function wireListenTab(prefs, liveApply) {
  const fontHandle = mountFontPicker(byId('ss-tts-font'), (val) => {
    prefs.data.font = val; prefs.save();
    if (liveApply) liveApply('font', val);
  });

  wireSeg('ss-tts-margin', 'data-margin', (val) => {
    prefs.data.margin = val; prefs.save();
    if (liveApply) liveApply('margin', val);
  });

  wireSeg('ss-tts-hl', 'data-hl', (val) => {
    prefs.data.highlightMode = val; prefs.save();
    if (liveApply) liveApply('highlightMode', val);
  });

  bindCounter('ss-tts-sizeDown', 'ss-tts-sizeUp', 'ss-tts-sizeDisplay',
    () => prefs.data.size,
    (next) => { prefs.data.size = next; prefs.save(); if (liveApply) liveApply('size', next); },
    -2, 2, MIN_SIZE, MAX_SIZE
  );

  bindCounter('ss-tts-lhDown', 'ss-tts-lhUp', 'ss-tts-lhDisplay',
    () => prefs.data.lineHeight,
    (next) => { prefs.data.lineHeight = next; prefs.save(); if (liveApply) liveApply('lineHeight', next); },
    -0.1, 0.1, 1.0, 2.4,
    (v) => v.toFixed(1)
  );

  bindToggle('ss-tts-autoScroll', (val) => {
    prefs.data.autoScroll = val; prefs.save();
    if (liveApply) liveApply('autoScroll', val);
  });

  return fontHandle;
}

// ── Dictionaries tab ─────────────────────────────────────────────────────────

function fmtBytes(n) {
  if (!n) return '';
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

// Builds the offline-dictionary manager: a list of available dictionaries the
// user can download (and later delete), plus a "Download all". Data lives in
// IndexedDB via DictionaryManager; the UI just drives it. Renders asynchronously
// because the catalog and installed state are fetched on open.
async function wireDictTab(root) {
  if (!root) return;
  let catalog, installedSet;
  try {
    [catalog, installedSet] = await Promise.all([dictionaries.catalog(), dictionaries.installed()]);
  } catch (e) {
    if (root.isConnected) root.innerHTML = `<div class="ss-dict-empty">${t('dict.cantLoadCatalog')}</div>`;
    return;
  }
  if (!root.isConnected) return;

  const installed = new Set(installedSet);
  const busy = new Set();

  function rowFor(d) {
    const el = document.createElement('div');
    el.className = 'ss-dict-row';
    el.dataset.dict = d.id;
    render(el, d);
    return el;
  }

  function render(el, d) {
    const isIn = installed.has(d.id);
    const isBusy = busy.has(d.id);
    el.innerHTML = `
      <div class="ss-dict-info">
        <div class="ss-dict-name">${d.name}${isIn ? ` <span class="ss-dict-badge">${t('dict.downloaded')}</span>` : ''}</div>
        <div class="ss-dict-desc">${d.description || ''}</div>
        <div class="ss-dict-meta">${t('dict.wordsMeta', { n: (d.words || 0).toLocaleString() })} · ${fmtBytes(d.bytes)} · ${d.license || ''}</div>
      </div>
      <div class="ss-dict-action"></div>`;
    const action = el.querySelector('.ss-dict-action');
    if (isBusy) {
      const prog = document.createElement('div');
      prog.className = 'ss-dict-progress';
      prog.textContent = '0%';
      action.appendChild(prog);
    } else if (isIn) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ss-dict-btn ss-dict-del';
      del.textContent = t('dict.delete');
      del.addEventListener('click', () => doRemove(d, el));
      action.appendChild(del);
    } else {
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'ss-dict-btn ss-dict-dl';
      dl.textContent = t('dict.download');
      dl.addEventListener('click', () => doDownload(d, el));
      action.appendChild(dl);
    }
  }

  async function doDownload(d, el) {
    busy.add(d.id);
    render(el, d);
    syncDownloadAll();
    const prog = el.querySelector('.ss-dict-progress');
    try {
      await dictionaries.download(d.id, ({ bytes, totalBytes }) => {
        if (prog && prog.isConnected) prog.textContent = Math.round((bytes / (totalBytes || 1)) * 100) + '%';
      });
      installed.add(d.id);
    } catch (e) {
      console.warn('dict:download', e);
      if (el.isConnected) { const a = el.querySelector('.ss-dict-action'); if (a) a.textContent = t('dict.failedRetry'); }
    } finally {
      busy.delete(d.id);
      if (el.isConnected) render(el, d);
      syncDownloadAll();
    }
  }

  async function doRemove(d, el) {
    try { await dictionaries.remove(d.id); installed.delete(d.id); }
    catch (e) { console.warn('dict:remove', e); }
    if (el.isConnected) render(el, d);
    syncDownloadAll();
  }

  // Layout: a "Download all" header button, then one row per dictionary, then
  // the attribution footer.
  root.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'ss-dict-head';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'ss-dict-btn ss-dict-all';
  head.appendChild(allBtn);
  root.appendChild(head);

  const list = document.createElement('div');
  list.className = 'ss-dict-list';
  const rows = new Map();
  // Group dictionaries under a language heading (BCP 47 lang key), in catalog
  // order, so multiple dictionaries per language sit together.
  let lastLang = null;
  for (const d of catalog) {
    const lang = d.lang || 'und';
    if (lang !== lastLang) {
      const lh = document.createElement('div');
      lh.className = 'ss-dict-lang';
      lh.textContent = languageName(lang);
      list.appendChild(lh);
      lastLang = lang;
    }
    const el = rowFor(d);
    rows.set(d.id, el);
    list.appendChild(el);
  }
  root.appendChild(list);

  const foot = document.createElement('div');
  foot.className = 'ss-dict-foot';
  foot.innerHTML = t('dict.foot');
  root.appendChild(foot);

  function syncDownloadAll() {
    const remaining = catalog.filter((d) => !installed.has(d.id) && !busy.has(d.id));
    const anyBusy = busy.size > 0;
    allBtn.disabled = anyBusy || remaining.length === 0;
    allBtn.textContent = anyBusy ? t('dict.downloading')
      : remaining.length === 0 ? t('dict.allDownloaded')
      : t('dict.downloadAll', { size: fmtBytes(remaining.reduce((s, d) => s + (d.bytes || 0), 0)) });
  }
  allBtn.addEventListener('click', async () => {
    for (const d of catalog) {
      if (!installed.has(d.id) && !busy.has(d.id)) await doDownload(d, rows.get(d.id));
    }
  });
  syncDownloadAll();
}

// ── Shared wiring helpers ────────────────────────────────────────────────────

function wireSeg(id, attr, onChange, enablePreview) {
  const el = byId(id);
  if (!el) return;

  function applyVal(btn) {
    const val = btn.getAttribute(attr);
    el.querySelectorAll('.reader-seg-btn').forEach(b => {
      const active = b.getAttribute(attr) === val;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    onChange(val);
  }

  if (enablePreview) {
    let _timer = null;
    let _appliedByPointer = false;

    el.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest(`[${attr}]`);
      if (!btn) return;
      applyVal(btn);
      _appliedByPointer = true;
      clearTimeout(_timer);
      _timer = setTimeout(() => { _timer = null; _startPreview(); }, 500);
    });

    const _cancel = () => {
      clearTimeout(_timer);
      _timer = null;
      _endPreview();
    };
    el.addEventListener('pointerup', _cancel);
    el.addEventListener('pointercancel', _cancel);

    // Keyboard/programmatic click fallback — skip if already applied via pointer
    el.addEventListener('click', (e) => {
      if (_appliedByPointer) { _appliedByPointer = false; return; }
      const btn = e.target.closest(`[${attr}]`);
      if (btn) applyVal(btn);
    });
  } else {
    el.addEventListener('click', (e) => {
      const btn = e.target.closest(`[${attr}]`);
      if (btn) applyVal(btn);
    });
  }
}

function bindSlider(id, onChange, enablePreview) {
  const el = byId(id);
  if (!el) return;
  el.addEventListener('input', (e) => onChange(parseInt(e.target.value, 10)));
  if (enablePreview) {
    el.addEventListener('pointerdown', _startPreview);
    el.addEventListener('pointerup', _endPreview);
    el.addEventListener('pointercancel', _endPreview);
  }
}

function bindToggle(id, onChange) {
  const el = byId(id);
  if (el) el.addEventListener('change', (e) => onChange(e.target.checked));
}

function bindCounter(downId, upId, displayId, getVal, setVal, downStep, upStep, min, max, fmt) {
  const display = byId(displayId);
  const downBtn = byId(downId);
  const upBtn = byId(upId);
  if (!downBtn || !upBtn) return;
  const format = fmt || ((v) => String(v));
  downBtn.addEventListener('click', () => {
    const next = Math.round(Math.max(min, getVal() + downStep) * 100) / 100;
    if (next === getVal()) return;
    setVal(next);
    if (display) display.textContent = format(next);
  });
  upBtn.addEventListener('click', () => {
    const next = Math.round(Math.min(max, getVal() + upStep) * 100) / 100;
    if (next === getVal()) return;
    setVal(next);
    if (display) display.textContent = format(next);
  });
}
