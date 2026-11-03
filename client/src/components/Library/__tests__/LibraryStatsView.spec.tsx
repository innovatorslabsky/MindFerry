import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

let mockResult: { data?: unknown; isLoading: boolean; isError: boolean };
const mockDays: number[] = [];

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));
jest.mock('~/data-provider', () => ({
  useLibraryStatsQuery: (days: number) => {
    mockDays.push(days);
    return mockResult;
  },
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  Spinner: () => <div data-testid="spinner" />,
}));

import LibraryStatsView from '../LibraryStatsView';

const day = (date: string, seconds: number) => ({
  date,
  seconds,
  words: seconds * 3,
  sessions: seconds ? 1 : 0,
});
const stats = {
  days: [day('2026-03-08', 0), day('2026-03-09', 1800), day('2026-03-10', 900)],
  totals: { seconds: 2700, words: 8100, sessions: 2, documents: 2, finished: 1 },
  longestSessionSeconds: 1800,
};

const renderView = () => render(<LibraryStatsView />, { wrapper: MemoryRouter });

beforeEach(() => {
  mockDays.length = 0;
  mockResult = { data: { stats }, isLoading: false, isError: false };
});

describe('LibraryStatsView', () => {
  it('shows the totals and a bar for every day, tallest for the busiest', () => {
    renderView();
    const cards = screen.getAllByTestId('library-stat').map((card) => card.textContent);
    expect(cards.join('|')).toContain('com_library_duration_m:45');
    expect(cards.join('|')).toContain('8,100');
    expect(cards.join('|')).toContain('com_library_session_count:2');
    expect(screen.getAllByTestId('library-stats-day')).toHaveLength(3);
    const bars = screen
      .getAllByTestId('library-stats-day')
      .map((item) => (item.querySelector('div') as HTMLElement).style.height);
    expect(bars[1]).toBe('100%');
    expect(bars[2]).toBe('50%');
    expect(bars[0]).toBe('2px');
  });

  it('asks for a month first and for another period when chosen', () => {
    renderView();
    expect(mockDays[0]).toBe(30);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_stats_days:7' }));
    expect(mockDays[mockDays.length - 1]).toBe(7);
    expect(screen.getByRole('button', { name: 'com_library_stats_days:7' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('says so when nothing was read, while loading, and when it could not load', () => {
    mockResult = {
      data: { stats: { ...stats, totals: { ...stats.totals, sessions: 0, finished: 0 } } },
      isLoading: false,
      isError: false,
    };
    const { rerender } = renderView();
    expect(screen.getByTestId('library-stats-empty')).toBeInTheDocument();

    mockResult = { isLoading: true, isError: false };
    rerender(<LibraryStatsView />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();

    mockResult = { isLoading: false, isError: true };
    rerender(<LibraryStatsView />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_library_stats_error');
  });
});
