import { UNTRUSTED_NOTICE } from './chat';

/** The same limit as the summary field a person can type into. */
export const SUMMARY_MAX_CHARS = 2000;

export interface SummaryInput {
  title: string;
  text: string;
  /** The text was already cut to fit the model; say so, so the summary does not claim the whole. */
  truncated: boolean;
}

/**
 * The prompt for a short summary of a saved document. The text goes behind the third-party notice
 * and markers, as everywhere else the library hands a page to a model.
 */
export function buildSummaryPrompt(input: SummaryInput): string {
  return (
    'Write a summary of the saved document below for the person who saved it. Use 3 to 5 sentences, ' +
    'plain prose with no heading, list or markdown, and the same language as the document. ' +
    'Say what it is about and what it concludes; do not praise it or add anything the text does not say.' +
    `\n\n${UNTRUSTED_NOTICE}\n\nTitle: ${input.title}\n\n<<<TEXT\n${input.text}\nTEXT>>>` +
    (input.truncated ? '\n\n(The text above is cut short; summarize only what is shown.)' : '')
  );
}

/** What a model returned, as a summary that fits the field: no fences or quotes, cut at a sentence. */
export function cleanSummary(raw: string): string {
  let text = raw
    .replace(/^```[a-z]*\n?|```$/gim, '')
    .replace(/^\s*summary\s*:\s*/i, '')
    .trim();
  if (text.length <= SUMMARY_MAX_CHARS) {
    return text;
  }
  text = text.slice(0, SUMMARY_MAX_CHARS);
  const stop = Math.max(text.lastIndexOf('. '), text.lastIndexOf('。'));
  return stop > SUMMARY_MAX_CHARS / 2 ? text.slice(0, stop + 1) : text.trimEnd();
}
