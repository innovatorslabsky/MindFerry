import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockFollow = jest.fn();
const mockRefresh = jest.fn();
const mockUnfollow = jest.fn();
const mockToast = jest.fn();
let mockFeeds: { data?: { feeds: unknown[] }; isLoading: boolean } = {
  data: { feeds: [] },
  isLoading: false,
};
let followOptions: { onSuccess?: (data: unknown) => void } = {};
let refreshOptions: { onSuccess?: (data: unknown) => void; onSettled?: () => void } = {};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useLibraryFeedsQuery: () => mockFeeds,
  useFollowLibraryFeedMutation: (options: typeof followOptions) => {
    followOptions = options;
    return { mutate: mockFollow, isLoading: false };
  },
  useRefreshLibraryFeedMutation: (options: typeof refreshOptions) => {
    refreshOptions = options;
    return { mutate: mockRefresh, isLoading: false };
  },
  useUnfollowLibraryFeedMutation: () => ({ mutate: mockUnfollow }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import FeedsPanel from '../FeedsPanel';

const feed = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1',
  feedUrl: 'https://b.test/rss',
  title: 'Brain Blog',
  createdAt: '',
  ...overrides,
});

beforeEach(() => {
  mockFeeds = { data: { feeds: [] }, isLoading: false };
});
afterEach(() => jest.clearAllMocks());

describe('FeedsPanel', () => {
  it('explains an empty list', () => {
    render(<FeedsPanel />);
    expect(screen.getByText('com_library_feed_empty')).toBeInTheDocument();
  });

  it('follows the address entered and clears it once followed', () => {
    render(<FeedsPanel />);
    const input = screen.getByLabelText('com_library_feed_placeholder');
    fireEvent.change(input, { target: { value: ' https://b.test ' } });
    fireEvent.submit(input);
    expect(mockFollow).toHaveBeenCalledWith('https://b.test');
    act(() => {
      followOptions.onSuccess?.({ status: 'followed', feed: feed(), refresh: { added: 3 } });
    });
    expect(input).toHaveValue('');
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_library_feed_followed:3' }),
    );
  });

  it('keeps the address and says so when the feed is already followed', () => {
    render(<FeedsPanel />);
    const input = screen.getByLabelText('com_library_feed_placeholder');
    fireEvent.change(input, { target: { value: 'https://b.test' } });
    act(() => {
      followOptions.onSuccess?.({ status: 'exists', feed: feed() });
    });
    expect(input).toHaveValue('https://b.test');
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_library_feed_exists' }),
    );
  });

  it('lists feeds, checks one on request and reports what was added and what failed', () => {
    mockFeeds = { data: { feeds: [feed(), feed({ id: 'f2', title: 'Other' })] }, isLoading: false };
    render(<FeedsPanel />);
    expect(screen.getAllByTestId('library-feed-row')).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('com_library_feed_refresh:Brain Blog'));
    expect(mockRefresh).toHaveBeenCalledWith('f1');
    act(() => {
      refreshOptions.onSuccess?.({
        refresh: { added: 2, failed: 1, skipped: 0, notModified: false },
      });
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'com_library_feed_added:2 com_library_feed_failed_items:1',
      }),
    );
  });

  it('says there was nothing new when a check adds nothing', () => {
    mockFeeds = { data: { feeds: [feed()] }, isLoading: false };
    render(<FeedsPanel />);
    act(() => {
      refreshOptions.onSuccess?.({
        refresh: { added: 0, failed: 0, skipped: 0, notModified: true },
      });
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_library_feed_none' }),
    );
  });

  it('unfollows the chosen feed', () => {
    mockFeeds = { data: { feeds: [feed()] }, isLoading: false };
    render(<FeedsPanel />);
    fireEvent.click(screen.getByLabelText('com_library_feed_unfollow:Brain Blog'));
    expect(mockUnfollow).toHaveBeenCalledWith('f1');
  });
});
