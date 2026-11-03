import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockAdd = jest.fn();
const mockRemove = jest.fn();
let mockData: unknown;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useLibrarySessionsQuery: () => ({ data: mockData }),
  useAddLibrarySessionMutation: () => ({ mutate: mockAdd, isLoading: false }),
  useDeleteLibrarySessionMutation: () => ({ mutate: mockRemove, isLoading: false }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  useToastContext: () => ({ showToast: jest.fn() }),
}));

import ReadingSessions from '../ReadingSessions';

const session = (id: string, kind: 'auto' | 'manual', seconds: number) => ({
  id,
  documentId: 'd1',
  kind,
  startedAt: '2026-03-10T10:00:00.000Z',
  endedAt: '2026-03-10T10:30:00.000Z',
  activeSeconds: seconds,
  words: 100,
});

afterEach(() => jest.clearAllMocks());

describe('ReadingSessions', () => {
  it('says how long it has been read, and invites the first reading when it has not', () => {
    mockData = { sessions: [], totals: { seconds: 0, words: 0, sessions: 0 } };
    const { rerender } = render(<ReadingSessions documentId="d1" />);
    expect(screen.getByTestId('library-sessions-total')).toHaveTextContent(
      'com_library_sessions_none',
    );

    mockData = {
      sessions: [session('a'.repeat(22), 'auto', 1800)],
      totals: { seconds: 3900, words: 900, sessions: 3 },
    };
    rerender(<ReadingSessions documentId="d1" />);
    expect(screen.getByTestId('library-sessions-total')).toHaveTextContent(
      'com_library_duration_hm:1,05',
    );
    expect(screen.getByTestId('library-sessions-total')).toHaveTextContent(
      'com_library_session_count:3',
    );
  });

  it('lets only a hand-logged entry be removed', () => {
    mockData = {
      sessions: [
        session('auto'.padEnd(22, 'x'), 'auto', 600),
        session('hand'.padEnd(22, 'x'), 'manual', 1200),
      ],
      totals: { seconds: 1800, words: 200, sessions: 2 },
    };
    render(<ReadingSessions documentId="d1" />);
    expect(screen.getAllByTestId('library-session')).toHaveLength(2);
    const buttons = screen.getAllByRole('button', { name: 'com_library_session_delete' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(mockRemove).toHaveBeenCalledWith({ id: 'd1', sid: 'hand'.padEnd(22, 'x') });
  });

  it('logs whole minutes read elsewhere, and not nothing, too much or a fraction', () => {
    mockData = { sessions: [], totals: { seconds: 0, words: 0, sessions: 0 } };
    render(<ReadingSessions documentId="d1" />);
    const input = screen.getByLabelText('com_library_session_minutes');
    const submit = screen.getByRole('button', { name: 'com_library_session_log' });

    for (const bad of ['', '0', '1441', '2.5', '-3']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(submit).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: '45' } });
    expect(submit).toBeEnabled();
    fireEvent.submit(screen.getByTestId('library-session-form'));
    expect(mockAdd).toHaveBeenCalledWith({ id: 'd1', session: { minutes: 45 } });
  });
});
