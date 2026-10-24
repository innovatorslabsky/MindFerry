import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockExport = jest.fn();
const mockToast = jest.fn();
const mockSave = jest.fn();
let exportOptions: {
  onSuccess?: (data: { blob: Blob; filename: string }) => void;
  onError?: () => void;
} = {};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/utils/saveBlob', () => ({ saveBlob: (...args: unknown[]) => mockSave(...args) }));
jest.mock('~/data-provider', () => ({
  useExportLibraryHighlightsMutation: (options: typeof exportOptions) => {
    exportOptions = options;
    return { mutate: mockExport, isLoading: false };
  },
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button role="menuitem" disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}));

import ReaderMenu from '../ReaderMenu';

const renderMenu = (overrides: Partial<React.ComponentProps<typeof ReaderMenu>> = {}) => {
  const onMove = jest.fn();
  const onShowShortcuts = jest.fn();
  render(
    <ReaderMenu
      documentId="d1"
      location="inbox"
      originalUrl="https://example.test/post"
      onMove={onMove}
      onShowShortcuts={onShowShortcuts}
      {...overrides}
    />,
  );
  return { onMove, onShowShortcuts };
};

afterEach(() => jest.clearAllMocks());

describe('ReaderMenu', () => {
  it('offers the other places to move the document to, each with its key', () => {
    const { onMove } = renderMenu({ location: 'inbox' });

    expect(screen.queryByRole('menuitem', { name: /com_library_shortcut_inbox/ })).toBeNull();
    const later = screen.getByRole('menuitem', { name: /com_library_shortcut_later/ });
    expect(later).toHaveTextContent('l');
    expect(
      screen.getByRole('menuitem', { name: /com_library_shortcut_archive/ }),
    ).toHaveTextContent('e');
    fireEvent.click(later);
    expect(onMove).toHaveBeenCalledWith('later');
  });

  it('offers the inbox for a document that is not in it', () => {
    const { onMove } = renderMenu({ location: 'archive' });
    fireEvent.click(screen.getByRole('menuitem', { name: /com_library_shortcut_inbox/ }));
    expect(onMove).toHaveBeenCalledWith('inbox');
  });

  it('copies the original link, and says when it could not', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /com_library_copy_original_link/ }));
    });
    expect(writeText).toHaveBeenCalledWith('https://example.test/post');
    expect(mockToast).toHaveBeenLastCalledWith({
      message: 'com_ui_copied_to_clipboard',
      status: 'success',
    });

    writeText.mockRejectedValueOnce(new Error('denied'));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /com_library_copy_original_link/ }));
    });
    expect(mockToast).toHaveBeenLastCalledWith({ message: 'com_ui_copy_failed', status: 'error' });
  });

  it('has no link to copy for a file that came from nowhere', () => {
    renderMenu({ originalUrl: undefined });
    expect(screen.queryByRole('menuitem', { name: /com_library_copy_original_link/ })).toBeNull();
  });

  it('downloads this document’s highlights in either format', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /com_library_export_csv/ }));
    expect(mockExport).toHaveBeenCalledWith({ format: 'csv', documentId: 'd1' });
    fireEvent.click(screen.getByRole('menuitem', { name: /com_library_export_markdown/ }));
    expect(mockExport).toHaveBeenLastCalledWith({ format: 'markdown', documentId: 'd1' });

    const blob = new Blob(['x']);
    act(() => exportOptions.onSuccess?.({ blob, filename: 'h.csv' }));
    expect(mockSave).toHaveBeenCalledWith(blob, 'h.csv');
    act(() => exportOptions.onError?.());
    expect(mockToast).toHaveBeenLastCalledWith({
      message: 'com_library_export_error',
      status: 'error',
    });
  });

  it('opens the shortcuts', () => {
    const { onShowShortcuts } = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /com_library_shortcuts/ }));
    expect(onShowShortcuts).toHaveBeenCalled();
  });
});
