/**
 * Tags a new document with where it came from and what it is about. Everything here is plain
 * counting on the text: nothing is sent anywhere and no model is involved, so the same page always
 * gets the same tags. The person can change them afterwards, and they are never re-applied.
 */

export interface AutoTagInput {
  kind: 'article' | 'pdf' | 'epub';
  title: string;
  text: string;
  lang?: string | null;
  normalizedUrl: string;
}

const MAX_KEYWORDS = 3;
const MIN_SCORE = 3;
const TITLE_WEIGHT = 3;
/** Reading further adds cost, not better keywords. */
const SCAN_CHARS = 30_000;

const STOPWORDS = new Set(
  `about above after again against also always among another because been before being below between both
  cannot could does doing done down during each either else ever every from further have having here hers
  herself himself into itself just like made make many more most much must myself never only other ours
  ourselves over same should since some such than that their theirs them themselves then there these they
  this those though through thus under until upon very want wasn were what when where whether which while
  whom whose will with within without would your yours yourself yourselves said says still take taken
  than then well went what's it's don't can't won't didn't doesn't isn't aren't wasn't weren't they're
  we're you're i'm i've you've we've they've that's there's here's who's let's one two three first second
  new old good great little long right big high small large next early young important able back came
  come came get gets getting give given goes going gone got keep kept know known later least less look
  looks might need needs often once part per quite rather really seem seems several something soon
  sometimes sure tell thing things think thought today together took tried try use used uses using
  usually via way ways yet`.split(/\s+/),
);

/** The site a page came from, without a leading `www.`; nothing for an uploaded file. */
export function sourceTag(normalizedUrl: string): string | undefined {
  try {
    const url = new URL(normalizedUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host.length > 0 && host.length <= 64 ? host : undefined;
  } catch {
    return undefined;
  }
}

function words(text: string): string[] {
  return (
    text
      .slice(0, SCAN_CHARS)
      .toLowerCase()
      .match(/\p{L}[\p{L}'’-]{3,}/gu) ?? []
  ).map((word) => word.replace(/’/g, "'").replace(/^[-']+|[-']+$/g, ''));
}

/** English keywords only: the stop list is English, and counting words means little in other languages. */
function keywords(input: AutoTagInput): string[] {
  const lang = (input.lang ?? '').toLowerCase();
  if (lang && !lang.startsWith('en')) {
    return [];
  }
  const score = new Map<string, number>();
  const bump = (word: string, by: number) => {
    if (word.length >= 4 && word.length <= 24 && !STOPWORDS.has(word)) {
      score.set(word, (score.get(word) ?? 0) + by);
    }
  };
  for (const word of words(input.text)) {
    bump(word, 1);
  }
  for (const word of new Set(words(input.title))) {
    bump(word, TITLE_WEIGHT);
  }
  return [...score.entries()]
    .filter(([, value]) => value >= MIN_SCORE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_KEYWORDS)
    .map(([word]) => word);
}

/** At most five tags: the site, the file kind for a book, and up to three keywords. */
export function suggestTags(input: AutoTagInput): string[] {
  const tags: string[] = [];
  const source = sourceTag(input.normalizedUrl);
  if (source) {
    tags.push(source);
  }
  if (input.kind !== 'article') {
    tags.push(input.kind);
  }
  for (const word of keywords(input)) {
    if (!tags.includes(word)) {
      tags.push(word);
    }
  }
  return tags;
}
