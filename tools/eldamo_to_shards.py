#!/usr/bin/env python3
"""
eldamo_to_shards.py
Convert Paul Strack's Eldamo XML (eldamo.org, CC-BY 4.0) into the ereader app's
sharded, gzipped-JSON dictionary format.

Source data:  https://github.com/pfstrack/eldamo  -> src/data/eldamo-data.xml
Attribution required (CC-BY 4.0): "Elvish data from Eldamo by Paul Strack,
eldamo.org, CC-BY 4.0".

Output per dictionary <id>:
    out/dictionaries/<id>/a.json.gz ... z.json.gz, 0.json.gz   (shards)
    out/dictionaries/<id>/index.json                           (per-bucket meta)
and a combined out/dictionaries/catalog.json across all dictionaries built.

Shard entry shape (matches dictionary.js):
    "<lowercase key>": { "w": display, "s": [ {"p":pos,"d":def,"e":ex?,"y":[syn]} ] }
"""

import xml.etree.ElementTree as ET
import unicodedata, json, gzip, os, re, string, argparse
from collections import defaultdict

# Each output dictionary merges several Eldamo language ids, in PRIORITY order:
# attested Tolkien forms first (they win the display form + canonical gloss),
# then the curated "Neo" set fills in the long tail of fan-usable vocabulary.
# This keeps iconic canon words (mellon, mithril, minas) that the Neo set omits.
DEFAULT_DICTS = {
    "quenya":   {"name": "Quenya",   "langs": ["q", "nq"]},
    "sindarin": {"name": "Sindarin", "langs": ["s", "ns"]},
}

# Expand Eldamo 'speech' codes to reader-friendly parts of speech.
SPEECH = {
    "n": "noun", "pn": "proper noun", "adj": "adjective", "adv": "adverb",
    "vb": "verb", "prep": "preposition", "pron": "pronoun", "conj": "conjunction",
    "interj": "interjection", "num": "numeral", "art": "article", "suf": "suffix",
    "pref": "prefix", "particle": "particle", "phrase": "phrase",
    "cardinal": "cardinal", "ordinal": "ordinal", "fragment": "fragment",
    "root": "root", "grammar": "grammar",
    "masc-name": "masculine name", "fem-name": "feminine name",
    "place-name": "place name", "proper-name": "proper noun",
    "collective-name": "collective name",
}

def expand_pos(speech: str) -> str:
    """Eldamo 'speech' may be space-separated codes e.g. 'n adj'; expand each."""
    if not speech:
        return ""
    return " ".join(SPEECH.get(tok, tok) for tok in speech.split())

SUPERSCRIPTS = "¹²³⁴⁵⁶⁷⁸⁹⁰"

def clean_key(v: str) -> str:
    """Lowercase lookup key: drop homonym superscripts and surrounding noise."""
    v = v.strip().lower()
    v = "".join(c for c in v if c not in SUPERSCRIPTS)
    return v.strip()

def shard_letter(key: str) -> str:
    """Fold diacritics to pick an a-z bucket; non-letters go to '0'."""
    if not key:
        return "0"
    base = unicodedata.normalize("NFKD", key)
    base = "".join(c for c in base if not unicodedata.combining(c))
    first = base[:1].lower()
    return first if first in string.ascii_lowercase else "0"

def is_usable(v: str, speech: str, gloss) -> bool:
    if not gloss:
        return False
    if speech == "phoneme":
        return False
    if v.startswith("[") or v.startswith("*"):   # phonetic / reconstructed
        return False
    return True

def build(xml_path, dicts, outroot):
    # Map every source language id -> its output dict id and priority rank.
    src = {}   # langid -> (dict_id, rank)
    for did, meta in dicts.items():
        for rank, l in enumerate(meta["langs"]):
            src[l] = (did, rank)

    # rows per output dict: (rank, display, key, pos, gloss)
    rows = defaultdict(list)
    for _, el in ET.iterparse(xml_path, events=("end",)):
        if el.tag == "word":
            l = el.get("l")
            if l in src:
                v = el.get("v", ""); sp = el.get("speech", ""); g = el.get("gloss")
                if is_usable(v, sp, g):
                    key = clean_key(v)
                    if key:
                        did, rank = src[l]
                        rows[did].append((rank, v.strip(), key, expand_pos(sp), g.strip()))
        el.clear()

    catalog = []
    for did, meta in dicts.items():
        items = rows.get(did, [])
        # same-gloss synonyms within this output dictionary
        by_gloss = defaultdict(set)
        for rank, disp, key, pos, g in items:
            by_gloss[g].add(disp)

        # attested (rank 0) processed before neo (rank 1) so canon wins display form
        items.sort(key=lambda r: r[0])
        entries = {}
        for rank, disp, key, pos, g in items:
            syns = sorted(by_gloss[g] - {disp})
            sense = {"p": pos, "d": g}
            if syns:
                sense["y"] = syns
            if key not in entries:
                entries[key] = {"w": disp, "s": [sense]}
            elif not any(s["d"] == g and s.get("p") == pos for s in entries[key]["s"]):
                entries[key]["s"].append(sense)

        shards = defaultdict(dict)
        for key, entry in entries.items():
            shards[shard_letter(key)][key] = entry

        d_dir = os.path.join(outroot, did)
        os.makedirs(d_dir, exist_ok=True)
        buckets = {}
        for letter, obj in sorted(shards.items()):
            raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            gz = gzip.compress(raw, mtime=0)
            with open(os.path.join(d_dir, f"{letter}.json.gz"), "wb") as f:
                f.write(gz)
            buckets[letter] = {"words": len(obj), "bytes": len(gz), "raw_bytes": len(raw)}

        index = {
            "id": did, "name": meta["name"], "wordCount": len(entries),
            "buckets": buckets, "license": "CC-BY 4.0",
            "attribution": "Elvish data from Eldamo by Paul Strack, eldamo.org",
        }
        with open(os.path.join(d_dir, "index.json"), "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
        catalog.append({k: index[k] for k in ("id", "name", "wordCount", "license", "attribution")})
        print(f"  {meta['name']:<12} {len(entries):>5} words, {len(buckets)} shards, "
              f"{sum(b['bytes'] for b in buckets.values())/1024:.0f} KB gzipped")

    with open(os.path.join(outroot, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    return catalog

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("xml", help="path to eldamo-data.xml")
    ap.add_argument("-o", "--out", default="out/dictionaries")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    print("Building Eldamo dictionaries...")
    build(args.xml, DEFAULT_DICTS, args.out)
    print("Done ->", args.out)
