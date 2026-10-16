import type { FeedFetchResult } from '../feed/fetchFeed';
import type { FeedDraft } from '../feed/parseFeed';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { MAX_FOLLOWED_FEEDS, createLibraryService } from '../service';
import { NotReadableError } from '../ingest/extract';
import { saveHtml } from '../core';

const FEED_URL = 'https://blog.test/feed.xml';
const user = 'user-a';
const other = 'user-b';

const body = (n: number) =>
  `<p>${Array.from({ length: 12 }, () => `Article ${n} explains spaced repetition in some depth.`).join(' ')}</p>`;

function item(n: number) {
  return {
    guid: `guid-${n}`,
    url: `https://blog.test/post-${n}`,
    title: `Post ${n}`,
    author: null,
    publishedAt: null,
    summaryHtml: null,
    contentHtml: null,
    enclosures: [],
    categories: [],
  };
}

function feedResult(items: number[], extra: Partial<FeedFetchResult> = {}): FeedFetchResult {
  const feed: FeedDraft = {
    format: 'rss',
    title: 'Blog',
    siteUrl: 'https://blog.test',
    feedUrl: FEED_URL,
    description: null,
    language: null,
    items: items.map(item),
  };
  return { feed, notModified: false, feedUrl: FEED_URL, etag: 'v1', lastModified: null, ...extra };
}

function setup(options: { broken?: Set<string>; polls?: FeedFetchResult[] } = {}) {
  const fake = createFakeLibraryMethods();
  const fetched: string[] = [];
  const polledWith: Array<{ etag?: string | null; lastModified?: string | null }> = [];
  const polls = options.polls ?? [];
  const service = createLibraryService({
    methods: fake.methods,
    ingest: {
      subscribeToUrl: async () => polls.shift()!,
      fetchFeed: async (_url, validators) => {
        polledWith.push(validators);
        return polls.shift()!;
      },
      saveUrl: async (url: string) => {
        fetched.push(url);
        if (options.broken?.has(url)) throw new NotReadableError('unreadable');
        return saveHtml(
          url,
          `<html><head><title>${url}</title></head><body><article>${body(fetched.length)}</article></body></html>`,
        );
      },
    },
  });
  return { ...fake, service, fetched, polledWith };
}

describe('followFeed', () => {
  it('saves only the newest few items to the Feed tab on the first read', async () => {
    const { service, documents, fetched } = setup({ polls: [feedResult([1, 2, 3, 4, 5, 6, 7])] });
    const outcome = await service.followFeed(user, 'https://blog.test');
    expect(outcome.status).toBe('followed');
    if (outcome.status !== 'followed') return;
    expect(outcome.refresh).toMatchObject({ added: 5, skipped: 2, failed: 0 });
    expect(fetched).toHaveLength(5);
    expect([...documents.values()].every((d) => d.location === 'feed')).toBe(true);
  });

  it('does not follow a feed twice', async () => {
    const { service, feeds } = setup({ polls: [feedResult([1]), feedResult([1])] });
    await service.followFeed(user, FEED_URL);
    const again = await service.followFeed(user, FEED_URL);
    expect(again.status).toBe('exists');
    expect(feeds.size).toBe(1);
  });

  it('stops at the follow limit without saving anything', async () => {
    const polls = Array.from({ length: MAX_FOLLOWED_FEEDS + 1 }, (_, i) =>
      feedResult([], {}).feed
        ? {
            ...feedResult([]),
            feed: { ...feedResult([]).feed!, feedUrl: `https://f${i}.test/rss` },
          }
        : feedResult([]),
    );
    const { service, documents } = setup({ polls });
    for (let i = 0; i < MAX_FOLLOWED_FEEDS; i++) {
      expect((await service.followFeed(user, `https://f${i}.test`)).status).toBe('followed');
    }
    expect((await service.followFeed(user, 'https://over.test')).status).toBe('limit');
    expect(documents.size).toBe(0);
  });
});

describe('refreshFeed', () => {
  it('saves only items not seen before, and sends the stored validators', async () => {
    const { service, documents, polledWith } = setup({
      polls: [feedResult([1, 2]), feedResult([1, 2, 3, 4], { etag: 'v2' })],
    });
    const followed = await service.followFeed(user, FEED_URL);
    if (followed.status !== 'followed') throw new Error('expected followed');
    expect(documents.size).toBe(2);
    const refreshed = await service.refreshFeed(user, followed.feed.id);
    expect(refreshed).toMatchObject({ added: 2, failed: 0, notModified: false });
    expect(polledWith[0]).toMatchObject({ etag: 'v1' });
    expect(documents.size).toBe(4);
  });

  it('counts an unreadable item and does not try it again', async () => {
    const broken = new Set(['https://blog.test/post-2']);
    const { service, fetched } = setup({
      broken,
      polls: [feedResult([1]), feedResult([1, 2]), feedResult([1, 2])],
    });
    const followed = await service.followFeed(user, FEED_URL);
    if (followed.status !== 'followed') throw new Error('expected followed');
    expect(await service.refreshFeed(user, followed.feed.id)).toMatchObject({
      added: 0,
      failed: 1,
    });
    expect(await service.refreshFeed(user, followed.feed.id)).toMatchObject({
      added: 0,
      failed: 0,
    });
    expect(fetched.filter((u) => u.endsWith('post-2'))).toHaveLength(1);
  });

  it('caps one refresh and carries the rest over as skipped', async () => {
    const many = Array.from({ length: 30 }, (_, i) => i + 100);
    const { service, documents } = setup({ polls: [feedResult([1]), feedResult([1, ...many])] });
    const followed = await service.followFeed(user, FEED_URL);
    if (followed.status !== 'followed') throw new Error('expected followed');
    const refreshed = await service.refreshFeed(user, followed.feed.id);
    expect(refreshed).toMatchObject({ added: 10, skipped: 20 });
    expect(documents.size).toBe(11);
  });

  it('handles a 304 without saving anything', async () => {
    const notModified: FeedFetchResult = {
      feed: null,
      notModified: true,
      feedUrl: FEED_URL,
      etag: 'v1',
      lastModified: null,
    };
    const { service, documents } = setup({ polls: [feedResult([1]), notModified] });
    const followed = await service.followFeed(user, FEED_URL);
    if (followed.status !== 'followed') throw new Error('expected followed');
    const refreshed = await service.refreshFeed(user, followed.feed.id);
    expect(refreshed).toMatchObject({ added: 0, notModified: true });
    expect(documents.size).toBe(1);
  });

  it('does not let another user refresh or unfollow a feed', async () => {
    const { service, feeds } = setup({ polls: [feedResult([1])] });
    const followed = await service.followFeed(user, FEED_URL);
    if (followed.status !== 'followed') throw new Error('expected followed');
    expect(await service.refreshFeed(other, followed.feed.id)).toBeNull();
    expect(await service.unfollowFeed(other, followed.feed.id)).toBe(false);
    expect(await service.listFeeds(other)).toEqual([]);
    expect(feeds.size).toBe(1);
    expect(await service.unfollowFeed(user, followed.feed.id)).toBe(true);
  });
});
