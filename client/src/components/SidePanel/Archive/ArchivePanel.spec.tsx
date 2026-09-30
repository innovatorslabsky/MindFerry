import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, waitFor } from 'test/layout-test-utils';
import ArchivePanel from './ArchivePanel';

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
});
