import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, waitFor, within } from 'test/layout-test-utils';
import ArchivePanel from './ArchivePanel';

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

describe('ArchivePanel', () => {
  beforeEach(() => {
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

  it('lists the archived conversations straight away, with no dialog to open first', () => {
    const { getByText } = render(<ArchivePanel />);

    expect(getByText('A Claude Code session')).toBeInTheDocument();
    expect(getByText(/^Claude Code · mindferry/)).toBeInTheDocument();
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

  it('opens a conversation and continues it as a chat, leaving the panel in place', async () => {
    const { getByText, getByRole } = render(<ArchivePanel />);

    fireEvent.click(getByText('A Claude Code session'));
    fireEvent.click(getByRole('button', { name: 'Continue in chat' }));

    await waitFor(() => expect(window.location.pathname).toBe('/c/new-convo'));
    expect(mockContinueHubThread).toHaveBeenCalledWith('mindferry:session-1', undefined);
    expect(getByRole('button', { name: 'Back' })).toBeInTheDocument();
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
      const { getByRole, getByLabelText } = render(<ArchivePanel />);

      fireEvent.change(getByLabelText('Search'), { target: { value: 'plugin' } });
      expect(getByRole('tab', { name: 'Notes (1)' })).toBeInTheDocument();

      fireEvent.change(getByLabelText('Search'), { target: { value: '' } });
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
