// Shared utilities for CBZ and CBR format adapters. Both formats are archives
// of image files; this module handles image detection, natural-order sorting,
// and building the canonical ParsedBook IR from a flat list of image entries.

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);

const MIME_FOR_EXT = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.bmp':  'image/bmp',
  '.avif': 'image/avif',
};

export function isImageFile(name) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTS.has(lower.slice(dot));
}

function mimeFor(name) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return (dot >= 0 && MIME_FOR_EXT[lower.slice(dot)]) || 'application/octet-stream';
}

// Natural sort: 'page2' sorts before 'page10', '001' before '010'.
export function naturalCompare(a, b) {
  const tokenize = s => s.toLowerCase().split(/(\d+)/).map((tok, i) =>
    i % 2 ? parseInt(tok, 10) : tok
  );
  const ta = tokenize(a);
  const tb = tokenize(b);
  const len = Math.min(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    if (ta[i] === tb[i]) continue;
    if (typeof ta[i] === 'number' && typeof tb[i] === 'number') return ta[i] - tb[i];
    return String(ta[i]).localeCompare(String(tb[i]));
  }
  return ta.length - tb.length;
}

// Build the canonical ParsedBook IR from a flat list of image entries.
// entries: [{ name: string, bytes: Uint8Array }]  (filenames, not full paths)
// fileName: original archive filename used to derive the book title.
export async function buildComicIR(entries, fileName, onProgress) {
  const pages = entries
    .filter(e => isImageFile(e.name))
    .sort((a, b) => naturalCompare(a.name, b.name));

  if (!pages.length) {
    throw new Error('No image pages found in this comic archive.');
  }

  const sections = [];
  const blobUrls = [];
  let cover = null;

  for (let i = 0; i < pages.length; i++) {
    if (onProgress) onProgress('Loading page ' + (i + 1) + ' / ' + pages.length);
    const { name, bytes } = pages[i];
    const blob = new Blob([bytes], { type: mimeFor(name) });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);
    if (i === 0) cover = url;

    const href = 'page-' + String(i + 1).padStart(4, '0');
    const text = 'Page ' + (i + 1);

    const img = document.createElement('img');
    img.src = url;
    img.alt = text;
    const frag = document.createDocumentFragment();
    frag.appendChild(img);

    sections.push({ href, blocks: [{ type: 'figure', text, id: '', frag }] });
  }

  const title = fileName.replace(/\.[^.]+$/, '');
  return { sections, toc: [], title, metaTitle: '', blobUrls, cover };
}
