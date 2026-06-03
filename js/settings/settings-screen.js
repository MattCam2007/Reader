import { DEFAULT_PREFS, MIN_SIZE, MAX_SIZE, GENERAL_DEFAULTS, ALL_THEME_NAMES } from '../core/constants.js';
import { RSVP_DEFAULTS } from '../rsvp/constants.js';
import { TTS_DEFAULTS } from '../tts/constants.js';
import { PrefsManager } from '../core/prefs.js';
import { createPicker } from '../shared/picker.js';

let _screen = null;
let _cleanup = null;

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

// ── Public API ───────────────────────────────────────────────────────────────

export function openSettingsScreen(config = {}) {
  if (_screen) return;

  const {
    initialTab = 'read',
    currentMode = 'read',
    onGeneralChange = null,  // fn(key, value)
    onReaderChange = null,   // fn(key, value, needsRepaginate)
    onRsvpChange = null,     // fn(key, value)
    onTtsChange = null,      // fn(key, value)
  } = config;

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
  _screen.setAttribute('aria-label', 'Settings');
  _screen.innerHTML = `
    <div class="sscreen-header">
      <button class="sscreen-close" type="button" aria-label="Close settings">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15,18 9,12 15,6"/>
        </svg>
      </button>
      <span class="sscreen-title">Settings</span>
    </div>
    <nav class="sscreen-tabs" role="tablist" aria-label="Mode settings">
      <button class="sscreen-tab" role="tab" data-tab="general" type="button">General</button>
      <button class="sscreen-tab" role="tab" data-tab="read" type="button">Read</button>
      <button class="sscreen-tab" role="tab" data-tab="rsvp" type="button">Speed</button>
      <button class="sscreen-tab" role="tab" data-tab="tts" type="button">Listen</button>
    </nav>
    <div class="sscreen-body" id="sscreenBody" role="tabpanel"></div>`;

  document.body.appendChild(_screen);
  requestAnimationFrame(() => _screen && _screen.classList.add('sscreen--open'));

  let rsvpPickers = null;

  function showTab(tab) {
    _screen.querySelectorAll('.sscreen-tab').forEach(t => {
      const active = t.dataset.tab === tab;
      t.classList.toggle('sscreen-tab--active', active);
      t.setAttribute('aria-selected', String(active));
    });

    if (rsvpPickers) {
      rsvpPickers.forEach(p => p && p.destroy && p.destroy());
      rsvpPickers = null;
    }

    const body = document.getElementById('sscreenBody');
    if (!body) return;

    if (tab === 'general') {
      body.innerHTML = generalTabHTML(generalPrefs.data);
      wireGeneralTab(generalPrefs, onGeneralChange);
    } else if (tab === 'read') {
      body.innerHTML = readTabHTML(readerPrefs.data);
      wireReadTab(readerPrefs, currentMode === 'read' ? onReaderChange : null);
    } else if (tab === 'rsvp') {
      body.innerHTML = speedTabHTML(rsvpPrefs.data);
      rsvpPickers = wireSpeedTab(rsvpPrefs, currentMode === 'rsvp' ? onRsvpChange : null);
    } else if (tab === 'tts') {
      body.innerHTML = listenTabHTML(ttsPrefs.data);
      wireListenTab(ttsPrefs, currentMode === 'tts' ? onTtsChange : null);
    }
  }

  _screen.querySelectorAll('.sscreen-tab').forEach(t => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  });

  showTab(initialTab);

  _screen.querySelector('.sscreen-close').addEventListener('click', closeSettingsScreen);

  const onKey = (e) => { if (e.key === 'Escape') closeSettingsScreen(); };
  document.addEventListener('keydown', onKey);

  _cleanup = () => {
    document.removeEventListener('keydown', onKey);
    if (rsvpPickers) { rsvpPickers.forEach(p => p && p.destroy && p.destroy()); rsvpPickers = null; }
  };
}

export function closeSettingsScreen() {
  if (!_screen) return;
  const el = _screen;
  _screen = null;
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
  return [
    section('Appearance'),
    row('Theme', seg('ss-gen-theme', 'data-theme', [
      ['dark','Dark'],['sepia','Sepia'],['light','Light'],['oled','OLED'],
      ['terminal','Terminal'],['nebula','Nebula'],['forest','Forest'],
      ['ember','Ember'],['nord','Nord'],
    ], p.theme)),
  ].join('');
}

function wireGeneralTab(prefs, liveApply) {
  wireSeg('ss-gen-theme', 'data-theme', (val) => {
    prefs.data.theme = val; prefs.save();
    if (liveApply) liveApply('theme', val);
  });
}

// ── Read tab ─────────────────────────────────────────────────────────────────

function readTabHTML(p) {
  return [
    section('Appearance'),
    row('Brightness', slider('ss-brightness', 30, 100, Math.round((p.brightness || 1) * 100))),
    row('Warmth', slider('ss-warmth', 0, 100, Math.round((p.warmth || 0) * 100))),
    row('Text size', counter('ss-sizeDown', 'ss-sizeDisplay', 'ss-sizeUp', p.size)),
    row('Typeface', seg('ss-font', 'data-font', [['serif','Serif'],['sans','Sans'],['dyslexic','Dyslexic']], p.font)),

    section('Layout'),
    row('Margins', seg('ss-margin', 'data-margin', [['narrow','Narrow'],['normal','Normal'],['wide','Wide']], p.margin)),
    row('Line spacing', counter('ss-lhDown', 'ss-lhDisplay', 'ss-lhUp', p.lineHeight.toFixed(1))),
    row('Paragraphs', seg('ss-para', 'data-para', [['indent','Indented'],['spaced','Spaced']], p.paraSpacing)),
    row('Alignment', seg('ss-align', 'data-align', [['justify','Justify'],['left','Left']], p.align)),
    row('Layout', seg('ss-layout', 'data-layout', [['paginated','Paged'],['scroll','Scroll']], p.layout)),
    row('Columns', seg('ss-cols', 'data-cols', [['auto','Auto'],['1','1'],['2','2']], String(p.columns))),
    row('Page turn', seg('ss-anim', 'data-anim', [['slide','Slide'],['fade','Fade'],['none','None']], p.pageAnim)),

    section('Content'),
    row('Images', seg('ss-images', 'data-images', [['true','On'],['false','Off']], String(p.images))),
    row('Note popovers', seg('ss-notepop', 'data-notepop', [['true','On'],['false','Off']], String(p.notePopovers))),
    row('Text selection', seg('ss-sel', 'data-sel', [['true','On'],['false','Off']], String(p.selection))),
  ].join('');
}

function wireReadTab(prefs, liveApply) {
  const SEGS = [
    { id: 'ss-font',   attr: 'data-font',   pref: 'font',         repag: true  },
    { id: 'ss-margin', attr: 'data-margin', pref: 'margin',       repag: true  },
    { id: 'ss-para',   attr: 'data-para',   pref: 'paraSpacing',  repag: true  },
    { id: 'ss-align',  attr: 'data-align',  pref: 'align',        repag: true  },
    { id: 'ss-layout', attr: 'data-layout', pref: 'layout',       repag: true  },
    { id: 'ss-cols',   attr: 'data-cols',   pref: 'columns',      repag: true  },
    { id: 'ss-anim',   attr: 'data-anim',   pref: 'pageAnim',     repag: false },
    { id: 'ss-images', attr: 'data-images', pref: 'images',       repag: true,  xform: v => v === 'true' },
    { id: 'ss-notepop',attr: 'data-notepop',pref: 'notePopovers', repag: false, xform: v => v === 'true' },
    { id: 'ss-sel',    attr: 'data-sel',    pref: 'selection',    repag: false, xform: v => v === 'true' },
  ];

  for (const s of SEGS) {
    const el = document.getElementById(s.id);
    if (!el) continue;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest(`[${s.attr}]`);
      if (!btn) return;
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
    });
  }

  bindSlider('ss-brightness', (v) => {
    prefs.data.brightness = v / 100;
    prefs.save();
    if (liveApply) liveApply('brightness', prefs.data.brightness, false);
  });

  bindSlider('ss-warmth', (v) => {
    prefs.data.warmth = v / 100;
    prefs.save();
    if (liveApply) liveApply('warmth', prefs.data.warmth, false);
  });

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
}

// ── Speed tab (RSVP) ─────────────────────────────────────────────────────────

function speedTabHTML(p) {
  return [
    section('Appearance'),
    row('Font', seg('ss-rsvp-font', 'data-font', [['sans','Sans'],['serif','Serif'],['mono','Mono'],['dyslexic','Dyslexic']], p.font)),

    section('Display'),
    row('Flash size', seg('ss-chunk', 'data-chunk', [['1','1 word'],['2','2 words'],['3','3 words']], String(p.chunkSize))),
    pickerEl('ss-fontSize', 'Font size', 'PX'),

    section('Timing'),
    pickerEl('ss-len', 'Long word scaling', 'STRENGTH'),
    pickerEl('ss-comma', 'Comma pause', 'COMMA %'),
    pickerEl('ss-period', 'Period pause', 'PERIOD %'),
    pickerEl('ss-parapause', 'Paragraph pause', 'PARA %'),

    section('Behavior'),
    toggleRow('ss-startPaused',  'Start paused on load',       p.startPaused),
    toggleRow('ss-countdown',    'Countdown before resume',     p.countdownEnabled),
    toggleRow('ss-context',      'Show context page',           p.contextEnabled),
    toggleRow('ss-autoPause',    'Pause when tab hidden',       p.autoPauseEnabled),

    section('Training'),
    toggleRow('ss-training', 'WPM training ramp', p.trainingEnabled),
    `<div class="ss-training-opts" id="ss-trainingOpts"${p.trainingEnabled ? '' : ' hidden'}>`,
    pickerEl('ss-trainInc',  'WPM per bump',  'WPM / BUMP'),
    pickerEl('ss-trainInt',  'Words per bump','WORDS / BUMP'),
    pickerEl('ss-trainCeil', 'Max WPM',       'MAX WPM'),
    `</div>`,

    `<div class="ss-actions"><button class="ui-chip" id="ss-resetStats" type="button">Reset Session Stats</button></div>`,
  ].join('');
}

function wireSpeedTab(prefs, liveApply) {
  const pickers = [];

  wireSeg('ss-rsvp-font', 'data-font', (val) => {
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
    const opts = document.getElementById('ss-trainingOpts');
    if (opts) {
      opts.hidden = !val;
      if (val) {
        ensureTrainPickers();
        requestAnimationFrame(() => trainPickers && trainPickers.forEach(p => p.relayout()));
      }
    }
    if (liveApply) liveApply('trainingEnabled', val);
  });

  const resetBtn = document.getElementById('ss-resetStats');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (liveApply) liveApply('_resetStats', true);
    });
  }

  return pickers;
}

// ── Listen tab (TTS) ─────────────────────────────────────────────────────────

function listenTabHTML(p) {
  return [
    section('Appearance'),
    row('Brightness', slider('ss-tts-brightness', 30, 100, Math.round((p.brightness || 1) * 100))),
    row('Warmth', slider('ss-tts-warmth', 0, 100, Math.round((p.warmth || 0) * 100))),
    row('Text size', counter('ss-tts-sizeDown', 'ss-tts-sizeDisplay', 'ss-tts-sizeUp', p.size)),
    row('Typeface', seg('ss-tts-font', 'data-font', [['serif','Serif'],['sans','Sans'],['dyslexic','Dyslexic']], p.font)),

    section('Layout'),
    row('Margins', seg('ss-tts-margin', 'data-margin', [['narrow','Narrow'],['normal','Normal'],['wide','Wide']], p.margin || 'normal')),
    row('Line spacing', counter('ss-tts-lhDown', 'ss-tts-lhDisplay', 'ss-tts-lhUp', p.lineHeight.toFixed(1))),

    section('Playback'),
    row('Highlight', seg('ss-tts-hl', 'data-hl', [['word','Word'],['sentence','Sentence'],['paragraph','Para'],['off','Off']], p.highlightMode || 'sentence')),
    toggleRow('ss-tts-autoScroll', 'Auto-scroll to highlighted text', p.autoScroll !== false),
  ].join('');
}

function wireListenTab(prefs, liveApply) {
  wireSeg('ss-tts-font', 'data-font', (val) => {
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

  bindSlider('ss-tts-brightness', (v) => {
    prefs.data.brightness = v / 100; prefs.save();
    if (liveApply) liveApply('brightness', prefs.data.brightness);
  });

  bindSlider('ss-tts-warmth', (v) => {
    prefs.data.warmth = v / 100; prefs.save();
    if (liveApply) liveApply('warmth', prefs.data.warmth);
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
}

// ── Shared wiring helpers ────────────────────────────────────────────────────

function wireSeg(id, attr, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest(`[${attr}]`);
    if (!btn) return;
    const val = btn.getAttribute(attr);
    el.querySelectorAll('.reader-seg-btn').forEach(b => {
      const active = b.getAttribute(attr) === val;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    onChange(val);
  });
}

function bindSlider(id, onChange) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', (e) => onChange(parseInt(e.target.value, 10)));
}

function bindToggle(id, onChange) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', (e) => onChange(e.target.checked));
}

function bindCounter(downId, upId, displayId, getVal, setVal, downStep, upStep, min, max, fmt) {
  const display = document.getElementById(displayId);
  const downBtn = document.getElementById(downId);
  const upBtn = document.getElementById(upId);
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
