import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

let mockSource: { data?: Blob; isLoading: boolean; isError: boolean };
const mockRender = jest.fn();
const mockCancel = jest.fn();
const mockDestroy = jest.fn();
const mockOpen = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/data-provider', () => ({ useLibrarySourceQuery: () => mockSource }));
jest.mock('~/utils/pdfPages', () => ({ openPdfPages: (...args: unknown[]) => mockOpen(...args) }));
jest.mock('@librechat/client', () => mockClient);

import PdfPageView from '../PdfPageView';

const blob = () => {
  const file = new Blob(['%PDF-1.7']);
  // jsdom's Blob has no arrayBuffer.
  Object.assign(file, { arrayBuffer: async () => new ArrayBuffer(8) });
  return file;
};

beforeEach(() => {
  mockSource = { data: blob(), isLoading: false, isError: false };
  mockRender.mockReturnValue({ promise: Promise.resolve(), cancel: mockCancel });
  mockOpen.mockResolvedValue({ numPages: 3, render: mockRender, destroy: mockDestroy });
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 600 });
});
afterEach(() => jest.clearAllMocks());

describe('PdfPageView', () => {
  it('opens the stored file and draws the chosen page (1-based) at the available width', async () => {
    render(<PdfPageView documentId="d1" pageIndex={1} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalled());
    expect(mockRender).toHaveBeenCalledWith(2, expect.any(HTMLCanvasElement), 600);
    expect(screen.getByLabelText('com_library_page_label:2')).toBeInTheDocument();
  });

  it('draws another page without reopening the file, cancelling the earlier draw', async () => {
    const { rerender } = render(<PdfPageView documentId="d1" pageIndex={0} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(1));
    rerender(<PdfPageView documentId="d1" pageIndex={2} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(2));
    expect(mockRender).toHaveBeenLastCalledWith(3, expect.any(HTMLCanvasElement), 600);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('releases the document when it goes away', async () => {
    const { unmount } = render(<PdfPageView documentId="d1" pageIndex={0} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalled());
    unmount();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('says so, and draws nothing, when the file cannot be fetched or opened', async () => {
    mockSource = { isLoading: false, isError: true };
    const { unmount } = render(<PdfPageView documentId="d1" pageIndex={0} />);
    expect(screen.getByText('com_library_page_error')).toBeInTheDocument();
    expect(mockRender).not.toHaveBeenCalled();
    unmount();

    mockSource = { data: blob(), isLoading: false, isError: false };
    mockOpen.mockRejectedValueOnce(new Error('bad pdf'));
    render(<PdfPageView documentId="d1" pageIndex={0} />);
    expect(await screen.findByText('com_library_page_error')).toBeInTheDocument();
  });

  it('shows a spinner while the file is loading', async () => {
    mockSource = { isLoading: true, isError: false };
    await act(async () => {
      render(<PdfPageView documentId="d1" pageIndex={0} />);
    });
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });
});
