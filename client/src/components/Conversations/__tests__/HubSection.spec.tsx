import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { Provider, createStore } from 'jotai';
import { render, fireEvent, waitFor, within } from 'test/layout-test-utils';
import { chatFilterStatusAtom } from '../chatFilters';
import HubSection from '../HubSection';

const mockUseListHubThreadsQuery = jest.fn();
const mockUseGetHubThreadQuery = jest.fn();
const mockUseListHubNotesQuery = jest.fn();
const mockContinueHubThread = jest.fn();
const mockContinueHubNote = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      continueHubThread: (...args: unknown[]) => mockContinueHubThread(...args),
      continueHubNote: (...args: unknown[]) => mockContinueHubNote(...args),
    },
  };
});

jest.mock('~/data-provider/Hub/queries', () => ({
  ...jest.requireActual('~/data-provider/Hub/queries'),
  useListHubThreadsQuery: (...args: unknown[]) => mockUseListHubThreadsQuery(...args),
  useGetHubThreadQuery: (...args: unknown[]) => mockUseGetHubThreadQuery(...args),
  useListHubNotesQuery: (...args: unknown[]) => mockUseListHubNotesQuery(...args),
}));

const longText = `Next step: update the plugin.\n\n${'Details of the handoff. '.repeat(40)}`;

const notes = [
  {
    id: 'note-old',
    title: 'Older handoff',
    text: 'Older text',
    surface: 'chat',
    createdAt: '2026-09-29T00:00:00Z',
  },
  {
    id: 'note-new',
    title: 'Plugin handoff',
    text: longText,
    surface: 'code',
    sessionTag: 'claude-code-session_0157',
    threadId: 'mindferry:session-1',
    createdAt: '2026-09-30T18:55:49Z',
  },
];

/** Radix tabs switch on mouse down, not click. */
const openTab = (
  getByRole: (role: string, options: { name: RegExp }) => HTMLElement,
  name: RegExp,
) => fireEvent.mouseDown(getByRole('tab', { name }));

const thread = {
  id: 'mindferry:session-1',
  provider: 'mindferry',
  surface: 'code',
  title: 'A Claude Code session',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  messageCount: 4,
};

const mockToggleNav = jest.fn();
let store: ReturnType<typeof createStore>;

/** The section as Chat History hosts it in Archived: following the sidebar search, no field of its own. */
function ArchivePanel({ query = '' }: { query?: string }) {
  return (
    <Provider store={store}>
      <HubSection query={query} toggleNav={mockToggleNav} />
    </Provider>
  );
}

describe('HubSection', () => {
  beforeEach(() => {
    store = createStore();
    store.set(chatFilterStatusAtom, 'archived');
    mockToggleNav.mockReset();
    window.history.pushState({}, '', '/c/new');
    mockUseListHubThreadsQuery.mockReturnValue({
      data: { threads: [thread] },
      isLoading: false,
      isError: false,
    });
    mockUseListHubNotesQuery.mockReturnValue({ data: { notes: [] } });
    mockUseGetHubThreadQuery.mockReturnValue({
      data: { thread: { ...thread, sourceId: 'session-1', messages: [] } },
      isLoading: false,
      isError: false,
    });
    mockContinueHubNote
      .mockReset()
      .mockResolvedValue({ conversationId: 'note-convo', messageCount: 1 });
    mockContinueHubThread
      .mockReset()
      .mockResolvedValue({ conversationId: 'new-convo', messageCount: 4 });
  });

  it('lists the archived conversations from other clients, leaving out chats still in the list', () => {
    const { getByText, getByRole } = render(<ArchivePanel />);

    expect(getByRole('region', { name: 'Claude.ai & Claude Code' })).toBeInTheDocument();
    expect(getByText('A Claude Code session')).toBeInTheDocument();
    expect(getByText(/^Claude Code · mindferry/)).toBeInTheDocument();
    expect(mockUseListHubThreadsQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ excludeLive: true }),
      expect.anything(),
    );
  });

  it('follows the Chat History search instead of showing a field of its own', () => {
    const { queryByLabelText } = render(<ArchivePanel query="checkout" />);

    expect(queryByLabelText('Search')).not.toBeInTheDocument();
    expect(mockUseListHubThreadsQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'checkout' }),
      expect.anything(),
    );
  });

  it('collapses and expands under its heading', () => {
    const { getByRole, queryByText } = render(<ArchivePanel />);
    const heading = getByRole('button', { name: 'Claude.ai & Claude Code' });

    expect(heading).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect(queryByText('A Claude Code session')).toBeInTheDocument();
  });

  it('shows the loading and error states of the list', () => {
    mockUseListHubThreadsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    const loading = render(<ArchivePanel />);
    expect(loading.queryByText('A Claude Code session')).not.toBeInTheDocument();
    loading.unmount();

    mockUseListHubThreadsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    const failed = render(<ArchivePanel />);
    expect(failed.getByText("Couldn't load the MindFerry archive")).toBeInTheDocument();
  });

  it('continues a conversation as a chat and switches back to Chats, where that chat now is', async () => {
    const { getByText, getByRole } = render(<ArchivePanel />);

    fireEvent.click(getByText('A Claude Code session'));
    fireEvent.click(getByRole('button', { name: 'Continue in chat' }));

    await waitFor(() => expect(window.location.pathname).toBe('/c/new-convo'));
    expect(mockContinueHubThread).toHaveBeenCalledWith('mindferry:session-1', undefined);
    expect(store.get(chatFilterStatusAtom)).toBe('active');
    expect(mockToggleNav).toHaveBeenCalledTimes(1);
  });

  describe('chats and notes tabs', () => {
    beforeEach(() => {
      mockUseListHubNotesQuery.mockReturnValue({
        data: { notes },
        isLoading: false,
        isError: false,
      });
    });

    it('opens on the chats, with notes a tab away, and counts both', () => {
      const { getByRole, queryByText } = render(<ArchivePanel />);

      expect(getByRole('tab', { name: 'Chats (1)' })).toHaveAttribute('aria-selected', 'true');
      expect(getByRole('tab', { name: 'Notes (2)' })).toHaveAttribute('aria-selected', 'false');
      expect(queryByText('A Claude Code session')).toBeInTheDocument();
      expect(queryByText('Plugin handoff')).not.toBeInTheDocument();

      openTab(getByRole, /^Notes/);

      expect(getByRole('tab', { name: 'Notes (2)' })).toHaveAttribute('aria-selected', 'true');
      expect(queryByText('Plugin handoff')).toBeInTheDocument();
      expect(queryByText('A Claude Code session')).not.toBeInTheDocument();
    });

    it('counts only the notes that match the search and source filter', () => {
      const searched = render(<ArchivePanel query="plugin" />);
      expect(searched.getByRole('tab', { name: 'Notes (1)' })).toBeInTheDocument();
      searched.unmount();

      const { getByRole } = render(<ArchivePanel />);
      fireEvent.click(
        within(getByRole('group', { name: 'Filter by source' })).getByRole('button', {
          name: 'Chat',
        }),
      );
      expect(getByRole('tab', { name: 'Notes (1)' })).toBeInTheDocument();
    });

    it('shows each note collapsed to its title, newest first, and opens one on demand', () => {
      const { getByRole, getAllByRole, queryByText, queryByRole } = render(<ArchivePanel />);
      openTab(getByRole, /^Notes/);

      const triggers = getAllByRole('button', { expanded: false });
      expect(triggers.map((trigger) => trigger.textContent)).toEqual([
        expect.stringContaining('Plugin handoff'),
        expect.stringContaining('Older handoff'),
      ]);
      expect(
        getByRole('button', { name: 'Plugin handoff', expanded: false }),
      ).toHaveAccessibleDescription(expect.stringContaining('Next step: update the plugin.'));
      expect(queryByText('claude-code-session_0157')).not.toBeInTheDocument();
      expect(queryByRole('button', { name: 'Continue in chat' })).not.toBeInTheDocument();

      fireEvent.click(triggers[0]);

      expect(triggers[0]).toHaveAttribute('aria-expanded', 'true');
      expect(queryByText('claude-code-session_0157')).toBeInTheDocument();
      expect(getByRole('button', { name: 'Continue in chat' })).toBeInTheDocument();

      fireEvent.click(triggers[0]);
      expect(triggers[0]).toHaveAttribute('aria-expanded', 'false');
      expect(queryByRole('button', { name: 'Continue in chat' })).not.toBeInTheDocument();
    });

    it('continues a note as a new chat and opens it', async () => {
      const { getByRole, getByText } = render(<ArchivePanel />);
      openTab(getByRole, /^Notes/);

      fireEvent.click(getByText('Plugin handoff'));
      fireEvent.click(getByRole('button', { name: 'Continue in chat' }));

      await waitFor(() => expect(window.location.pathname).toBe('/c/note-convo'));
      expect(mockContinueHubNote).toHaveBeenCalledWith('note-new', undefined);
      expect(store.get(chatFilterStatusAtom)).toBe('active');
      expect(mockContinueHubThread).not.toHaveBeenCalled();
    });

    it('stays put and does not navigate when a note cannot be opened as a chat', async () => {
      mockContinueHubNote.mockRejectedValue(new Error('import failed'));
      const { getByRole, getByText } = render(<ArchivePanel />);
      openTab(getByRole, /^Notes/);

      fireEvent.click(getByText('Plugin handoff'));
      fireEvent.click(getByRole('button', { name: 'Continue in chat' }));

      await waitFor(() => expect(mockContinueHubNote).toHaveBeenCalled());
      await waitFor(() =>
        expect(getByRole('button', { name: 'Continue in chat' })).not.toBeDisabled(),
      );
      expect(window.location.pathname).toBe('/c/new');
    });

    it('opens the conversation a note is anchored to, and goes back to the notes', () => {
      const { getByRole, getByText, queryByRole } = render(<ArchivePanel />);
      openTab(getByRole, /^Notes/);

      fireEvent.click(getByText('Older handoff'));
      expect(queryByRole('button', { name: 'Open conversation' })).not.toBeInTheDocument();
      fireEvent.click(getByText('Plugin handoff'));
      fireEvent.click(getByRole('button', { name: 'Open conversation' }));

      expect(mockUseGetHubThreadQuery).toHaveBeenLastCalledWith('mindferry:session-1');
      fireEvent.click(getByRole('button', { name: 'Back' }));
      expect(getByRole('tab', { name: 'Notes (2)' })).toHaveAttribute('aria-selected', 'true');
    });

    it('shows the loading, error and empty states of the notes', () => {
      mockUseListHubNotesQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      });
      const failed = render(<ArchivePanel />);
      openTab(failed.getByRole, /^Notes/);
      expect(failed.getByText("Couldn't load the notes")).toBeInTheDocument();
      failed.unmount();

      mockUseListHubNotesQuery.mockReturnValue({
        data: { notes: [] },
        isLoading: false,
        isError: false,
      });
      const empty = render(<ArchivePanel />);
      openTab(empty.getByRole, /^Notes/);
      expect(empty.getByText('No notes yet')).toBeInTheDocument();
      empty.unmount();

      mockUseListHubNotesQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });
      const loading = render(<ArchivePanel />);
      openTab(loading.getByRole, /^Notes/);
      expect(loading.queryByText('No notes yet')).not.toBeInTheDocument();
      expect(loading.queryByText("Couldn't load the notes")).not.toBeInTheDocument();
    });
  });
});
