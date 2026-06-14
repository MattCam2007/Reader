// Builds the offline dictionary data bundled with the Reader.
//
// Downloads open-licensed source dictionaries, normalises every entry to one
// compact shape, buckets them by first letter, gzips each bucket, and writes the
// result under data/dictionaries/. The app fetches these same-origin shards on
// demand (see js/core/dictionary.js) and stores them in IndexedDB, so a word
// lookup never touches the network once a dictionary is downloaded.
//
// This script is the provenance record for the bundled data — re-run it to
// rebuild from source. Run: node tools/build-dictionaries.mjs
//
// Sources (see data/dictionaries/ATTRIBUTION.md for full licences):
//   - wordset : Wordset, Inc. — CC BY-SA 4.0 (+ WordNet 3.0). Modern, structured.
//   - webster : Webster's 1913 (matthewreagan/WebstersEnglishDictionary) — public domain.

import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'dictionaries');

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

// First-letter bucket for a (lowercased) headword. Non-alphabetic headwords go
// to the '0' bucket so every word is reachable.
function bucketOf(lcword) {
  const c = lcword[0];
  return c >= 'a' && c <= 'z' ? c : '0';
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Merge a normalised entry into a bucket map, combining senses on collision.
function addEntry(buckets, lcword, display, senses) {
  if (!lcword || !senses.length) return;
  const b = bucketOf(lcword);
  // Null-prototype map so headwords like "constructor"/"toString" don't collide
  // with Object.prototype members.
  const map = (buckets[b] ||= Object.create(null));
  if (map[lcword]) {
    map[lcword].s.push(...senses);
  } else {
    map[lcword] = { w: display, s: senses };
  }
}

// ---- wordset: per-letter JSON, structured meanings ----
async function buildWordset() {
  const base = 'https://raw.githubusercontent.com/wordset/wordset-dictionary/master/data';
  const buckets = {};
  for (const L of LETTERS) {
    process.stdout.write(`  wordset ${L}.json …`);
    const data = await fetchJSON(`${base}/${L}.json`);
    let n = 0;
    for (const key of Object.keys(data)) {
      const src = data[key];
      const display = src.word || key;
      const senses = (src.meanings || []).map((m) => {
        const o = { p: m.speech_part || '', d: m.def || '' };
        if (m.example) o.e = m.example;
        if (Array.isArray(m.synonyms) && m.synonyms.length) o.y = m.synonyms;
        return o;
      }).filter((s) => s.d);
      addEntry(buckets, String(display).toLowerCase(), display, senses);
      n++;
    }
    console.log(` ${n} entries`);
  }
  return buckets;
}

// ---- webster 1913: one flat { word: "definition string" } file ----
async function buildWebster() {
  const url = 'https://raw.githubusercontent.com/matthewreagan/WebstersEnglishDictionary/master/dictionary_compact.json';
  process.stdout.write('  webster dictionary_compact.json …');
  const data = await fetchJSON(url);
  const buckets = {};
  let n = 0;
  for (const key of Object.keys(data)) {
    const def = String(data[key] || '').trim();
    if (!def) continue;
    addEntry(buckets, key.toLowerCase(), key, [{ p: '', d: def }]);
    n++;
  }
  console.log(` ${n} entries`);
  return buckets;
}

function writeDict(id, meta, buckets) {
  const dir = join(OUT, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const index = { id, ...meta, buckets: {}, words: 0, bytes: 0 };
  for (const b of Object.keys(buckets).sort()) {
    const map = buckets[b];
    const words = Object.keys(map).length;
    if (!words) continue;
    const gz = gzipSync(Buffer.from(JSON.stringify(map)), { level: 9 });
    writeFileSync(join(dir, `${b}.json.gz`), gz);
    index.buckets[b] = { words, bytes: gz.length };
    index.words += words;
    index.bytes += gz.length;
  }
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`  → ${id}: ${index.words} words, ${(index.bytes / 1048576).toFixed(1)} MB gzipped`);
  return index;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const catalog = [];

  catalog.push(writeDict('wordset', {
    name: 'Wordset English Dictionary',
    description: 'A modern, community-built English dictionary with parts of speech, synonyms and usage examples.',
    license: 'CC BY-SA 4.0 (+ WordNet 3.0)',
    attribution: 'Wordset, Inc. — wordset.org',
  }, await buildWordset()));

  catalog.push(writeDict('webster', {
    name: "Webster's Unabridged (1913)",
    description: "Webster's Revised Unabridged Dictionary, 1913 edition. Classic, literary definitions in the public domain.",
    license: 'Public domain',
    attribution: "Noah Webster (1913); digitised by matthewreagan/WebstersEnglishDictionary",
  }, await buildWebster()));

  writeFileSync(join(OUT, 'catalog.json'), JSON.stringify({
    version: 1,
    builtAt: new Date().toISOString().slice(0, 10),
    dictionaries: catalog.map((c) => ({
      id: c.id, name: c.name, description: c.description,
      license: c.license, attribution: c.attribution,
      words: c.words, bytes: c.bytes,
      buckets: Object.fromEntries(Object.entries(c.buckets).map(([k, v]) => [k, v.bytes])),
    })),
  }, null, 2));
  console.log('Wrote catalog.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
