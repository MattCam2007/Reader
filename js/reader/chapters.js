import { pageOfElement } from '../model/geometry.js';

export function buildChapterIndex(state, content) {
  state.chapterIndex = [];
  if (state.headingToc.length) {
    state.headingToc.forEach(h => {
      state.chapterIndex.push({ label: h.label, page: pageOfElement(state, content, h.el) });
    });
  }
  if (!state.chapterIndex.length) {
    state.sectionEls.forEach((el, href) => {
      const firstHeading = el.querySelector(".blk-h1, .blk-h2, .blk-h3");
      const label = firstHeading ? firstHeading.textContent.trim() : href;
      state.chapterIndex.push({ label, page: pageOfElement(state, content, el) });
    });
  }
  state.chapterIndex.sort((a, b) => a.page - b.page);
}
