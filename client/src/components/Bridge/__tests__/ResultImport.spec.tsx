import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TBridgeImportResponse } from 'librechat-data-provider';
import { mockBridgeClient, mockLocalize } from 'test/bridgeMocks';

type Result = { status: string; text: string; truncated: boolean };
let mockResult: { data?: Result; isLoading: boolean; isError: boolean; error?: unknown };
let mockApprovalsOn: boolean;
let mockImport: {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  data?: TBridgeImportResponse;
};
const mockMutate = jest.fn();

jest.mock('~/hooks', () => ({ useLocalize: () => mockLocalize }));
jest.mock('~/data-provider', () => ({
  useBridgeResultQuery: () => mockResult,
  useBridgeApprovalsQuery: () =>
    mockApprovalsOn
      ? { data: { proposals: [], pending: 0, maxPending: 20, expiryHours: 72 }, isError: false }
      : {
          data: undefined,
          isError: true,
          error: { response: { data: { error: 'BRIDGE_DISABLED' } } },
        },
  useImportBridgeFollowUpsMutation: () => ({ ...mockImport, mutate: mockMutate }),
}));
jest.mock('@librechat/client', () => mockBridgeClient);

import ResultDialog from '../ResultDialog';

const WITH =
  'status: DONE\n\n1. Summary\nok\n\n## Proposed follow-ups\n- role: r1 | task: Do it.\n';

beforeEach(() => {
  mockApprovalsOn = true;
  mockResult = {
    data: { status: 'DONE', text: WITH, truncated: false },
    isLoading: false,
    isError: false,
  };
  mockImport = { isLoading: false, isError: false };
  mockMutate.mockClear();
});

const open = () => render(<ResultDialog id="task-1" onClose={jest.fn()} />);

describe('importing follow-ups from the result dialog', () => {
  it('offers the control for a finished result that suggests follow-ups, with the promise that nothing starts', () => {
    open();
    expect(screen.getByTestId('bridge-import')).toBeInTheDocument();
    expect(screen.getByText('com_bridge_import_hint')).toBeInTheDocument();
  });

  it.each([
    [
      'approvals are off',
      () => {
        mockApprovalsOn = false;
      },
    ],
    [
      'the result failed',
      () => {
        mockResult.data = { status: 'FAILED', text: WITH, truncated: false };
      },
    ],
    [
      'there is no such section',
      () => {
        mockResult.data = { status: 'DONE', text: 'status: DONE\n\nnothing', truncated: false };
      },
    ],
    [
      'the heading is only mentioned in a sentence',
      () => {
        mockResult.data = {
          status: 'DONE',
          text: 'status: DONE\n\nsee Proposed follow-ups below',
          truncated: false,
        };
      },
    ],
  ])('does not offer it when %s', (_name, change) => {
    change();
    open();
    expect(screen.queryByTestId('bridge-import')).toBeNull();
  });

  it('asks for the import of this result when pressed', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'com_bridge_import_button' }));
    expect(mockMutate).toHaveBeenCalledWith('task-1');
  });

  it('cannot be pressed twice while it works', () => {
    mockImport = { isLoading: true, isError: false };
    open();
    expect(screen.getByRole('button', { name: 'com_bridge_import_button' })).toBeDisabled();
  });

  it('says how many were added, what was left out and why, and what was ignored', () => {
    mockImport = {
      isLoading: false,
      isError: false,
      data: {
        proposals: [],
        added: 2,
        skipped: [
          { index: 2, role: 'nobody', reason: 'role_unknown' },
          { index: 3, role: 'r1', reason: 'secret' },
        ],
        ignored: 3,
      },
    };
    open();
    const outcome = screen.getByTestId('bridge-import-outcome');
    expect(outcome).toHaveTextContent('com_bridge_import_added:2');
    expect(outcome).toHaveTextContent('nobody: com_bridge_import_reason_role_unknown');
    expect(outcome).toHaveTextContent('r1: com_bridge_import_reason_secret');
    expect(outcome).toHaveTextContent('com_bridge_import_ignored:3');
  });

  it('says nothing new was added on a repeat', () => {
    mockImport = {
      isLoading: false,
      isError: false,
      data: { proposals: [], added: 0, skipped: [], ignored: 0 },
    };
    open();
    expect(screen.getByTestId('bridge-import-outcome')).toHaveTextContent('com_bridge_import_none');
  });

  it('says it failed, with the server’s reason when there is one', () => {
    mockImport = {
      isLoading: false,
      isError: true,
      error: { response: { data: { error: 'APPROVAL_NOT_FOUND' } } },
    };
    open();
    expect(screen.getByTestId('bridge-import-error')).toHaveTextContent(
      'com_bridge_approvals_error_not_found',
    );
  });
});
