import { useState } from 'react';
import { RefreshCw, Rss, X } from 'lucide-react';
import { Button, Input, Spinner, useToastContext } from '@librechat/client';
import type { TLibraryFeed, TLibraryFeedRefresh } from 'librechat-data-provider';
import {
  useFollowLibraryFeedMutation,
  useLibraryFeedsQuery,
  useRefreshLibraryFeedMutation,
  useUnfollowLibraryFeedMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { libraryErrorKey } from './errors';
import { useLocalize } from '~/hooks';

function FeedRow({
  feed,
  checking,
  onRefresh,
  onUnfollow,
}: {
  feed: TLibraryFeed;
  checking: boolean;
  onRefresh: (feed: TLibraryFeed) => void;
  onUnfollow: (feed: TLibraryFeed) => void;
}) {
  const localize = useLocalize();
  const checked = feed.lastRefreshedAt
    ? localize('com_library_feed_checked', {
        0: new Date(feed.lastRefreshedAt).toLocaleString(),
      })
    : localize('com_library_feed_never');
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-testid="library-feed-row">
      <Rss className="text-text-secondary h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary truncate text-sm font-medium">{feed.title}</p>
        <p className="text-text-secondary truncate text-xs">{checked}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={checking}
        aria-label={localize('com_library_feed_refresh', { 0: feed.title })}
        onClick={() => onRefresh(feed)}
      >
        {checking ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={localize('com_library_feed_unfollow', { 0: feed.title })}
        onClick={() => onUnfollow(feed)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

/** Follow a feed or a site, and check the feeds you follow. Checking is always something you ask for. */
export default function FeedsPanel() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [address, setAddress] = useState('');
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const feeds = useLibraryFeedsQuery();

  const say = (message: string, status: NotificationSeverity = NotificationSeverity.SUCCESS) =>
    showToast({ message, status });
  const report = (refresh: TLibraryFeedRefresh) => {
    const parts = [
      refresh.added > 0
        ? localize('com_library_feed_added', { 0: refresh.added })
        : localize('com_library_feed_none'),
      refresh.failed > 0 ? localize('com_library_feed_failed_items', { 0: refresh.failed }) : '',
    ];
    say(parts.filter(Boolean).join(' '));
  };

  const follow = useFollowLibraryFeedMutation({
    onSuccess: (data) => {
      if (data.status === 'exists') {
        return say(localize('com_library_feed_exists'));
      }
      setAddress('');
      say(localize('com_library_feed_followed', { 0: data.refresh.added }));
    },
    onError: (error) =>
      say(localize(libraryErrorKey(error, 'com_library_feed_error')), NotificationSeverity.ERROR),
  });
  const refresh = useRefreshLibraryFeedMutation({
    onSuccess: (data) => report(data.refresh),
    onError: (error) =>
      say(localize(libraryErrorKey(error, 'com_library_feed_error')), NotificationSeverity.ERROR),
    onSettled: () => setCheckingId(null),
  });
  const unfollow = useUnfollowLibraryFeedMutation({
    onError: () => say(localize('com_library_feed_unfollow_error'), NotificationSeverity.ERROR),
  });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const url = address.trim();
    if (url) {
      follow.mutate(url);
    }
  };
  const onRefresh = (feed: TLibraryFeed) => {
    setCheckingId(feed.id);
    refresh.mutate(feed.id);
  };

  const rows = feeds.data?.feeds ?? [];
  return (
    <section aria-label={localize('com_library_feeds_title')} className="flex flex-col gap-3">
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          type="url"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={localize('com_library_feed_placeholder')}
          aria-label={localize('com_library_feed_placeholder')}
          maxLength={2048}
          disabled={follow.isLoading}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={follow.isLoading || address.trim() === ''}>
          {follow.isLoading ? <Spinner className="h-4 w-4" /> : localize('com_library_feed_follow')}
        </Button>
      </form>
      {feeds.isLoading && (
        <div className="flex justify-center py-4">
          <Spinner className="h-5 w-5" />
        </div>
      )}
      {!feeds.isLoading && rows.length === 0 && (
        <p className="text-text-secondary text-sm">{localize('com_library_feed_empty')}</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-border-light border-border-light divide-y overflow-hidden rounded-xl border">
          {rows.map((feed) => (
            <FeedRow
              key={feed.id}
              feed={feed}
              checking={checkingId === feed.id}
              onRefresh={onRefresh}
              onUnfollow={(target) => unfollow.mutate(target.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
