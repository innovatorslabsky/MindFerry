import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TLibraryDocumentSummary } from 'librechat-data-provider';
import { mockClient } from 'test/libraryMocks';

const mockMutate = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useUpdateLibraryDocumentMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: jest.fn() }),
}));

import ReadingStatus from '../ReadingStatus';

const documentWith = (extra: Partial<TLibraryDocumentSummary> = {}) =>
  ({ id: 'd1', ...extra }) as TLibraryDocumentSummary;

afterEach(() => jest.clearAllMocks());

describe('ReadingStatus', () => {
  it('shows the current status and stars', () => {
    render(<ReadingStatus document={documentWith({ readingStatus: 'finished', rating: 3 })} />);

    expect(screen.getByTestId('library-status-select')).toHaveValue('finished');
    expect(screen.getByTestId('library-star-3')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('library-star-4')).toHaveAttribute('aria-pressed', 'false');
  });

  it('changes the status, and takes it off again with "No status"', () => {
    render(<ReadingStatus document={documentWith({ readingStatus: 'reading' })} />);
    const select = screen.getByTestId('library-status-select');

    fireEvent.change(select, { target: { value: 'finished' } });
    expect(mockMutate).toHaveBeenLastCalledWith({
      id: 'd1',
      patch: { readingStatus: 'finished' },
    });
    fireEvent.change(select, { target: { value: '' } });
    expect(mockMutate).toHaveBeenLastCalledWith({ id: 'd1', patch: { readingStatus: null } });
  });

  it('gives stars, and takes the rating off when the same star is pressed again', () => {
    const { rerender } = render(<ReadingStatus document={documentWith()} />);
    fireEvent.click(screen.getByTestId('library-star-4'));
    expect(mockMutate).toHaveBeenLastCalledWith({ id: 'd1', patch: { rating: 4 } });

    rerender(<ReadingStatus document={documentWith({ rating: 4 })} />);
    fireEvent.click(screen.getByTestId('library-star-4'));
    expect(mockMutate).toHaveBeenLastCalledWith({ id: 'd1', patch: { rating: null } });
  });
});
