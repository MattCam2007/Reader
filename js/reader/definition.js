import { dictionaries, DictionaryManager, languageName } from '../core/dictionary.js';
import { t } from '../core/i18n.js';

// In-app definition popover shown from the selection bar's "Define" action.
// Looks the word up across the user's installed offline dictionaries and renders
// the result anchored to the selection — never leaving the reader. A link out to
// Wiktionary is always offered as a fallback (and is the only option when no
// dictionary is installed or the word isn't found).
export class DefinitionPopover {
  constructor(signal, hooks = {}) {
    this._signal = signal;
    this._hooks = hooks;   // { onManage(): open the dictionary manager }
    this._pop = null;
    this._token = 0;       // guards against a stale async lookup painting late
    document.addEventListener('pointerdown', (e) => {
      if (this._pop && !this._pop.contains(e.target)) this.dismiss();
    }, { signal });
  }

  async show(rawText, anchorRect) {
    this.dismiss();
    const word = DictionaryManager.normalizeQuery(rawText);
    if (!word) return;
    const token = ++this._token;

    const pop = document.createElement('div');
    pop.className = 'reader-def-popover';
    pop.innerHTML = `<div class="def-head"><span class="def-word"></span></div>
      <div class="def-body"><div class="def-loading">${t('def.lookingUp')}</div></div>`;
    pop.querySelector('.def-word').textContent = word;
    document.body.appendChild(pop);
    this._pop = pop;
    this._place(anchorRect);

    let results = [];
    try {
      results = await dictionaries.lookup(word);
    } catch (e) {
      console.warn('definition:lookup', e);
    }
    if (token !== this._token) return;  // superseded by a newer lookup
    if (this._pop !== pop) return;

    const installed = await dictionaries.installed();
    if (token !== this._token || this._pop !== pop) return;

    pop.querySelector('.def-word').textContent = results[0] ? results[0].word : word;
    pop.querySelector('.def-body').replaceWith(this._renderBody(word, results, installed.size));
    this._place(anchorRect);
  }

  _renderBody(word, results, installedCount) {
    const body = document.createElement('div');
    body.className = 'def-body';

    if (results.length) {
      // Group by language so multilingual matches stay visually separated;
      // the language header only appears when more than one language matched.
      const langs = [...new Set(results.map((r) => r.lang))];
      let lastLang = null;
      for (const r of results) {
        if (langs.length > 1 && r.lang !== lastLang) {
          const lh = document.createElement('div');
          lh.className = 'def-lang';
          lh.textContent = languageName(r.lang);
          body.appendChild(lh);
          lastLang = r.lang;
        }
        const block = document.createElement('div');
        block.className = 'def-dict';
        const src = document.createElement('div');
        src.className = 'def-source';
        src.textContent = r.name;
        block.appendChild(src);
        const ol = document.createElement('ol');
        ol.className = 'def-senses';
        for (const s of r.senses.slice(0, 12)) {
          const li = document.createElement('li');
          if (s.p) {
            const pos = document.createElement('span');
            pos.className = 'def-pos';
            pos.textContent = s.p;
            li.appendChild(pos);
          }
          li.appendChild(document.createTextNode(s.d));
          if (s.e) {
            const ex = document.createElement('div');
            ex.className = 'def-example';
            ex.textContent = '“' + s.e + '”';
            li.appendChild(ex);
          }
          if (Array.isArray(s.y) && s.y.length) {
            const syn = document.createElement('div');
            syn.className = 'def-syn';
            syn.textContent = t('def.synPrefix') + ' ' + s.y.join(', ');
            li.appendChild(syn);
          }
          ol.appendChild(li);
        }
        block.appendChild(ol);
        body.appendChild(block);
      }
    } else {
      const msg = document.createElement('div');
      msg.className = 'def-empty';
      if (installedCount === 0) {
        msg.textContent = t('def.noDictionaries');
        if (this._hooks.onManage) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'def-manage';
          btn.textContent = t('def.manageDictionaries');
          btn.addEventListener('click', () => { this.dismiss(); this._hooks.onManage(); });
          msg.appendChild(document.createElement('br'));
          msg.appendChild(btn);
        }
      } else {
        msg.textContent = t('def.noDefinition', { word });
      }
      body.appendChild(msg);
    }

    // Always offer the external fallback.
    const foot = document.createElement('div');
    foot.className = 'def-foot';
    const link = document.createElement('a');
    link.href = 'https://en.wiktionary.org/wiki/' + encodeURIComponent(word);
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'def-wiktionary';
    link.textContent = t('def.wiktionary');
    foot.appendChild(link);
    body.appendChild(foot);

    return body;
  }

  // Anchor the popover above the selection, flipping below and clamping to the
  // viewport — mirrors the selection bar's placement (js/reader/selection.js).
  _place(rect) {
    if (!this._pop || !rect) return;
    const r = this._pop.getBoundingClientRect();
    let top = rect.top - r.height - 8;
    let left = rect.left + rect.width / 2 - r.width / 2;
    if (top < 4) top = rect.bottom + 8;
    if (top + r.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
    if (left < 4) left = 4;
    if (left + r.width > window.innerWidth - 4) left = window.innerWidth - r.width - 4;
    this._pop.style.top = top + 'px';
    this._pop.style.left = left + 'px';
  }

  dismiss() {
    this._token++;
    if (this._pop) { this._pop.remove(); this._pop = null; }
  }
}
