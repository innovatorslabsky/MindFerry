import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockMark = jest.fn();
const mockToast = jest.fn();
let mockReview: { data?: unknown; isLoading: boolean; isError: boolean };
let mockExtra: number | undefined;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useLibraryReviewQuery: (extra: number) => {
    mockExtra = extra;
    return mockReview;
  },
  useReviewLibraryHighlightMutation: () => ({ mutate: mockMark }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import ReviewView from '../ReviewView';

const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  highlight: {
    id,
    documentId: 'd1',
    anchor: { exact: `Quote ${id}`, prefix: '', suffix: '', start: 0, end: 5 },
    color: 'green',
    tags: [],
    contentHash: 'h',
    orphaned: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  },
  document: { id: 'd1', title: 'Spaced repetition', siteName: 'example.test', kind: 'article' },
});

const renderView = () => render(<ReviewView />, { wrapper: MemoryRouter });

beforeEach(() => {
  mockReview = {
    isLoading: false,
    isError: false,
    data: { items: [item('a'), item('b')], reviewedToday: 1, goal: 3 },
  };
  mockExtra = undefined;
});
afterEach(() => jest.clearAllMocks());

describe('ReviewView', () => {
  it('shows one highlight at a time with where it came from', () => {
    renderView();

    expect(screen.getByText('Quote a')).toBeInTheDocument();
    expect(screen.queryByText('Quote b')).not.toBeInTheDocument();
    expect(screen.getByText('com_library_review_progress:1,2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Spaced repetition' })).toHaveAttribute(
      'href',
      '/library/d1',
    );
  });

  it('opens a book highlight at its chapter or page', () => {
    mockReview = {
      isLoading: false,
      isError: false,
      data: {
        items: [item('a', { unit: { kind: 'page', index: 4 } })],
        reviewedToday: 0,
        goal: 5,
      },
    };
    renderView();

    expect(screen.getByRole('link', { name: 'Spaced repetition' })).toHaveAttribute(
      'href',
      '/library/d1?unit=4',
    );
  });

  it('marks a card done and moves on, then stops at the end of the day', () => {
    renderView();

    fireEvent.click(screen.getByText('com_library_review_next'));
    expect(mockMark).toHaveBeenCalledWith({ id: 'a', action: 'done' }, expect.anything());
    expect(screen.getByText('Quote b')).toBeInTheDocument();

    fireEvent.click(screen.getByText('com_library_review_next'));
    expect(screen.getByTestId('review-done')).toHaveTextContent('com_library_review_done');
  });

  it('sets a card aside for good', () => {
    renderView();

    fireEvent.click(screen.getByText('com_library_review_mute'));

    expect(mockMark).toHaveBeenCalledWith({ id: 'a', action: 'mute' }, expect.anything());
  });

  it('works from the keyboard', () => {
    renderView();

    fireEvent.keyDown(window, { key: 'd' });
    fireEvent.keyDown(window, { key: 'm' });

    expect(mockMark).toHaveBeenNthCalledWith(1, { id: 'a', action: 'done' }, expect.anything());
    expect(mockMark).toHaveBeenNthCalledWith(2, { id: 'b', action: 'mute' }, expect.anything());
  });

  it('asks for more after the goal is met', () => {
    renderView();
    fireEvent.keyDown(window, { key: 'd' });
    fireEvent.keyDown(window, { key: 'd' });

    act(() => {
      fireEvent.click(screen.getByText('com_library_review_more:5'));
    });

    expect(mockExtra).toBe(5);
  });

  it('says so when there is nothing yet, without offering more', () => {
    mockReview = {
      isLoading: false,
      isError: false,
      data: { items: [], reviewedToday: 0, goal: 5 },
    };
    renderView();

    expect(screen.getByTestId('review-done')).toHaveTextContent('com_library_review_none');
    expect(screen.queryByText('com_library_review_more:5')).not.toBeInTheDocument();
  });

  it('shows a spinner while loading and a message when it fails', () => {
    mockReview = { isLoading: true, isError: false };
    const { unmount } = renderView();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    unmount();

    mockReview = { isLoading: false, isError: true };
    renderView();
    expect(screen.getByText('com_library_load_error')).toBeInTheDocument();
  });
});
