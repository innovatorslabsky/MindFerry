import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

let mockSource: { data?: Blob; isLoading: boolean; isError: boolean };
const mockRender = jest.fn();
const mockCancel = jest.fn();
const mockDestroy = jest.fn();
const mockOpen = jest.fn();
const mockRenderLayer = jest.fn();
const mockCreate = jest.fn();
const mockToast = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useLibrarySourceQuery: () => mockSource,
  useCreateLibraryHighlightMutation: () => ({ mutate: mockCreate }),
}));
jest.mock('~/utils/pdfPages', () => ({ openPdfPages: (...args: unknown[]) => mockOpen(...args) }));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import PdfPageView from '../PdfPageView';

/** What the text layer holds, and the stored text of the page it was laid over. */
const LAYER_TEXT = 'Memory decays on a curve. The curve is steep at first.';
const ANCHOR_TEXT = 'Memory decays on a curve. The curve is steep at first.';
const HASH = 'a'.repeat(64);

const blob = () => {
  const file = new Blob(['%PDF-1.7']);
  // jsdom's Blob has no arrayBuffer.
  Object.assign(file, { arrayBuffer: async () => new ArrayBuffer(8) });
  return file;
};

beforeEach(() => {
  mockSource = { data: blob(), isLoading: false, isError: false };
  mockRender.mockReturnValue({ promise: Promise.resolve(), cancel: mockCancel });
  mockRenderLayer.mockImplementation((_page: number, container: HTMLElement) => {
    container.textContent = LAYER_TEXT;
    return { promise: Promise.resolve(), cancel: mockCancel };
  });
  mockOpen.mockResolvedValue({
    numPages: 3,
    render: mockRender,
    renderTextLayer: mockRenderLayer,
    destroy: mockDestroy,
  });
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
    // The earlier page's drawing and its text layer are both cancelled.
    expect(mockCancel).toHaveBeenCalledTimes(2);
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

function selectInLayer(container: HTMLElement, text: string) {
  const node = container.firstChild as Text;
  const from = LAYER_TEXT.indexOf(text);
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, from + text.length);
  const selection = window.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(container);
}

describe('PdfPageView: highlighting on the page image', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () =>
      ({
        top: 120,
        left: 80,
        width: 40,
        height: 16,
        right: 120,
        bottom: 136,
        x: 80,
        y: 120,
      }) as DOMRect;
  });
  afterEach(() => window.getSelection()?.removeAllRanges());

  const renderPage = (extra: Partial<React.ComponentProps<typeof PdfPageView>> = {}) =>
    render(
      <PdfPageView
        documentId="d1"
        pageIndex={1}
        anchorText={ANCHOR_TEXT}
        contentHash={HASH}
        highlights={[]}
        {...extra}
      />,
    );

  it('lays the page words over the image, at the same width', async () => {
    renderPage();

    await waitFor(() => expect(mockRenderLayer).toHaveBeenCalled());
    expect(mockRenderLayer).toHaveBeenCalledWith(2, expect.any(HTMLElement), 600);
    expect(screen.getByTestId('library-page-text')).toHaveTextContent('Memory decays');
  });

  it('offers colours for a selection and highlights the same words in the stored text', async () => {
    renderPage();
    const layer = screen.getByTestId('library-page-text');
    await waitFor(() => expect(layer).toHaveTextContent('Memory'));

    selectInLayer(layer, 'curve is steep');
    fireEvent.click(screen.getByLabelText('com_library_highlight_with:com_library_color_green'));

    const start = ANCHOR_TEXT.indexOf('curve is steep');
    expect(mockCreate).toHaveBeenCalledWith({
      documentId: 'd1',
      anchor: expect.objectContaining({ exact: 'curve is steep', start, end: start + 14 }),
      contentHash: HASH,
      color: 'green',
      unit: { kind: 'page', index: 1 },
    });
    expect(screen.queryByTestId('library-highlight-toolbar')).not.toBeInTheDocument();
  });

  it('says so when a selection cannot be matched to the stored text', async () => {
    renderPage({ anchorText: 'Something else entirely.' });
    const layer = screen.getByTestId('library-page-text');
    await waitFor(() => expect(layer).toHaveTextContent('Memory'));

    selectInLayer(layer, 'curve is steep');

    expect(screen.queryByTestId('library-highlight-toolbar')).not.toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith({
      message: 'com_library_page_select_error',
      status: 'error',
    });
  });

  it('offers nothing until the page text is known', async () => {
    renderPage({ anchorText: undefined, contentHash: undefined });
    const layer = screen.getByTestId('library-page-text');
    await waitFor(() => expect(layer).toHaveTextContent('Memory'));

    selectInLayer(layer, 'curve is steep');

    expect(screen.queryByTestId('library-highlight-toolbar')).not.toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('lets the parent highlight the selection from the keyboard', async () => {
    let handle: { highlightSelection: (color?: string) => boolean } | null = null;
    renderPage({
      registerHandle: (next) => {
        handle = next as typeof handle;
      },
    });
    const layer = screen.getByTestId('library-page-text');
    await waitFor(() => expect(layer).toHaveTextContent('Memory'));
    expect(handle!.highlightSelection()).toBe(false);

    selectInLayer(layer, 'Memory decays');
    let made = false;
    act(() => {
      made = handle!.highlightSelection();
    });

    expect(made).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'yellow',
        anchor: expect.objectContaining({ exact: 'Memory decays' }),
      }),
    );
  });

  it('draws existing highlights over the words, whatever the line breaks', async () => {
    const start = ANCHOR_TEXT.indexOf('decays on');
    const highlight = {
      id: 'h1',
      documentId: 'd1',
      anchor: { exact: 'decays on', prefix: '', suffix: '', start, end: start + 9 },
      color: 'blue',
      tags: [],
      contentHash: HASH,
      orphaned: false,
      createdAt: '',
      updatedAt: '',
    };
    renderPage({ highlights: [highlight as never] });
    const layer = screen.getByTestId('library-page-text');
    await waitFor(() => expect(layer.querySelector('mark[data-color="blue"]')).not.toBeNull());

    expect(layer.querySelector('mark')?.textContent).toBe('decays on');
    expect(layer.textContent).toBe(LAYER_TEXT);
  });
});
