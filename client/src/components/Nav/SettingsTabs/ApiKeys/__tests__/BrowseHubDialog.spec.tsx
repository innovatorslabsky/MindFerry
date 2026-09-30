import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, waitFor, within } from 'test/layout-test-utils';
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

  describe('source of each conversation', () => {
    const codeThread = {
      ...thread,
      id: 'mindferry:code-1',
      title: 'A terminal session',
      surface: 'code',
    };

    it('labels each conversation with the client it came from, defaulting to chat', () => {
      mockUseListHubThreadsQuery.mockReturnValue({
        data: { threads: [codeThread, thread] },
        isLoading: false,
        isError: false,
      });
      const { getByRole, getByText } = render(<BrowseHubDialog />);
      fireEvent.click(getByRole('button', { name: 'Browse' }));

      expect(getByText(/^Claude Code · mindferry/)).toBeInTheDocument();
      expect(getByText(/^Chat · mindferry/)).toBeInTheDocument();
    });

    it('asks for only one surface once a source filter is chosen, and back to all', () => {
      const { getByRole } = render(<BrowseHubDialog />);
      fireEvent.click(getByRole('button', { name: 'Browse' }));
      const filters = within(getByRole('group', { name: 'Filter by source' }));

      fireEvent.click(filters.getByRole('button', { name: 'Claude Code' }));
      expect(mockUseListHubThreadsQuery).toHaveBeenLastCalledWith(
        { q: undefined, limit: 50, surface: 'code' },
        expect.any(Object),
      );
      expect(filters.getByRole('button', { name: 'Claude Code' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      fireEvent.click(filters.getByRole('button', { name: 'All' }));
      expect(mockUseListHubThreadsQuery).toHaveBeenLastCalledWith(
        { q: undefined, limit: 50, surface: undefined },
        expect.any(Object),
      );
    });

    it('filters the notes to the chosen source too', () => {
      mockUseListHubNotesQuery.mockReturnValue({
        data: {
          notes: [
            {
              id: 'n1',
              title: 'From code',
              text: 'a',
              surface: 'code',
              createdAt: '2026-01-01T00:00:00Z',
            },
            {
              id: 'n2',
              title: 'From chat',
              text: 'b',
              surface: 'chat',
              createdAt: '2026-01-02T00:00:00Z',
            },
          ],
        },
      });
      const { getByRole, queryByText } = render(<BrowseHubDialog />);
      fireEvent.click(getByRole('button', { name: 'Browse' }));

      fireEvent.click(
        within(getByRole('group', { name: 'Filter by source' })).getByRole('button', {
          name: 'Claude Code',
        }),
      );

      expect(queryByText('From code')).toBeInTheDocument();
      expect(queryByText('From chat')).not.toBeInTheDocument();
    });
  });

  it('lists the newest note first', () => {
    mockUseListHubNotesQuery.mockReturnValue({
      data: {
        notes: [
          { id: 'n1', title: 'Oldest note', text: 'a', createdAt: '2026-01-01T00:00:00Z' },
          { id: 'n2', title: 'Newest note', text: 'b', createdAt: '2026-03-01T00:00:00Z' },
          { id: 'n3', title: 'Middle note', text: 'c', createdAt: '2026-02-01T00:00:00Z' },
        ],
      },
    });
    const { getByRole, getAllByText } = render(<BrowseHubDialog />);
    fireEvent.click(getByRole('button', { name: 'Browse' }));

    const titles = getAllByText(/ note$/).map((element) => element.textContent);
    expect(titles).toEqual(['Newest note', 'Middle note', 'Oldest note']);
  });

  it('shows the notes anchored to a conversation inside its detail view', async () => {
    mockUseGetHubThreadQuery.mockReturnValue({
      data: {
        thread: {
          id: 'mindferry:session-1',
          provider: 'mindferry',
          surface: 'code',
          sourceId: 'session-1',
          title: 'Deciding on the sync mechanism',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          messages: [],
        },
      },
      isLoading: false,
      isError: false,
    });
    mockUseListHubNotesQuery.mockImplementation((threadId?: string) => ({
      data: {
        notes: threadId
          ? [
              {
                id: 'n1',
                title: 'Anchored summary',
                text: 'Decided X',
                threadId,
                createdAt: '2026-01-02T00:00:00Z',
              },
            ]
          : [],
      },
    }));

    const { getByRole, getByText } = render(<BrowseHubDialog />);
    fireEvent.click(getByRole('button', { name: 'Browse' }));
    fireEvent.click(getByText('Deciding on the sync mechanism'));

    await waitFor(() => expect(getByText('Notes on this conversation')).toBeInTheDocument());
    expect(getByText('Anchored summary')).toBeInTheDocument();
    expect(mockUseListHubNotesQuery).toHaveBeenCalledWith('mindferry:session-1');
  });
});
