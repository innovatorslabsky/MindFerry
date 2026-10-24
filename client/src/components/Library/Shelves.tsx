import { Link } from 'react-router-dom';
import type { TLibraryDocumentSummary } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useLibraryDocumentsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import Thumbnail from './Thumbnail';

/** An article this short, in minutes, is a quick read. */
export const QUICK_READ_MAX_MINUTES = 5;
/** An article this long, in minutes, or longer, is a long read. */
export const LONG_READ_MIN_MINUTES = 15;
const SHELF_SIZE = 8;
/** Asked for beyond the shelf size, since some of what is nearest the cutoff falls on the wrong side of it. */
const FETCH_SIZE = 24;

function Shelf({
  title,
  hint,
  documents,
  testId,
}: {
  title: TranslationKeys;
  hint: string;
  documents: TLibraryDocumentSummary[];
  testId: string;
}) {
  const localize = useLocalize();
  if (documents.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2" aria-label={localize(title)} data-testid={testId}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-text-primary text-sm font-semibold">{localize(title)}</h2>
        <span className="text-text-secondary text-xs">{hint}</span>
      </div>
      <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
        {documents.map((document) => (
          <li key={document.id} className="w-40 shrink-0 snap-start">
            <Link
              to={`/library/${document.id}`}
              className="hover:bg-surface-secondary flex h-full flex-col gap-1.5 rounded-lg p-1.5"
            >
              <Thumbnail document={document} className="h-24 w-full" />
              <span className="text-text-primary line-clamp-2 text-xs font-medium">
                {document.title}
              </span>
              <span className="text-text-secondary text-xs">
                {localize('com_library_minutes', { 0: Math.max(1, document.readingMinutes) })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Two rows above the inbox: the articles that can be finished in a few minutes, and the ones worth
 * setting time aside for. Each is filled from the inbox and left out when it has nothing to show.
 */
export default function Shelves() {
  const localize = useLocalize();
  const base = { location: 'inbox', kind: 'article', limit: FETCH_SIZE } as const;
  const shortest = useLibraryDocumentsQuery({ ...base, sort: 'shortest' });
  const longest = useLibraryDocumentsQuery({ ...base, sort: 'longest' });

  const quick = (shortest.data?.documents ?? [])
    .filter((document) => document.readingMinutes <= QUICK_READ_MAX_MINUTES)
    .slice(0, SHELF_SIZE);
  const long = (longest.data?.documents ?? [])
    .filter((document) => document.readingMinutes >= LONG_READ_MIN_MINUTES)
    .slice(0, SHELF_SIZE);

  if (quick.length === 0 && long.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="library-shelves">
      <Shelf
        title="com_library_shelf_quick"
        hint={localize('com_library_shelf_quick_hint', { 0: QUICK_READ_MAX_MINUTES })}
        documents={quick}
        testId="library-shelf-quick"
      />
      <Shelf
        title="com_library_shelf_long"
        hint={localize('com_library_shelf_long_hint', { 0: LONG_READ_MIN_MINUTES })}
        documents={long}
        testId="library-shelf-long"
      />
    </div>
  );
}
