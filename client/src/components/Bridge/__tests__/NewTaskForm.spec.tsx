import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockBridgeClient, mockLocalize } from 'test/bridgeMocks';

type Options = { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void };
const mockMutate = jest.fn<void, [Record<string, unknown>, Options?]>();
const mockShowToast = jest.fn();
let mockLoading = false;

jest.mock('~/hooks', () => ({ useLocalize: () => mockLocalize }));
jest.mock('~/data-provider', () => ({
  useCreateBridgeTaskMutation: () => ({ mutate: mockMutate, isLoading: mockLoading }),
}));
jest.mock('@librechat/client', () => ({
  ...mockBridgeClient,
  useToastContext: () => ({ showToast: mockShowToast }),
}));

import NewTaskForm from '../NewTaskForm';

const renderForm = () => render(<NewTaskForm maxTaskChars={50} maxFieldChars={20} />);
const type = (id: string, value: string) =>
  fireEvent.change(screen.getByLabelText(new RegExp(id)), { target: { value } });
const typeTask = (value: string) =>
  fireEvent.change(screen.getByTestId('bridge-task-input'), { target: { value } });

beforeEach(() => {
  mockMutate.mockReset();
  mockShowToast.mockReset();
  mockLoading = false;
});

describe('NewTaskForm', () => {
  it('cannot be sent until there is a task, and not when it is over the limit', () => {
    renderForm();
    expect(screen.getByTestId('bridge-create-button')).toBeDisabled();
    expect(screen.getByTestId('bridge-preview-button')).toBeDisabled();

    typeTask('Read the README');
    expect(screen.getByTestId('bridge-create-button')).toBeEnabled();

    typeTask('x'.repeat(51));
    expect(screen.getByTestId('bridge-create-button')).toBeDisabled();
    expect(screen.getByText('com_bridge_task_hint:-1')).toBeInTheDocument();
  });

  it('counts the characters left', () => {
    renderForm();
    typeTask('12345');
    expect(screen.getByText('com_bridge_task_hint:45')).toBeInTheDocument();
  });

  it('asks for a preview, without creating anything, and shows the exact file', async () => {
    renderForm();
    typeTask('Read the README');
    fireEvent.click(screen.getByTestId('bridge-preview-button'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({
      to: 'hermes',
      task: 'Read the README',
      priority: 'normal',
      dryRun: true,
    });
    act(() => {
      mockMutate.mock.calls[0][1]?.onSuccess?.({
        content: '---\nto: hermes\n---\n',
        created: false,
      });
    });
    expect(await screen.findByTestId('bridge-preview')).toHaveTextContent('to: hermes');
  });

  it('sends the agent, priority and optional fields, then clears the form on success', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('bridge-to-openclaw'));
    fireEvent.click(screen.getByText('com_bridge_priority_high'));
    typeTask('Check the page');
    type('com_bridge_field_output', 'a summary');
    type('com_bridge_field_constraints', 'no links');
    fireEvent.submit(screen.getByTestId('bridge-form'));

    expect(mockMutate.mock.calls[0][0]).toEqual({
      to: 'openclaw',
      task: 'Check the page',
      priority: 'high',
      dryRun: false,
      output: 'a summary',
      constraints: 'no links',
    });
    act(() => {
      mockMutate.mock.calls[0][1]?.onSuccess?.({ created: true });
    });

    await waitFor(() => expect(screen.getByTestId('bridge-task-input')).toHaveValue(''));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_bridge_created' }),
    );
    expect(screen.queryByTestId('bridge-preview')).not.toBeInTheDocument();
  });

  it('leaves out fields that are blank', () => {
    renderForm();
    typeTask('Read the README');
    type('com_bridge_field_output', '   ');
    fireEvent.submit(screen.getByTestId('bridge-form'));
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('output');
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('constraints');
  });

  it.each([
    ['BRIDGE_SECRET_DETECTED', 'com_bridge_error_secret'],
    ['BRIDGE_RATE_LIMITED', 'com_bridge_error_rate'],
    ['BRIDGE_UNAVAILABLE', 'com_bridge_error_unavailable'],
    ['BRIDGE_INVALID', 'com_bridge_error_invalid'],
    ['SOMETHING_NEW', 'com_bridge_error_create'],
  ])('explains a %s failure and keeps what was typed', async (code, message) => {
    renderForm();
    typeTask('Read the README');
    fireEvent.submit(screen.getByTestId('bridge-form'));
    act(() => {
      mockMutate.mock.calls[0][1]?.onError?.({ response: { data: { error: code } } });
    });

    expect(await screen.findByTestId('bridge-form-error')).toHaveTextContent(message);
    expect(screen.getByTestId('bridge-task-input')).toHaveValue('Read the README');
  });

  it('falls back to a plain message when the failure has no code', async () => {
    renderForm();
    typeTask('Read the README');
    fireEvent.submit(screen.getByTestId('bridge-form'));
    act(() => {
      mockMutate.mock.calls[0][1]?.onError?.(new Error('network'));
    });
    expect(await screen.findByTestId('bridge-form-error')).toHaveTextContent(
      'com_bridge_error_create',
    );
  });

  it('says what is always forbidden and warns against secrets', () => {
    renderForm();
    expect(screen.getByText('com_bridge_forbidden_note')).toBeInTheDocument();
  });

  it('drops a preview as soon as the text changes, so it never shows an old file', async () => {
    renderForm();
    typeTask('Read the README');
    fireEvent.click(screen.getByTestId('bridge-preview-button'));
    act(() => {
      mockMutate.mock.calls[0][1]?.onSuccess?.({ content: 'OLD', created: false });
    });
    expect(await screen.findByTestId('bridge-preview')).toBeInTheDocument();
    typeTask('Read the README now');
    expect(screen.queryByTestId('bridge-preview')).not.toBeInTheDocument();
  });

  it('cannot be sent twice while a request is running', () => {
    mockLoading = true;
    renderForm();
    typeTask('Read the README');
    expect(screen.getByTestId('bridge-create-button')).toBeDisabled();
  });
});
