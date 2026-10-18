/**
 * A PDF page appears twice: as the stored text highlights are anchored in, and as the text layer drawn
 * over the page image. Both come from the same text items, so they hold the same characters and differ
 * only in whitespace and in where a hyphenated word was joined. These helpers carry a position from
 * one to the other by comparing the characters alone, and by counting which occurrence of the same
 * words it is when a passage appears more than once on the page.
 */

/** Spaces, line breaks and every hyphen: what the two texts are allowed to disagree about. */
const IGNORED = /[\s\-­‐‑]/;

interface Compact {
  text: string;
  /** `at[i]` is where compact character `i` sits in the original text. */
  at: number[];
}

function compact(text: string): Compact {
  let out = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (!IGNORED.test(text[i])) {
      out += text[i];
      at.push(i);
    }
  }
  return { text: out, at };
}

/** How many characters before `offset` are kept, which is where `offset` falls in the compact text. */
function compactIndex(original: Compact, offset: number): number {
  let low = 0;
  let high = original.at.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (original.at[middle] < offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** The positions at which `needle` starts in `haystack`, overlaps included. */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (
    let from = haystack.indexOf(needle);
    from !== -1;
    from = haystack.indexOf(needle, from + 1)
  ) {
    found.push(from);
  }
  return found;
}

/**
 * Carries `[start, end)` of `from` over to the same passage of `to`. The passage must exist in both;
 * when it appears several times, the Nth in `from` is the Nth in `to`. Null when it cannot be placed.
 */
function carry(
  from: string,
  to: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  if (!(start >= 0) || !(end > start) || end > from.length) {
    return null;
  }
  const source = compact(from);
  const target = compact(to);
  const first = compactIndex(source, start);
  const last = compactIndex(source, end);
  const passage = source.text.slice(first, last);
  if (passage === '') {
    return null;
  }
  const ordinal = occurrences(source.text, passage).indexOf(first);
  const there = occurrences(target.text, passage)[ordinal];
  if (ordinal < 0 || there === undefined) {
    return null;
  }
  return {
    start: target.at[there],
    end: target.at[there + passage.length - 1] + 1,
  };
}

/** A selection in the text layer, as offsets into the stored page text. */
export function layerToAnchor(
  layerText: string,
  anchorText: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  return carry(layerText, anchorText, start, end);
}

/** A highlight in the stored page text, as offsets into the text layer. */
export function anchorToLayer(
  layerText: string,
  anchorText: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  return carry(anchorText, layerText, start, end);
}
