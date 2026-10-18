import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockRotate = jest.fn();
const mockOff = jest.fn();
const mockToast = jest.fn();
let mockInbox: { data?: { inbox: { createdAt: string } | null }; isLoading: boolean };
let rotateOptions: { onSuccess?: (data: unknown) => void; onError?: () => void } = {};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useLibraryInboxQuery: () => mockInbox,
  useRotateLibraryInboxMutation: (options: typeof rotateOptions) => {
    rotateOptions = options;
    return { mutate: mockRotate, isLoading: false };
  },
  useDeleteLibraryInboxMutation: () => ({ mutate: mockOff, isLoading: false }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import InboxPanel from '../InboxPanel';

beforeEach(() => {
  mockInbox = { data: { inbox: null }, isLoading: false };
});
afterEach(() => jest.clearAllMocks());

describe('InboxPanel', () => {
  it('offers to make an address when there is none', () => {
    render(<InboxPanel />);

    expect(screen.getByText('com_library_inbox_create')).toBeInTheDocument();
    expect(screen.queryByText('com_library_inbox_off')).not.toBeInTheDocument();
  });

  it('shows the full address once it is made, and never keeps it after', () => {
    const { rerender } = render(<InboxPanel />);
    fireEvent.click(screen.getByText('com_library_inbox_create'));
    expect(mockRotate).toHaveBeenCalledTimes(1);

    mockInbox = { data: { inbox: { createdAt: '2026-03-01T00:00:00Z' } }, isLoading: false };
    act(() => rotateOptions.onSuccess?.({ token: 'secret-token-value' }));
    rerender(<InboxPanel />);

    const field = screen.getByLabelText('com_library_inbox_url') as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/api/library/inbox/secret-token-value`);
    expect(screen.getByRole('note')).toHaveTextContent('com_library_inbox_shown_once');
  });

  it('says only when it was made when the secret is no longer on hand', () => {
    mockInbox = { data: { inbox: { createdAt: '2026-03-01T00:00:00Z' } }, isLoading: false };
    render(<InboxPanel />);

    expect(screen.queryByLabelText('com_library_inbox_url')).not.toBeInTheDocument();
    expect(screen.getByText(/com_library_inbox_made/)).toBeInTheDocument();
    expect(screen.getByText('com_library_inbox_rotate')).toBeInTheDocument();
  });

  it('turns the address off', () => {
    mockInbox = { data: { inbox: { createdAt: '2026-03-01T00:00:00Z' } }, isLoading: false };
    render(<InboxPanel />);

    fireEvent.click(screen.getByText('com_library_inbox_off'));

    expect(mockOff).toHaveBeenCalledTimes(1);
  });

  it('copies the address and says so', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<InboxPanel />);
    act(() => rotateOptions.onSuccess?.({ token: 'abc' }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText('com_library_inbox_copy'));
    });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/library/inbox/abc`);
    expect(mockToast).toHaveBeenCalledWith({
      message: 'com_library_inbox_copied',
      status: 'success',
    });
  });

  it('reports a failure, and shows nothing while loading', () => {
    const { container, rerender } = render(<InboxPanel />);
    rotateOptions.onError?.();
    expect(mockToast).toHaveBeenCalledWith({
      message: 'com_library_inbox_error',
      status: 'error',
    });

    mockInbox = { isLoading: true };
    rerender(<InboxPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
