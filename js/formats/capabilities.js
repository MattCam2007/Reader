// Capability keys and helpers. See types.js Capabilities typedef for semantics.

export const CAPABILITY_KEYS = [
  'reflow',
  'richText',
  'textStream',
  'images',
  'toc',
  'search',
  'pageFidelity',
];

// Build a Capabilities object, defaulting any unspecified key to false.
export function makeCapabilities(overrides = {}) {
  const caps = {};
  for (const k of CAPABILITY_KEYS) caps[k] = !!overrides[k];
  return caps;
}

export const FULL_CAPABILITIES = makeCapabilities({
  reflow: true, richText: true, textStream: true, images: true,
  toc: true, search: true, pageFidelity: true,
});

export const NO_CAPABILITIES = makeCapabilities();
