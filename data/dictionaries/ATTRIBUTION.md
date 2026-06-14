# Bundled dictionary data — sources & licences

The offline dictionaries downloaded inside the Reader are built from open data by
`tools/build-dictionaries.mjs`. Each is normalised, bucketed by first letter and
gzipped under `data/dictionaries/<id>/`. Attribution and licence terms below are
carried in `catalog.json` and surfaced in the in-app dictionary manager.

## Wordset English Dictionary (`wordset`)

- Source: https://github.com/wordset/wordset-dictionary
- © Wordset, Inc. — https://wordset.org
- Licensed under the **Creative Commons Attribution-ShareAlike 4.0 International
  License** (CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/
- Incorporates data from **WordNet 3.0**, © Princeton University.

Because Wordset is licensed under CC BY-SA 4.0, the adapted dictionary data
bundled here is distributed under the same licence, with attribution to Wordset,
Inc. and Princeton University. This applies to the dictionary **data** only.

## Webster's Unabridged Dictionary, 1913 (`webster`)

- Source: https://github.com/matthewreagan/WebstersEnglishDictionary
- Webster's Revised Unabridged Dictionary (1913 edition) — **public domain**.
- Digitised compilation by Matthew Reagan and contributors.

---

To rebuild from source: `node tools/build-dictionaries.mjs`
