import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { RecoilRoot } from 'recoil';
import { render, fireEvent, waitFor, within } from 'test/layout-test-utils';
import BrowseHubDialog from '../BrowseHubDialog';
import store from '~/store';

const mockUseListHubThreadsQuery = jest.fn();
const mockUseGetHubThreadQuery = jest.fn();
const mockUseListHubNotesQuery = jest.fn();
const mockContinueHubThread = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      continueHubThread: (...args: unknown[]) => mockContinueHubThread(...args),
    },
  };
});

jest.mock('~/data-provider/Hub/queries', () => ({
  ...jest.requireActual('~/data-provider/Hub/queries'),
  useListHubThreadsQuery: (...args: unknown[]) => mockUseListHubThreadsQuery(...args),
  useGetHubThreadQuery: (...args: unknown[]) => mockUseGetHubThreadQuery(...args),
  useListHubNotesQuery: (...args: unknown[]) => mockUseListHubNotesQuery(...args),
}));

/** Radix tabs switch on mouse down, not click. */
const openNotesTab = (getByRole: (role: string, options: { name: RegExp }) => HTMLElement) =>
  fireEvent.mouseDown(getByRole('tab', { name: /^Notes/ }));

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
      openNotesTab(getByRole);

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
    openNotesTab(getByRole);

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

  describe('continue in chat', () => {
    const detailThread = {
      id: 'mindferry:session-1',
      provider: 'mindferry',
      surface: 'code',
      sourceId: 'session-1',
      title: 'Deciding on the sync mechanism',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      messages: [],
    };

    const openDetail = (conversation?: Record<string, unknown>) => {
      const utils = render(
        <RecoilRoot
          initializeState={({ set }) => {
            if (conversation) {
              set(store.conversationByIndex(0), conversation as never);
            }
          }}
        >
          <BrowseHubDialog />
        </RecoilRoot>,
      );
      fireEvent.click(utils.getByRole('button', { name: 'Browse' }));
      fireEvent.click(utils.getByText('Deciding on the sync mechanism'));
      return utils;
    };

    beforeEach(() => {
      window.history.pushState({}, '', '/c/new');
      mockUseGetHubThreadQuery.mockReturnValue({
        data: { thread: detailThread },
        isLoading: false,
        isError: false,
      });
      mockContinueHubThread
        .mockReset()
        .mockResolvedValue({ conversationId: 'new-convo', messageCount: 2 });
    });

    it('opens the archived thread as a new chat and leaves the archive', async () => {
      const { getByRole, queryByText } = openDetail();

      fireEvent.click(getByRole('button', { name: 'Continue in chat' }));

      await waitFor(() => expect(window.location.pathname).toBe('/c/new-convo'));
      expect(mockContinueHubThread).toHaveBeenCalledWith('mindferry:session-1', undefined);
      expect(queryByText('MindFerry Archive')).not.toBeInTheDocument();
    });

    it('runs the new chat on the endpoint and model of the chat that is open now', async () => {
      const { getByRole } = openDetail({ endpoint: 'anthropic', model: 'claude-sonnet-4-6' });

      fireEvent.click(getByRole('button', { name: 'Continue in chat' }));

      await waitFor(() => expect(mockContinueHubThread).toHaveBeenCalled());
      expect(mockContinueHubThread).toHaveBeenCalledWith('mindferry:session-1', {
        endpoint: 'anthropic',
        model: 'claude-sonnet-4-6',
      });
    });

    it('leaves the choice to the server when the open chat is an agent or assistant chat', async () => {
      const { getByRole } = openDetail({ endpoint: 'agents', model: null });

      fireEvent.click(getByRole('button', { name: 'Continue in chat' }));

      await waitFor(() => expect(mockContinueHubThread).toHaveBeenCalled());
      expect(mockContinueHubThread).toHaveBeenCalledWith('mindferry:session-1', undefined);
    });

    it('stays on the thread and does not navigate when making the chat fails', async () => {
      mockContinueHubThread.mockRejectedValue(new Error('boom'));
      const { getByRole, getByText } = openDetail();

      fireEvent.click(getByRole('button', { name: 'Continue in chat' }));

      await waitFor(() => expect(mockContinueHubThread).toHaveBeenCalled());
      await waitFor(() =>
        expect(getByRole('button', { name: 'Continue in chat' })).not.toBeDisabled(),
      );
      expect(window.location.pathname).toBe('/c/new');
      expect(getByText('MindFerry Archive')).toBeInTheDocument();
    });

    it('disables the button while the chat is being made, so it is not made twice', async () => {
      let finish: (value: { conversationId: string; messageCount: number }) => void = () =>
        undefined;
      mockContinueHubThread.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const { getByRole } = openDetail();

      fireEvent.click(getByRole('button', { name: 'Continue in chat' }));

      await waitFor(() => expect(getByRole('button', { name: 'Continue in chat' })).toBeDisabled());
      finish({ conversationId: 'new-convo', messageCount: 1 });
      await waitFor(() => expect(window.location.pathname).toBe('/c/new-convo'));
      expect(mockContinueHubThread).toHaveBeenCalledTimes(1);
    });

    it('offers no button until the thread has loaded', () => {
      mockUseGetHubThreadQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });
      const { queryByRole } = openDetail();

      expect(queryByRole('button', { name: 'Continue in chat' })).not.toBeInTheDocument();
    });
  });
});
