export const SAMPLE_TEXT = `It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.

However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.

"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?"

Mr. Bennet replied that he had not.

"But it is," returned she; "for Mrs. Long has just been here, and she told me all about it."

Mr. Bennet made no answer.

"Do you not want to know who has taken it?" cried his wife impatiently.

"You want to tell me, and I have no objection to hearing it."

This was invitation enough.

"Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week."

"What is his name?"

"Bingley."

"Is he married or single?"

"Oh! Single, my dear, to be sure! A single man of large fortune; four or five thousand a year. What a fine thing for our girls!"`;

// The sample book is only ever loaded under ?selftest=1. It is split into
// three sections so the selftest suite can exercise multi-chapter behaviour
// (windowed rendering, cross-section positions, bookmark symmetry) — a
// single-section book can't enter windowed mode at all.
export function buildSample() {
  const paras = SAMPLE_TEXT.split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const third = Math.ceil(paras.length / 3);
  const toBlocks = (texts) => texts.map((t) => ({ type: "p", text: t }));
  return [
    {
      href: "sample-1",
      blocks: [
        { type: "h1", text: "Pride and Prejudice" },
        { type: "h2", text: "Chapter I" },
        ...toBlocks(paras.slice(0, third)),
      ],
    },
    {
      href: "sample-2",
      blocks: [
        { type: "h2", text: "Chapter II" },
        ...toBlocks(paras.slice(third, third * 2)),
      ],
    },
    {
      href: "sample-3",
      blocks: [
        { type: "h2", text: "Chapter III" },
        ...toBlocks(paras.slice(third * 2)),
      ],
    },
  ];
}
