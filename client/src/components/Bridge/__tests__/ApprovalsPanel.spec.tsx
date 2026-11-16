import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type {
  TBridgeApprovalsOverview,
  TBridgeAuditLine,
  TBridgeProposal,
} from 'librechat-data-provider';
import { mockBridgeClient, mockLocalize } from 'test/bridgeMocks';

type Query = { data?: TBridgeApprovalsOverview; isError: boolean; error?: unknown };
let mockApprovals: Query;
let mockAudit: {
  data?: { lines: TBridgeAuditLine[] };
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
};
const mockRefetch = jest.fn();
const mockDecide = jest.fn();
let decideOptions: { onError?: (error: unknown) => void; onMutate?: () => void } = {};

jest.mock('~/hooks', () => ({ useLocalize: () => mockLocalize }));
jest.mock('~/data-provider', () => ({
  useBridgeApprovalsQuery: () => ({ ...mockApprovals, refetch: mockRefetch }),
  useBridgeAuditQuery: () => mockAudit,
  useDecideBridgeProposalMutation: (options: typeof decideOptions) => {
    decideOptions = options;
    return { mutate: mockDecide, isLoading: false };
  },
}));
jest.mock('@librechat/client', () => mockBridgeClient);

import ApprovalsPanel from '../ApprovalsPanel';

const proposal = (over: Partial<TBridgeProposal> = {}): TBridgeProposal => ({
  id: 'p1',
  source: 'result',
  roleId: 'role-1',
  roleSlug: 'seo-strategist-petvee',
  runtime: 'hermes',
  title: 'Draft the store listing',
  content: 'Draft the Google Play description.\n<b>not markup</b>',
  hash: 'abcdef0123456789'.repeat(4),
  status: 'pending',
  originTaskId: '2026-11-14-0921-hermes-x',
  expiresAt: '2026-11-17T10:00:00Z',
  createdAt: '2026-11-14T10:00:00Z',
  ...over,
});

const overview = (
  proposals: TBridgeProposal[],
  pending = proposals.length,
): TBridgeApprovalsOverview => ({
  proposals,
  pending,
  maxPending: 20,
  expiryHours: 72,
});

beforeEach(() => {
  mockApprovals = { data: overview([proposal()]), isError: false };
  mockAudit = { data: undefined, isLoading: false, isError: false };
  mockDecide.mockClear();
  mockRefetch.mockClear();
});

describe('ApprovalsPanel', () => {
  it('stays out of sight when approvals are off', () => {
    mockApprovals = {
      isError: true,
      error: { response: { data: { error: 'BRIDGE_DISABLED' } } },
    };
    const { container } = render(<ApprovalsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the exact text, the role, where it came from and how many are waiting', () => {
    render(<ApprovalsPanel />);
    expect(screen.getByTestId('bridge-approvals-count')).toHaveTextContent(
      'com_bridge_approvals_waiting:1,20',
    );
    expect(screen.getByText('com_bridge_approvals_for:seo-strategist-petvee')).toBeInTheDocument();
    expect(screen.getByTestId('bridge-proposal-source')).toHaveTextContent(
      'com_bridge_approvals_source_result',
    );
    expect(screen.getByTestId('bridge-proposal-content')).toHaveTextContent(
      'Draft the Google Play description.',
    );
    expect(screen.getByTestId('bridge-proposal-check')).toHaveTextContent('abcdef01');
  });

  it('draws the proposal text as text, never as markup', () => {
    render(<ApprovalsPanel />);
    const content = screen.getByTestId('bridge-proposal-content');
    expect(content.querySelector('b')).toBeNull();
    expect(content).toHaveTextContent('<b>not markup</b>');
  });

  it('approves with the hash that was shown, and denies without one', () => {
    const p = proposal();
    mockApprovals = { data: overview([p]), isError: false };
    render(<ApprovalsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /approve_for/ }));
    expect(mockDecide).toHaveBeenCalledWith({
      id: 'p1',
      body: { decision: 'approve', hash: p.hash },
    });
    fireEvent.click(screen.getByRole('button', { name: /deny_for/ }));
    expect(mockDecide).toHaveBeenLastCalledWith({ id: 'p1', body: { decision: 'deny' } });
  });

  it('opens the result that suggested a proposal', () => {
    const open = jest.fn();
    render(<ApprovalsPanel onOpenResult={open} />);
    fireEvent.click(screen.getByTestId('bridge-proposal-source-link'));
    expect(open).toHaveBeenCalledWith('2026-11-14-0921-hermes-x');
  });

  it('says nothing waits when the queue is empty', () => {
    mockApprovals = { data: overview([]), isError: false };
    render(<ApprovalsPanel />);
    expect(screen.getByTestId('bridge-approvals-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('bridge-proposal')).toBeNull();
  });

  it('offers another try for one that was approved but did not start, and no deny', () => {
    mockApprovals = { data: overview([proposal({ status: 'approved' })], 0), isError: false };
    render(<ApprovalsPanel />);
    expect(screen.getByTestId('bridge-proposal-waiting')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deny_for/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry_for/ }));
    expect(mockDecide).toHaveBeenCalledWith({
      id: 'p1',
      body: { decision: 'approve', hash: proposal().hash },
    });
  });

  it('lists decided ones apart from the waiting ones', () => {
    mockApprovals = {
      data: overview(
        [
          proposal({ id: 'a', status: 'approved', runId: 'run-1', title: 'Started one' }),
          proposal({ id: 'd', status: 'denied', title: 'Denied one' }),
          proposal({ id: 'e', status: 'expired', title: 'Expired one' }),
        ],
        0,
      ),
      isError: false,
    };
    render(<ApprovalsPanel />);
    expect(screen.queryByTestId('bridge-proposal')).toBeNull();
    const rows = screen.getAllByTestId('bridge-proposal-recent');
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual([
      'approved',
      'denied',
      'expired',
    ]);
    expect(within(rows[0]).getByText(/com_bridge_approvals_started/)).toBeInTheDocument();
  });

  it.each([
    ['APPROVAL_NOT_PENDING', 'com_bridge_approvals_error_not_pending'],
    ['APPROVAL_EXPIRED', 'com_bridge_approvals_error_expired'],
    ['APPROVAL_HASH_MISMATCH', 'com_bridge_approvals_error_hash'],
    ['APPROVAL_LIMIT', 'com_bridge_approvals_error_limit'],
    ['APPROVAL_ROLE_UNAVAILABLE', 'com_bridge_approvals_error_role'],
    ['SOMETHING_ELSE', 'com_bridge_approvals_error_decide'],
  ])('explains %s in words', (code, key) => {
    render(<ApprovalsPanel />);
    expect(screen.queryByTestId('bridge-proposal-error')).toBeNull();
    act(() => decideOptions.onError?.({ response: { data: { error: code } } }));
    expect(screen.getByTestId('bridge-proposal-error')).toHaveTextContent(key);
  });

  it('says why a hand-over was stopped, using the role’s own message', () => {
    render(<ApprovalsPanel />);
    act(() =>
      decideOptions.onError?.({
        response: { data: { error: 'APPROVAL_HANDOVER_FAILED', cause: 'CAP_ROLE' } },
      }),
    );
    expect(screen.getByTestId('bridge-proposal-error')).toHaveTextContent(
      'com_bridge_approvals_error_handover com_bridge_roles_error_cap_role',
    );
  });

  it('clears an old problem when a new decision starts', () => {
    render(<ApprovalsPanel />);
    act(() => decideOptions.onError?.({ response: { data: { error: 'APPROVAL_LIMIT' } } }));
    expect(screen.getByTestId('bridge-proposal-error')).toBeInTheDocument();
    act(() => decideOptions.onMutate?.());
    expect(screen.queryByTestId('bridge-proposal-error')).toBeNull();
  });

  it('says the approvals could not load, with a way to try again', () => {
    mockApprovals = {
      isError: true,
      error: { response: { data: { error: 'BRIDGE_UNAVAILABLE' } } },
    };
    render(<ApprovalsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('opens the ledger and shows its lines, newest first, with a note that nothing edits it', () => {
    mockAudit = {
      isLoading: false,
      isError: false,
      data: {
        lines: [
          {
            id: 'l2',
            action: 'proposal_approved',
            proposalId: 'p1',
            actor: 'user:1',
            roleSlug: 'seo-strategist-petvee',
            hash: 'abcdef0123456789'.repeat(4),
            createdAt: '2026-11-14T10:05:00Z',
          },
          {
            id: 'l1',
            action: 'proposal_created',
            actor: 'user:1',
            createdAt: '2026-11-14T10:00:00Z',
          },
        ],
      },
    };
    render(<ApprovalsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_bridge_approvals_ledger' }));
    const lines = screen.getAllByTestId('bridge-audit-line');
    expect(lines[0]).toHaveTextContent('com_bridge_audit_proposal_approved');
    expect(lines[0]).toHaveTextContent('abcdef01');
    expect(lines[1]).toHaveTextContent('com_bridge_audit_proposal_created');
    expect(screen.getByText('com_bridge_approvals_ledger_note')).toBeInTheDocument();
  });
});
