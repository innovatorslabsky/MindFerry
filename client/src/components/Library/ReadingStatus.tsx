import { Star } from 'lucide-react';
import { useToastContext } from '@librechat/client';
import type { TLibraryDocumentSummary, TLibraryReadingStatus } from 'librechat-data-provider';
import { READING_STATUS_LABEL, READING_STATUSES } from './readingStatus';
import { useUpdateLibraryDocumentMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const STARS = [1, 2, 3, 4, 5] as const;

/** Where the person is with a document, like a Goodreads shelf, and how many stars they give it. */
export default function ReadingStatus({ document }: { document: TLibraryDocumentSummary }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const update = useUpdateLibraryDocumentMutation({
    onError: () =>
      showToast({
        message: localize('com_library_edit_error'),
        status: NotificationSeverity.ERROR,
      }),
  });

  const setStatus = (value: string) =>
    update.mutate({
      id: document.id,
      patch: { readingStatus: value === '' ? null : (value as TLibraryReadingStatus) },
    });
  /** Pressing the star you already gave takes the rating off. */
  const setRating = (stars: number) =>
    update.mutate({
      id: document.id,
      patch: { rating: document.rating === stars ? null : stars },
    });

  return (
    <section className="flex flex-col gap-2" data-testid="library-reading-status">
      <label className="text-text-primary flex flex-col gap-1 text-sm font-semibold">
        {localize('com_library_status')}
        <select
          value={document.readingStatus ?? ''}
          disabled={update.isLoading}
          onChange={(event) => setStatus(event.target.value)}
          className="border-border-medium bg-surface-primary text-text-primary rounded-lg border px-2 py-1.5 text-sm font-normal"
          data-testid="library-status-select"
        >
          <option value="">{localize('com_library_status_none')}</option>
          {READING_STATUSES.map((value) => (
            <option key={value} value={value}>
              {localize(READING_STATUS_LABEL[value])}
            </option>
          ))}
        </select>
      </label>
      <div role="group" aria-label={localize('com_library_rating')} className="flex gap-0.5">
        {STARS.map((stars) => (
          <button
            key={stars}
            type="button"
            disabled={update.isLoading}
            aria-pressed={(document.rating ?? 0) >= stars}
            aria-label={localize('com_library_rating_stars', { 0: stars })}
            onClick={() => setRating(stars)}
            className="rounded p-0.5"
            data-testid={`library-star-${stars}`}
          >
            <Star
              className={cn(
                'h-5 w-5',
                (document.rating ?? 0) >= stars
                  ? 'text-status-warning-border fill-current'
                  : 'text-text-secondary',
              )}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
