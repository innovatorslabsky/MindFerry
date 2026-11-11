import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TBridgeOverview } from 'librechat-data-provider';
import { mockBridgeClient, mockLocalize } from 'test/bridgeMocks';

type Query = {
  data?: TBridgeOverview;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isFetching?: boolean;
  refetch: () => void;
};
let mockOverview: Query;
let mockResult: { data?: unknown; isLoading: boolean; isError: boolean; error?: unknown };
const mockRefetch = jest.fn();

jest.mock('~/hooks', () => ({ useLocalize: () => mockLocalize }));
jest.mock('~/data-provider', () => ({
  useBridgeOverviewQuery: () => mockOverview,
  useBridgeResultQuery: () => mockResult,
  /** Roles are off in these tests: the panel answers as the server does and stays hidden. */
  useBridgeRolesQuery: () => ({
    data: undefined,
    isError: true,
    error: { response: { data: { error: 'BRIDGE_DISABLED' } } },
    refetch: jest.fn(),
  }),
  useCreateBridgeTaskMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));
jest.mock('@librechat/client', () => mockBridgeClient);

import BridgeView from '../BridgeView';

const overview = (over: Partial<TBridgeOverview> = {}): TBridgeOverview => ({
  status: {
    generatedAt: '2026-11-09T13:20:00Z',
    stale: false,
    agents: [
      { agent: 'hermes', health: 'up', job: { state: 'ok' } },
      { agent: 'openclaw', health: 'up', job: { state: 'ok' } },
    ],
  },
  tasks: [
    {
      id: '2026-11-07-0143-hermes-readme-summary',
      to: 'hermes',
      state: 'done',
      summary: 'Read the README',
      hasResult: true,
      resultStatus: 'DONE',
    },
  ],
  truncated: false,
  dashboards: [{ name: 'Hermes', url: 'http://localhost:9119' }],
  tunnelCommand: 'ssh -L 9119:localhost:9119 deploy@host',
  limits: { maxTaskChars: 2000, maxFieldChars: 500 },
  ...over,
});

beforeEach(() => {
  mockRefetch.mockReset();
  mockOverview = { data: overview(), isLoading: false, isError: false, refetch: mockRefetch };
  mockResult = { isLoading: false, isError: false };
});

describe('BridgeView', () => {
  it('shows a spinner while it loads, and nothing else yet', () => {
    mockOverview = { isLoading: true, isError: false, refetch: mockRefetch };
    render(<BridgeView />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('bridge-form')).not.toBeInTheDocument();
  });

  it('shows the agents, the form, the tasks and the dashboards', () => {
    render(<BridgeView />);
    expect(screen.getByTestId('bridge-agent-hermes')).toBeInTheDocument();
    expect(screen.getByTestId('bridge-form')).toBeInTheDocument();
    expect(screen.getByTestId('bridge-task-list')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Hermes/ })).toHaveAttribute(
      'href',
      'http://localhost:9119',
    );
    expect(screen.getByTestId('bridge-tunnel')).toHaveTextContent('deploy@host');
  });

  it('says the page could not be loaded, with the reason when the server gave one, and can retry', () => {
    mockOverview = {
      isLoading: false,
      isError: true,
      error: { response: { data: { error: 'BRIDGE_UNAVAILABLE' } } },
      refetch: mockRefetch,
    };
    render(<BridgeView />);
    expect(screen.getByTestId('bridge-error')).toHaveTextContent('com_bridge_error_unavailable');
    expect(screen.queryByTestId('bridge-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('com_ui_retry'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('falls back to a general message for an error with no code', () => {
    mockOverview = { isLoading: false, isError: true, error: new Error('x'), refetch: mockRefetch };
    render(<BridgeView />);
    expect(screen.getByTestId('bridge-error')).toHaveTextContent('com_bridge_error_load');
  });

  it('opens a result in a dialog and closes it again', () => {
    mockResult = {
      isLoading: false,
      isError: false,
      data: { id: 'x', status: 'DONE', text: 'status: DONE\n\nall good', truncated: false },
    };
    render(<BridgeView />);
    expect(screen.queryByTestId('bridge-result-text')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bridge-open-2026-11-07-0143-hermes-readme-summary'));
    expect(screen.getByTestId('bridge-result-text')).toHaveTextContent('all good');
    expect(screen.getByTestId('bridge-result-status')).toHaveTextContent('com_bridge_result_done');
    expect(screen.getByText('com_bridge_result_untrusted')).toBeInTheDocument();
  });

  it('says a long result was cut, and a failed load of one', () => {
    mockResult = {
      isLoading: false,
      isError: false,
      data: { id: 'x', status: 'UNKNOWN', text: 'start', truncated: true },
    };
    const { unmount } = render(<BridgeView />);
    fireEvent.click(screen.getByTestId('bridge-open-2026-11-07-0143-hermes-readme-summary'));
    expect(screen.getByText('com_bridge_result_cut')).toBeInTheDocument();
    unmount();

    mockResult = {
      isLoading: false,
      isError: true,
      error: { response: { data: { error: 'BRIDGE_NOT_FOUND' } } },
    };
    render(<BridgeView />);
    fireEvent.click(screen.getByTestId('bridge-open-2026-11-07-0143-hermes-readme-summary'));
    expect(screen.getByTestId('bridge-result-error')).toHaveTextContent(
      'com_bridge_error_not_found',
    );
  });
});
