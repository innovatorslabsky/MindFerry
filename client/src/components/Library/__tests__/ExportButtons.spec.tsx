import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockExport = jest.fn();
const mockToast = jest.fn();
const mockSave = jest.fn();
let mockExportOptions: {
  onSuccess?: (d: { blob: Blob; filename: string }) => void;
  onError?: () => void;
} = {};
let mockLoading = false;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useExportLibraryHighlightsMutation: (options: typeof mockExportOptions) => {
    mockExportOptions = options;
    return { mutate: mockExport, isLoading: mockLoading };
  },
}));
jest.mock('~/utils/saveBlob', () => ({ saveBlob: (...args: unknown[]) => mockSave(...args) }));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import ExportButtons from '../ExportButtons';

beforeEach(() => {
  mockLoading = false;
});
afterEach(() => jest.clearAllMocks());

describe('ExportButtons', () => {
  it('asks for everything when no document is given', () => {
    render(<ExportButtons />);
    fireEvent.click(screen.getByRole('button', { name: /com_library_export_markdown/ }));
    expect(mockExport).toHaveBeenCalledWith({ format: 'markdown', documentId: undefined });
    fireEvent.click(screen.getByRole('button', { name: /com_library_export_csv/ }));
    expect(mockExport).toHaveBeenLastCalledWith({ format: 'csv', documentId: undefined });
  });

  it('asks for one document when given', () => {
    render(<ExportButtons documentId="d1" />);
    fireEvent.click(screen.getByRole('button', { name: /com_library_export_csv/ }));
    expect(mockExport).toHaveBeenCalledWith({ format: 'csv', documentId: 'd1' });
  });

  it('downloads the file under the name the server gave, and says so when it fails', () => {
    render(<ExportButtons />);
    const blob = new Blob(['x']);
    act(() => mockExportOptions.onSuccess?.({ blob, filename: 'mindferry-highlights.md' }));
    expect(mockSave).toHaveBeenCalledWith(blob, 'mindferry-highlights.md');
    act(() => mockExportOptions.onError?.());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_library_export_error', status: 'error' }),
    );
  });

  it('is disabled while an export is on its way', () => {
    mockLoading = true;
    render(<ExportButtons />);
    expect(screen.getByRole('button', { name: /com_library_export_csv/ })).toBeDisabled();
  });
});
