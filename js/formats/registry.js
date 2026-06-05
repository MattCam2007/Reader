// Format-adapter registry. Adapters self-register via registerAdapter(); the
// rest of the app calls selectAdapter() to pick the right one for a file.
// This module is a leaf — it only imports from detect.js (no app/core imports).

import { magicBytes } from './detect.js';

const _adapters = [];

// Register a FormatAdapter (see types.js). Adapters are sorted by priority
// (descending) so high-priority ones are checked first by selectAdapter().
export function registerAdapter(adapter) {
  if (!adapter || !adapter.id || typeof adapter.parse !== 'function' || typeof adapter.detect !== 'function') {
    throw new Error('registerAdapter: invalid adapter — must have id, detect(), and parse()');
  }
  _adapters.push(adapter);
  _adapters.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

// Return a shallow copy of all registered adapters in priority order.
export function listAdapters() { return _adapters.slice(); }

// Find a registered adapter by id, or null if not found.
export function getAdapterById(id) { return _adapters.find(a => a.id === id) || null; }

// Choose the adapter that handles (buffer, fileName, mimeType). Returns the
// first matching adapter in priority order, or null if none matches.
export function selectAdapter(buffer, fileName, mimeType = '') {
  const bytes = magicBytes(buffer);
  const name = (fileName || '').toLowerCase();
  for (const a of _adapters) {
    try {
      if (a.detect(bytes, name, mimeType)) return a;
    } catch (_) {
      // A misbehaving detect() must not prevent other adapters from being tried.
    }
  }
  return null;
}

// Build the value for <input accept="…"> from all registered formats.
// Call this after all adapters are registered (i.e. after formats/index.js runs).
export function acceptString() {
  const parts = [];
  for (const a of _adapters) {
    a.extensions.forEach(e => parts.push(e));
    a.mimeTypes.forEach(m => parts.push(m));
  }
  return [...new Set(parts)].join(',');
}

// Human-readable list of supported format labels (e.g. ['EPUB']).
export function supportedLabels() {
  return _adapters.map(a => a.label);
}
