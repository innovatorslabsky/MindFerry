import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { TBridgeRolesOverview, TBridgeRun, TBridgeRole } from 'librechat-data-provider';
import { mockBridgeClient, mockLocalize } from 'test/bridgeMocks';

type RolesQuery = { data?: TBridgeRolesOverview; isError: boolean; error?: unknown };
let mockRoles: RolesQuery;
const mockRefetch = jest.fn();
const mockUpdate = jest.fn();
const mockAssign = jest.fn();
const mockCreate = jest.fn();
let assignOptions: { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void } = {};
let createOptions: { onSuccess?: () => void; onError?: (error: unknown) => void } = {};

jest.mock('~/hooks', () => ({ useLocalize: () => mockLocalize }));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useBridgeRolesQuery: () => ({ ...mockRoles, refetch: mockRefetch }),
  useUpdateBridgeRoleMutation: () => ({ mutate: mockUpdate, isLoading: false }),
  useAssignBridgeRoleMutation: (options: typeof assignOptions) => {
    assignOptions = options;
    return { mutate: mockAssign, isLoading: false };
  },
  useCreateBridgeRoleMutation: (options: typeof createOptions) => {
    createOptions = options;
    return { mutate: mockCreate, isLoading: false };
  },
  useListAgentsQuery: () => ({
    data: [
      { id: 'agent_one', name: 'Claude agent' },
      { id: 'agent_two', name: '' },
    ],
  }),
}));
jest.mock('@librechat/client', () => mockBridgeClient);

import RolesPanel from '../RolesPanel';

const role = (over: Partial<TBridgeRole> = {}): TBridgeRole => ({
  id: 'role-1',
  slug: 'researcher',
  name: 'Researcher',
  description: 'Finds things',
  runtime: 'app',
  agentId: 'agent_one',
  brief: 'Be brief',
  tier: 0,
  enabled: true,
  createdAt: '2026-11-11T08:00:00Z',
  updatedAt: '2026-11-11T08:00:00Z',
  ...over,
});

const run = (over: Partial<TBridgeRun> = {}): TBridgeRun => ({
  id: 'run-1',
  roleId: 'role-1',
  roleSlug: 'researcher',
  summary: 'Compare two vendors',
  status: 'running',
  counted: true,
  conversationId: 'convo-1',
  createdAt: '2026-11-11T09:00:00Z',
  ...over,
});

const overview = (over: Partial<TBridgeRolesOverview> = {}): TBridgeRolesOverview => ({
  roles: [role()],
  templates: [
    { id: 'writer', name: 'Writer', description: 'Drafts', brief: 'You are a writer.', tier: 0 },
  ],
  runs: [],
  usage: {
    day: '2026-11-11',
    team: { used: 2, cap: 25 },
    byRole: { 'role-1': { used: 2, cap: 6 } },
  },
  limits: { maxBriefChars: 4000, maxRoles: 12 },
  fileRolesEnabled: false,
  ...over,
});

const draw = () =>
  render(
    <MemoryRouter>
      <RolesPanel maxTaskChars={2000} />
    </MemoryRouter>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRoles = { data: overview(), isError: false };
});

describe('RolesPanel', () => {
  it('stays out of sight when roles are off', () => {
    mockRoles = { isError: true, error: { response: { data: { error: 'BRIDGE_DISABLED' } } } };
    const { container } = draw();
    expect(container).toBeEmptyDOMElement();
  });

  it('says a failed load and offers to try again', () => {
    mockRoles = { isError: true, error: { response: { data: { error: 'BRIDGE_UNAVAILABLE' } } } };
    draw();
    expect(screen.getByRole('alert')).toHaveTextContent('com_bridge_error_unavailable');
    fireEvent.click(screen.getByText('com_ui_retry'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows the roles, what each has used today and the team total', () => {
    draw();
    expect(screen.getByText('Researcher')).toBeInTheDocument();
    expect(screen.getByTestId('bridge-role-usage')).toHaveTextContent('com_bridge_roles_used:2,6');
    expect(screen.getByTestId('bridge-team-usage')).toHaveTextContent(
      'com_bridge_roles_team_used:2,25',
    );
    expect(screen.getByText('com_bridge_roles_tier0')).toBeInTheDocument();
  });

  it('says there are no roles yet, and stops adding at the limit', () => {
    mockRoles = {
      data: overview({ roles: [], limits: { maxBriefChars: 4000, maxRoles: 12 } }),
      isError: false,
    };
    const { unmount } = draw();
    expect(screen.getByTestId('bridge-roles-empty')).toBeInTheDocument();
    unmount();

    mockRoles = {
      data: overview({ limits: { maxBriefChars: 4000, maxRoles: 1 } }),
      isError: false,
    };
    draw();
    expect(screen.getByText('com_bridge_roles_add')).toBeDisabled();
  });

  it('switches a role off, and says so when it is off or not open yet', () => {
    mockRoles = {
      data: overview({
        roles: [role(), role({ id: 'role-2', name: 'Host', enabled: false, runtime: 'hermes' })],
      }),
      isError: false,
    };
    draw();
    fireEvent.click(screen.getAllByText('com_bridge_roles_turn_off')[0]);
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'role-1', patch: { enabled: false } });

    const second = screen.getAllByTestId('bridge-role')[1];
    expect(within(second).getByText('com_bridge_roles_off')).toBeInTheDocument();
    expect(within(second).getByText('com_bridge_roles_locked')).toBeInTheDocument();
    expect(within(second).getByText('com_bridge_roles_assign')).toBeDisabled();
  });

  describe('runs', () => {
    it('lists a run with its state and a link to its chat', () => {
      mockRoles = { data: overview({ runs: [run({ counted: false })] }), isError: false };
      draw();
      const row = screen.getByTestId('bridge-run');
      expect(within(row).getByTestId('bridge-run-status')).toHaveTextContent(
        'com_bridge_run_running',
      );
      expect(within(row).getByText('com_bridge_run_not_counted')).toBeInTheDocument();
      expect(within(row).getByText('com_bridge_run_open')).toHaveAttribute('href', '/c/convo-1');
    });

    it('says a paused run is waiting for approval in the chat', () => {
      mockRoles = { data: overview({ runs: [run({ status: 'paused' })] }), isError: false };
      draw();
      expect(screen.getByTestId('bridge-run-approval')).toHaveTextContent(
        'com_bridge_run_needs_approval',
      );
    });

    it('shows a failure by its code, never raw text', () => {
      mockRoles = {
        data: overview({ runs: [run({ status: 'failed', error: 'run_error' })] }),
        isError: false,
      };
      draw();
      expect(screen.getByText('com_bridge_run_error:run_error')).toBeInTheDocument();
    });
  });

  describe('giving a task', () => {
    const open = () => {
      draw();
      fireEvent.click(screen.getByText('com_bridge_roles_assign'));
    };
    const type = (text: string) =>
      fireEvent.change(screen.getByLabelText('com_bridge_roles_task'), { target: { value: text } });

    it('sends the task with a request id and the role', () => {
      open();
      expect(screen.getByText('com_bridge_roles_send')).toBeDisabled();
      type('Compare two vendors');
      fireEvent.click(screen.getByText('com_bridge_roles_send'));
      expect(mockAssign).toHaveBeenCalledTimes(1);
      const call = mockAssign.mock.calls[0][0];
      expect(call.id).toBe('role-1');
      expect(call.body.task).toBe('Compare two vendors');
      expect(call.body.requestId.length).toBeGreaterThanOrEqual(8);
    });

    it('blocks a task over the limit', () => {
      open();
      type('a'.repeat(2001));
      expect(screen.getByText('com_bridge_roles_send')).toBeDisabled();
    });

    it('says it started and links to the chat', () => {
      open();
      type('Do it');
      fireEvent.click(screen.getByText('com_bridge_roles_send'));
      act(() => assignOptions.onSuccess?.({ run: run(), replayed: false }));
      expect(screen.getByTestId('assign-started')).toHaveTextContent('com_bridge_roles_started');
      expect(within(screen.getByTestId('assign-started')).getByRole('link')).toHaveAttribute(
        'href',
        '/c/convo-1',
      );
    });

    it('says how far a cap has been used', () => {
      open();
      type('Do it');
      fireEvent.click(screen.getByText('com_bridge_roles_send'));
      act(() =>
        assignOptions.onError?.({
          response: { data: { error: 'CAP_ROLE', used: 6, cap: 6 } },
        }),
      );
      expect(screen.getByTestId('assign-error')).toHaveTextContent(
        'com_bridge_roles_error_cap_role:6,6',
      );
    });

    it('keeps the request id when no answer came, and renews it after any answer', () => {
      open();
      type('Do it');
      fireEvent.click(screen.getByText('com_bridge_roles_send'));
      const first = mockAssign.mock.calls[0][0].body.requestId;

      act(() => assignOptions.onError?.(new Error('Network Error')));
      fireEvent.click(screen.getByText('com_bridge_roles_send'));
      expect(mockAssign.mock.calls[1][0].body.requestId).toBe(first);

      act(() => assignOptions.onError?.({ response: { data: { error: 'ASSIGN_FAILED' } } }));
      fireEvent.click(screen.getByText('com_bridge_roles_send'));
      expect(mockAssign.mock.calls[2][0].body.requestId).not.toBe(first);
    });
  });

  describe('adding a role', () => {
    const open = () => {
      draw();
      fireEvent.click(screen.getByText('com_bridge_roles_add'));
    };

    it('fills the name and brief from a starting point, then creates the role', () => {
      open();
      fireEvent.change(screen.getByLabelText('com_bridge_roles_template'), {
        target: { value: 'writer' },
      });
      expect(screen.getByLabelText('com_bridge_roles_name')).toHaveValue('Writer');
      expect(screen.getByLabelText('com_bridge_roles_brief')).toHaveValue('You are a writer.');
      expect(screen.getByText('com_bridge_roles_create')).toBeDisabled();

      fireEvent.change(screen.getByLabelText('com_bridge_roles_agent'), {
        target: { value: 'agent_two' },
      });
      fireEvent.click(screen.getByText('com_bridge_roles_create'));
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Writer',
        agentId: 'agent_two',
        brief: 'You are a writer.',
        runtime: 'app',
        templateId: 'writer',
      });
    });

    it('lists only the agents the person can use, falling back to the id for a nameless one', () => {
      open();
      const select = screen.getByLabelText('com_bridge_roles_agent');
      expect(within(select).getByText('Claude agent')).toBeInTheDocument();
      expect(within(select).getByText('agent_two')).toBeInTheDocument();
    });

    it('says why a role was refused', () => {
      open();
      act(() => createOptions.onError?.({ response: { data: { error: 'ROLE_SLUG_TAKEN' } } }));
      expect(screen.getByTestId('add-role-error')).toHaveTextContent(
        'com_bridge_roles_error_name_taken',
      );
    });
  });
});
