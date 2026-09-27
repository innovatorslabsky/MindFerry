import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, waitFor } from 'test/layout-test-utils';
import BrowseHubDialog from '../BrowseHubDialog';

const mockUseListHubThreadsQuery = jest.fn();
const mockUseGetHubThreadQuery = jest.fn();
const mockUseListHubNotesQuery = jest.fn();

jest.mock('~/data-provider/Hub/queries', () => ({
  ...jest.requireActual('~/data-provider/Hub/queries'),
  useListHubThreadsQuery: (...args: unknown[]) => mockUseListHubThreadsQuery(...args),
  useGetHubThreadQuery: (...args: unknown[]) => mockUseGetHubThreadQuery(...args),
  useListHubNotesQuery: (...args: unknown[]) => mockUseListHubNotesQuery(...args),
}));

const thread = {
  id: 'mindferry:session-1',
  provider: 'mindferry',
  title: 'Deciding on the sync mechanism',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  messageCount: 2,
};

describe('BrowseHubDialog', () => {
  beforeEach(() => {
    mockUseListHubThreadsQuery.mockReturnValue({
      data: { threads: [thread] },
      isLoading: false,
      isError: false,
    });
    mockUseListHubNotesQuery.mockReturnValue({ data: { notes: [] } });
    mockUseGetHubThreadQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  });

  it('renders a Browse trigger without opening the dialog', () => {
    const { getByRole, queryByText } = render(<BrowseHubDialog />);
    expect(getByRole('button', { name: 'Browse' })).toBeInTheDocument();
    expect(queryByText('MindFerry Archive')).not.toBeInTheDocument();
  });

  it('lists archived threads once opened', () => {
    const { getByRole, getByText } = render(<BrowseHubDialog />);
    fireEvent.click(getByRole('button', { name: 'Browse' }));

    expect(getByText('MindFerry Archive')).toBeInTheDocument();
    expect(getByText('Deciding on the sync mechanism')).toBeInTheDocument();
  });

  it('shows the empty state when there are no archived threads', () => {
    mockUseListHubThreadsQuery.mockReturnValue({
      data: { threads: [] },
      isLoading: false,
      isError: false,
    });
    const { getByRole, getByText } = render(<BrowseHubDialog />);
    fireEvent.click(getByRole('button', { name: 'Browse' }));

    expect(getByText('No archived conversations yet')).toBeInTheDocument();
  });

  it('passes the typed search term through to the threads query', () => {
    const { getByRole } = render(<BrowseHubDialog />);
    fireEvent.click(getByRole('button', { name: 'Browse' }));

    fireEvent.change(getByRole('textbox', { name: 'Search' }), {
      target: { value: 'sync' },
    });

    expect(mockUseListHubThreadsQuery).toHaveBeenLastCalledWith(
      { q: 'sync', limit: 50 },
      expect.any(Object),
    );
  });

  it('opens a thread detail view on selection and can go back to the list', async () => {
    mockUseGetHubThreadQuery.mockReturnValue({
      data: {
        thread: {
          id: 'mindferry:session-1',
          provider: 'mindferry',
          sourceId: 'session-1',
          title: 'Deciding on the sync mechanism',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          messages: [
            {
              id: 'm1',
              role: 'user',
              createdAt: '2026-01-01T00:00:00Z',
              segments: [{ kind: 'text', text: 'How should two clients share context?' }],
              parentId: null,
            },
          ],
        },
      },
      isLoading: false,
      isError: false,
    });

    const { getByRole, getByText, queryByText } = render(<BrowseHubDialog />);
    fireEvent.click(getByRole('button', { name: 'Browse' }));
    fireEvent.click(getByText('Deciding on the sync mechanism'));

    await waitFor(() =>
      expect(getByText('How should two clients share context?')).toBeInTheDocument(),
    );
    expect(queryByText('MindFerry Archive')).toBeInTheDocument();

    fireEvent.click(getByRole('button', { name: 'Back' }));
    expect(queryByText('How should two clients share context?')).not.toBeInTheDocument();
  });
});
