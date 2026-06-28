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
//   - wordset    : Wordset, Inc. — CC BY-SA 4.0 (+ WordNet 3.0). Modern, structured.
//   - webster    : Webster's 1913 (matthewreagan/WebstersEnglishDictionary) — public domain.
//   - quenya     : Eldamo (Paul Strack, eldamo.org) — CC-BY 4.0. Built by tools/eldamo_to_shards.py.
//   - sindarin   : Eldamo (Paul Strack, eldamo.org) — CC-BY 4.0. Built by tools/eldamo_to_shards.py.

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

// ---- remede (French): XDXF release artifact, streamed so we never hold the
// whole 367 MB file in memory. Each <ar> article carries a headword (<k>) and
// one or more part-of-speech (<gr>) + definition (<deftext>) pairs. The data is
// Wiktionnaire-derived French and includes Québécois vocabulary and labels. ----
function xdxfClean(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function buildRemedeFR() {
  const url = 'https://github.com/camarm-dev/remede/releases/download/1.4.0/remede.xdxf';
  process.stdout.write('  remede remede.xdxf (streaming ~367 MB) …');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`remede ${res.status}`);
  const buckets = {};
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let n = 0;

  const flushArticles = () => {
    let idx;
    while ((idx = buf.indexOf('</ar>')) !== -1) {
      const start = buf.lastIndexOf('<ar>', idx);
      const article = start !== -1 ? buf.slice(start + 4, idx) : '';
      buf = buf.slice(idx + 5);
      if (!article) continue;
      const km = /<k>(.*?)<\/k>/s.exec(article);
      if (!km) continue;
      const display = xdxfClean(km[1]);
      if (!display) continue;
      const grs = [...article.matchAll(/<gr>(.*?)<\/gr>/gs)].map((m) => xdxfClean(m[1]));
      const defs = [...article.matchAll(/<deftext>(.*?)<\/deftext>/gs)].map((m) => xdxfClean(m[1]));
      const senses = defs.map((d, i) => ({ p: grs[i] || '', d: d.slice(0, 600) })).filter((s) => s.d);
      if (!senses.length) continue;
      addEntry(buckets, display.toLowerCase(), display, senses);
      n++;
    }
  };

  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    if (buf.length > 1_000_000) flushArticles();
  }
  buf += decoder.decode();
  flushArticles();
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

  // `lang` is a BCP 47 tag (language[-REGION], region uppercase). The app groups
  // dictionaries by it, so French (fr), Québécois French (fr-CA), Spanish (es)
  // etc. can sit alongside these English ones, with multiple per language.
  catalog.push(writeDict('wordset', {
    name: 'Wordset English Dictionary',
    lang: 'en',
    description: 'A modern, community-built English dictionary with parts of speech, synonyms and usage examples.',
    license: 'CC BY-SA 4.0 (+ WordNet 3.0)',
    attribution: 'Wordset, Inc. — wordset.org',
  }, await buildWordset()));

  catalog.push(writeDict('webster', {
    name: "Webster's Unabridged (1913)",
    lang: 'en-US',
    description: "Webster's Revised Unabridged Dictionary, 1913 edition. Classic, literary definitions in the public domain.",
    license: 'Public domain',
    attribution: "Noah Webster (1913); digitised by matthewreagan/WebstersEnglishDictionary",
  }, await buildWebster()));

  catalog.push(writeDict('remede-fr', {
    name: 'Français — Wiktionnaire (Remède)',
    lang: 'fr-CA',
    description: 'Dictionnaire français complet issu du Wiktionnaire, incluant le vocabulaire et les usages québécois. Comprehensive French dictionary including Québécois vocabulary and regional labels.',
    license: 'CC BY-SA 3.0/4.0 (Wiktionnaire); compilation CeCILL v2.1',
    attribution: 'Le Wiktionnaire (contributeurs) ; compilation par le projet Remède (camarm-dev/remede)',
  }, await buildRemedeFR()));

  writeFileSync(join(OUT, 'catalog.json'), JSON.stringify({
    version: 1,
    builtAt: new Date().toISOString().slice(0, 10),
    dictionaries: catalog.map((c) => ({
      id: c.id, name: c.name, lang: c.lang, description: c.description,
      license: c.license, attribution: c.attribution,
      words: c.words, bytes: c.bytes,
      buckets: Object.fromEntries(Object.entries(c.buckets).map(([k, v]) => [k, v.bytes])),
    })),
  }, null, 2));
  console.log('Wrote catalog.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
