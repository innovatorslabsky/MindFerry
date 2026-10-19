export type OutlineEntry = {
  text: string;
  /** 1 to 4, as the heading was written. */
  level: number;
  /** Which of the page's headings this is, counting every one, so the reader can find it again. */
  index: number;
};

/** The selector that finds the headings an outline is made of, in the page and in the reader. */
export const OUTLINE_SELECTOR = 'h1, h2, h3, h4';

/** The headings of an article's HTML, in order. Headings with no text are left out of the list. */
export function outlineOf(html: string): OutlineEntry[] {
  if (!html) {
    return [];
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const entries: OutlineEntry[] = [];
  doc.body.querySelectorAll(OUTLINE_SELECTOR).forEach((heading, index) => {
    const text = (heading.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) {
      entries.push({ text, level: Number(heading.tagName.slice(1)), index });
    }
  });
  return entries;
}
