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

## Français — Wiktionnaire / Remède (`remede-fr`)

- Source: https://github.com/camarm-dev/remede (release `remede.xdxf`)
- Definitions derived from **le Wiktionnaire** (Wiktionary in French), © its
  contributors, licensed under **CC BY-SA 3.0 / 4.0**:
  https://creativecommons.org/licenses/by-sa/4.0/
- Compiled and distributed by the **Remède** project (camarm-dev), whose
  software is under the **CeCILL v2.1** licence.

Comprehensive French dictionary that includes Québécois (Canadian French)
vocabulary and regional labels (e.g. *(Québec)*), hence the `fr-CA` tag. The
adapted data here is redistributed under CC BY-SA, with attribution to the
Wiktionnaire contributors and the Remède project.

## Webster's Unabridged Dictionary, 1913 (`webster`)

- Source: https://github.com/matthewreagan/WebstersEnglishDictionary
- Webster's Revised Unabridged Dictionary (1913 edition) — **public domain**.
- Digitised compilation by Matthew Reagan and contributors.

## Quenya (`quenya`) and Sindarin (`sindarin`)

- Source: https://github.com/pfstrack/eldamo (Eldamo — An Elvish Lexicon)
- © Paul Strack — https://eldamo.org
- Licensed under the **Creative Commons Attribution 4.0 International License**
  (CC-BY 4.0): https://creativecommons.org/licenses/by/4.0/
- Entries include attested Tolkien sources (language codes `q`, `s`) and the
  curated Neo-Quenya / Neo-Sindarin vocabulary (`nq`, `ns`).

The dictionary shards are built from Eldamo's XML data file (`eldamo-data.xml`)
using `tools/eldamo_to_shards.py`. To rebuild:
`python3 tools/eldamo_to_shards.py path/to/eldamo-data.xml -o data/dictionaries`

---

To rebuild English/French dictionaries from source: `node tools/build-dictionaries.mjs`
