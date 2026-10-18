import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockCreate = jest.fn();
const mockRemove = jest.fn();
const mockToast = jest.fn();
let mockViews: unknown[] = [];
let mockCreateOptions: { onSuccess?: () => void; onError?: (e: unknown) => void } | undefined;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useLibraryViewsQuery: () => ({ data: { views: mockViews } }),
  useCreateLibraryViewMutation: (options: typeof mockCreateOptions) => {
    mockCreateOptions = options;
    return { mutate: mockCreate, isLoading: false };
  },
  useDeleteLibraryViewMutation: () => ({ mutate: mockRemove, isLoading: false }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import PinnedViews, { matchesView } from '../PinnedViews';

const view = (id: string, name: string, filter: Record<string, string> = {}) => ({
  id,
  name,
  filter,
  createdAt: '',
});

const current = { location: 'inbox', sort: 'updated' } as const;

beforeEach(() => {
  mockViews = [];
});
afterEach(() => jest.clearAllMocks());

describe('matchesView', () => {
  it('treats a missing location as the inbox and a missing sort as the default', () => {
    expect(matchesView(current, view('1', 'A'))).toBe(true);
    expect(matchesView({ ...current, kind: 'pdf' }, view('1', 'A'))).toBe(false);
    expect(
      matchesView(
        { location: 'later', kind: 'pdf', tag: 'x', sort: 'title' },
        view('1', 'A', { location: 'later', kind: 'pdf', tag: 'x', sort: 'title' }),
      ),
    ).toBe(true);
  });
});

describe('PinnedViews', () => {
  it('renders nothing when there is nothing pinned and nothing to pin', () => {
    const { container } = render(
      <PinnedViews current={current} canPin={false} onOpen={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('opens a pinned view with its filters, and marks the one that is showing', () => {
    mockViews = [
      view('1', 'Short reads', { location: 'later', sort: 'shortest' }),
      view('2', 'Inbox as is'),
    ];
    const onOpen = jest.fn();
    render(<PinnedViews current={current} canPin onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Short reads' }));
    expect(onOpen).toHaveBeenCalledWith({ location: 'later', sort: 'shortest' });
    expect(screen.getByRole('button', { name: 'Inbox as is' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Short reads' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('pins the current filters under a name', () => {
    render(
      <PinnedViews
        current={{ location: 'later', kind: 'pdf', sort: 'title' }}
        canPin
        onOpen={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_library_view_pin' }));
    fireEvent.change(screen.getByLabelText('com_library_view_name'), {
      target: { value: '  Papers ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_library_view_save' }));
    expect(mockCreate).toHaveBeenCalledWith({
      name: 'Papers',
      filter: { location: 'later', kind: 'pdf', sort: 'title' },
    });
    mockCreateOptions?.onSuccess?.();
  });

  it('does not offer to pin what is already pinned, or while searching', () => {
    mockViews = [view('1', 'Inbox as is')];
    const { rerender } = render(<PinnedViews current={current} canPin onOpen={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'com_library_view_pin' })).toBeNull();
    mockViews = [];
    rerender(<PinnedViews current={current} canPin={false} onOpen={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'com_library_view_pin' })).toBeNull();
  });

  it('unpins a view', () => {
    mockViews = [view('1', 'Short reads', { kind: 'pdf' })];
    render(<PinnedViews current={current} canPin onOpen={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_view_unpin:Short reads' }));
    expect(mockRemove).toHaveBeenCalledWith({ id: '1' });
  });

  it('tells the person when a view could not be saved', () => {
    render(<PinnedViews current={current} canPin onOpen={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_view_pin' }));
    mockCreateOptions?.onError?.({ response: { data: { error: { code: 'view_exists' } } } });
    expect(mockToast).toHaveBeenCalledWith({
      message: 'com_library_error_view_exists',
      status: 'error',
    });
  });
});
