// Locale registry. To add a language:
//   1. Create js/i18n/<code>.js exporting a flat key→string object (copy en.js).
//   2. Import it here and add one entry to LANGUAGES below.
// Everything else — the settings language switcher, fallback, persistence —
// picks it up automatically.

import en from './en.js';
import fr from './fr.js';
import es from './es.js';
import de from './de.js';

export const MESSAGES = { en, fr, es, de };

// Order here is the order shown in the settings language switcher. `label` is
// the language's own (native) name so it's recognisable regardless of the
// current UI language.
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
];
