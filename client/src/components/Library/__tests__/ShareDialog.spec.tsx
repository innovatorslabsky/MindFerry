import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

let mockShareData: { enabled: boolean; notice?: string; share: unknown };
const mockSave = jest.fn();
const mockWithdraw = jest.fn();

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/utils/share', () => ({
  buildLibraryShareUrl: (token: string) => `https://app.test/share/library/${token}`,
}));
jest.mock('~/data-provider', () => ({
  useLibraryShareQuery: () => ({ data: mockShareData }),
  useSetLibraryShareMutation: () => ({ mutate: mockSave, isLoading: false }),
  useDeleteLibraryShareMutation: () => ({ mutate: mockWithdraw, isLoading: false }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  OGDialogTemplate: ({ title, main }: { title: string; main: React.ReactNode }) => (
    <div>
      <h2>{title}</h2>
      {main}
    </div>
  ),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

import ShareDialog from '../ShareDialog';

const renderDialog = () =>
  render(<ShareDialog documentId="d1" open={true} onOpenChange={jest.fn()} />);

afterEach(() => jest.clearAllMocks());

describe('ShareDialog', () => {
  it('makes a link for a document that has none, without highlights by default', () => {
    mockShareData = { enabled: true, share: null };
    renderDialog();

    fireEvent.click(screen.getByTestId('library-share-create'));
    expect(mockSave).toHaveBeenCalledWith({ id: 'd1', includeHighlights: false });
  });

  it('shows the operator’s notice', () => {
    mockShareData = { enabled: true, notice: 'Be kind', share: null };
    renderDialog();
    expect(screen.getByText('Be kind')).toBeInTheDocument();
  });

  it('shows the address, changes what is shared, and stops sharing', () => {
    mockShareData = {
      enabled: true,
      share: { token: 'A'.repeat(22), includeHighlights: false, createdAt: '2026-01-01' },
    };
    renderDialog();

    expect(screen.getByTestId('library-share-url')).toHaveValue(
      `https://app.test/share/library/${'A'.repeat(22)}`,
    );
    fireEvent.click(screen.getByTestId('library-share-highlights'));
    expect(mockSave).toHaveBeenCalledWith({ id: 'd1', includeHighlights: true });

    fireEvent.click(screen.getByTestId('library-share-stop'));
    expect(mockWithdraw).toHaveBeenCalledWith('d1');
  });
});
