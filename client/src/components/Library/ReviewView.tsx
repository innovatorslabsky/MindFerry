import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, EyeOff } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import type { TLibraryReviewAction } from 'librechat-data-provider';
import { useLibraryReviewQuery, useReviewLibraryHighlightMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useShortcuts } from './useShortcuts';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** One more batch of this many is offered each time the person asks to keep going. */
const MORE = 5;

/**
 * A few old highlights a day, one card at a time, so what was worth keeping comes back. Each card is
 * marked as seen, or set aside for good; a day's goal ends the session until the person asks for more.
 */
export default function ReviewView() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [extra, setExtra] = useState(0);
  const [position, setPosition] = useState(0);
  const review = useLibraryReviewQuery(extra);
  const mark = useReviewLibraryHighlightMutation();

  const items = review.data?.items ?? [];
  const item = items[position];
  const total = items.length;

  const act = (action: TLibraryReviewAction) => {
    if (!item) {
      return;
    }
    mark.mutate(
      { id: item.highlight.id, action },
      {
        onError: () =>
          showToast({
            message: localize('com_library_review_error'),
            status: NotificationSeverity.ERROR,
          }),
      },
    );
    setPosition((current) => current + 1);
  };

  useShortcuts({
    d: () => act('done'),
    ArrowRight: () => act('done'),
    m: () => act('mute'),
  });

  const more = () => {
    setPosition(0);
    setExtra((current) => current + MORE);
  };

  let body: JSX.Element;
  if (review.isLoading) {
    body = (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    );
  } else if (review.isError) {
    body = (
      <p className="text-text-secondary py-12 text-center text-sm">
        {localize('com_library_load_error')}
      </p>
    );
  } else if (!item) {
    const nothing = total === 0 && (review.data?.reviewedToday ?? 0) === 0;
    body = (
      <div className="flex flex-col items-center gap-3 py-14 text-center" data-testid="review-done">
        <p className="text-text-primary text-base font-medium">
          {localize(nothing ? 'com_library_review_none' : 'com_library_review_done')}
        </p>
        <p className="text-text-secondary text-sm">
          {localize(nothing ? 'com_library_review_none_hint' : 'com_library_review_done_hint')}
        </p>
        {!nothing && (
          <Button type="button" variant="outline" onClick={more}>
            {localize('com_library_review_more', { 0: MORE })}
          </Button>
        )}
      </div>
    );
  } else {
    const { highlight, document } = item;
    body = (
      <article className="flex flex-col gap-4" data-testid="review-card">
        <p className="text-text-secondary text-xs">
          {localize('com_library_review_progress', { 0: position + 1, 1: total })}
        </p>
        <div className="flex gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'library-swatch w-1 shrink-0 rounded-full',
              `library-swatch-${highlight.color}`,
            )}
          />
          <blockquote className="text-text-primary text-lg leading-relaxed">
            {highlight.anchor.exact}
          </blockquote>
        </div>
        {highlight.note && (
          <p className="text-text-secondary text-sm whitespace-pre-wrap">{highlight.note}</p>
        )}
        <p className="text-text-secondary text-xs">
          <Link
            to={`/library/${document.id}${highlight.unit ? `?unit=${highlight.unit.index}` : ''}`}
            className="hover:underline"
          >
            {document.title}
          </Link>
          {document.siteName ? ` · ${document.siteName}` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => act('done')}>
            <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {localize('com_library_review_next')}
          </Button>
          <Button type="button" variant="outline" onClick={() => act('mute')}>
            <EyeOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {localize('com_library_review_mute')}
          </Button>
        </div>
        <p className="text-text-secondary text-xs">{localize('com_library_review_keys')}</p>
      </article>
    );
  }

  return (
    <div className="bg-surface-primary h-full w-full overflow-y-auto" data-testid="library-review">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link to="/library" aria-label={localize('com_library_back')}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <h1 className="text-text-primary text-xl font-semibold">
            {localize('com_library_review_title')}
          </h1>
        </div>
        {body}
      </div>
    </div>
  );
}
