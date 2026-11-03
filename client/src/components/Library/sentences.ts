export type SentenceRange = { start: number; end: number };

/** A longer stretch than this is split at a space, since speech engines cut off or stall on very long ones. */
export const MAX_SENTENCE_CHARS = 280;

const HAS_WORD = /[\p{L}\p{N}]/u;
const FALLBACK = /[^.!?…。！？\n]+(?:[.!?…。！？]+["'”’)\]]*|\n+|$)/g;

function rawSegments(text: string, lang?: string): SentenceRange[] {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: 'sentence' },
      ) => { segment: (text: string) => Iterable<{ segment: string; index: number }> };
    }
  ).Segmenter;
  const out: SentenceRange[] = [];
  if (Segmenter) {
    try {
      for (const { segment, index } of new Segmenter(lang, { granularity: 'sentence' }).segment(
        text,
      )) {
        out.push({ start: index, end: index + segment.length });
      }
      return out;
    } catch {
      out.length = 0;
    }
  }
  for (const match of text.matchAll(FALLBACK)) {
    out.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return out;
}

/**
 * The sentences of `text`, as ranges of it, without the white space around them and without stretches that
 * hold no word at all. Offsets are into `text`, so they are the offsets highlights use.
 */
export function splitSentences(text: string, lang?: string): SentenceRange[] {
  const sentences: SentenceRange[] = [];
  for (const raw of rawSegments(text, lang)) {
    let { start, end } = raw;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start || !HAS_WORD.test(text.slice(start, end))) {
      continue;
    }
    while (end - start > MAX_SENTENCE_CHARS) {
      const space = text.lastIndexOf(' ', start + MAX_SENTENCE_CHARS);
      const cut = space > start ? space : start + MAX_SENTENCE_CHARS;
      sentences.push({ start, end: cut });
      start = cut;
      while (start < end && /\s/.test(text[start])) start++;
    }
    sentences.push({ start, end });
  }
  return sentences;
}

/** The index of the first sentence that ends after `offset`: where to begin reading from a position. */
export function sentenceAt(sentences: readonly SentenceRange[], offset: number): number {
  const index = sentences.findIndex((sentence) => sentence.end > offset);
  return index === -1 ? Math.max(0, sentences.length - 1) : index;
}
