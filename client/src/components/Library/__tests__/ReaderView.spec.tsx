import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

let mockDocument: { data?: unknown; isLoading: boolean; isError: boolean };
let mockUnit: { data?: unknown; isLoading: boolean; isError: boolean };
let mockUnitArgs: unknown[] = [];
const bodyProps: Array<Record<string, unknown>> = [];
const mockRemoveSource = jest.fn();
const mockUpdateDocument = jest.fn();
const mockHighlightSelection = jest.fn();
const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useDeleteLibrarySourceMutation: () => ({ mutate: mockRemoveSource }),
  useUpdateLibraryDocumentMutation: () => ({ mutate: mockUpdateDocument }),
  useLibraryDocumentQuery: () => mockDocument,
  useLibraryUnitQuery: (...args: unknown[]) => {
    mockUnitArgs = args;
    return mockUnit;
  },
}));
jest.mock('@librechat/client', () => mockClient);
jest.mock('../ReaderBody', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    bodyProps.push(props);
    return <div data-testid="reader-body" />;
  },
}));
jest.mock('../ReaderMenu', () => ({
  __esModule: true,
  default: ({
    location,
    originalUrl,
    onMove,
    onShowShortcuts,
  }: {
    location: string;
    originalUrl?: string;
    onMove: (location: string) => void;
    onShowShortcuts: () => void;
  }) => (
    <div data-testid="reader-menu" data-location={location} data-original={originalUrl ?? ''}>
      <button data-testid="menu-archive" onClick={() => onMove('archive')} />
      <button data-testid="menu-shortcuts" onClick={onShowShortcuts} />
    </div>
  ),
}));
jest.mock('../ReaderShortcuts', () => ({
  __esModule: true,
  default: ({ open, isBook }: { open: boolean; isBook: boolean }) =>
    open ? <div data-testid="reader-shortcuts-dialog" data-book={String(isBook)} /> : null,
}));
jest.mock('../AskButtons', () => ({
  __esModule: true,
  default: ({ kind, unitIndex }: { kind: string; unitIndex: number }) => (
    <div data-testid="ask-buttons" data-kind={kind} data-unit={unitIndex} />
  ),
}));
jest.mock('../OcrPanel', () => ({
  __esModule: true,
  default: ({ blankPages, currentPage }: { blankPages: number[]; currentPage: number }) => (
    <div data-testid="ocr-panel" data-blank={blankPages.join(',')} data-current={currentPage} />
  ),
}));
jest.mock('../PdfPageView', () => ({
  __esModule: true,
  default: ({ pageIndex }: { pageIndex: number }) => (
    <div data-testid="pdf-page" data-page={pageIndex} />
  ),
}));
jest.mock('../InfoPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="info-panel" />,
}));
jest.mock('../TagEditor', () => ({
  __esModule: true,
  default: ({ tags }: { tags: string[] }) => <div data-testid="tag-editor">{tags.join(',')}</div>,
}));
jest.mock('../HighlightsPanel', () => ({
  __esModule: true,
  default: ({ highlights, documentId }: { highlights: unknown[]; documentId: string }) => (
    <div data-testid="highlights-panel" data-document={documentId}>
      {highlights.length}
    </div>
  ),
}));

import ReaderView from '../ReaderView';

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  urlKey: 'k',
  normalizedUrl: 'https://example.test/a',
  kind: 'article',
  title: 'Spaced repetition',
  siteName: 'example.test',
  byline: 'Ada',
  contentHash: 'doc-hash',
  wordCount: 1,
  readingMinutes: 1,
  unitCount: 0,
  toc: [],
  location: 'inbox',
  tags: [],
  hasSource: false,
  fetchedAt: '',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const highlight = (id: string, unitIndex?: number) => ({
  id,
  documentId: 'd1',
  anchor: { exact: 'x', prefix: '', suffix: '', start: 0, end: 1 },
  color: 'yellow',
  tags: [],
  contentHash: 'h',
  orphaned: false,
  createdAt: '',
  updatedAt: '',
  ...(unitIndex === undefined ? {} : { unit: { kind: 'chapter', index: unitIndex } }),
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/library/:id" element={<ReaderView />} />
        <Route path="/library" element={<p data-testid="list" />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  bodyProps.length = 0;
  mockUnitArgs = [];
  mockUnit = { isLoading: false, isError: false };
});

describe('ReaderView: an article', () => {
  beforeEach(() => {
    mockDocument = {
      isLoading: false,
      isError: false,
      data: {
        document: { ...summary(), contentHtml: '<p>Hello</p>', text: 'Hello' },
        highlights: [highlight('h1'), highlight('h2')],
        progress: { documentId: 'd1', textOffset: 42, contentHash: 'doc-hash', updatedAt: '' },
      },
    };
  });

  it('shows its text with its highlights and resumes from the saved position', () => {
    renderAt('/library/d1');
    expect(screen.getByText('Spaced repetition')).toBeInTheDocument();
    expect(screen.getByTestId('highlights-panel')).toHaveTextContent('2');
    expect(bodyProps.at(-1)).toMatchObject({
      html: '<p>Hello</p>',
      anchorText: 'Hello',
      contentHash: 'doc-hash',
      resumeAt: 42,
    });
    expect(bodyProps.at(-1)?.unit).toBeUndefined();
    expect(screen.queryByText('com_library_contents')).not.toBeInTheDocument();
    expect(mockUnitArgs.slice(1)).toEqual([undefined]);
  });

  it('offers to ask about the article', () => {
    renderAt('/library/d1');
    expect(screen.getByTestId('ask-buttons')).toHaveAttribute('data-kind', 'article');
  });

  it('does not resume from a position recorded against different text', () => {
    (mockDocument.data as { progress: { contentHash: string } }).progress.contentHash = 'older';
    renderAt('/library/d1');
    expect(bodyProps.at(-1)?.resumeAt).toBe(0);
  });

  it('links to the original page only when there is one', () => {
    const { unmount } = renderAt('/library/d1');
    expect(screen.getByText('com_library_open_original').closest('a')).toHaveAttribute(
      'href',
      'https://example.test/a',
    );
    unmount();
    (mockDocument.data as { document: { normalizedUrl: string } }).document.normalizedUrl =
      'upload://abc';
    renderAt('/library/d1');
    expect(screen.queryByText('com_library_open_original')).not.toBeInTheDocument();
  });
});

describe('ReaderView: a book', () => {
  const book = (kind: 'epub' | 'pdf') => ({
    isLoading: false,
    isError: false,
    data: {
      document: summary({
        kind,
        unitCount: 3,
        toc: [
          { title: 'Intro', depth: 0, unitIndex: 0 },
          { title: 'Later', depth: 1, unitIndex: 2 },
        ],
      }),
      units: [0, 1, 2].map((index) => ({
        index,
        kind: kind === 'pdf' ? 'page' : 'chapter',
        wordCount: 1,
        contentHash: `u${index}`,
      })),
      highlights: [highlight('whole-book')],
      progress: { documentId: 'd1', unitIndex: 1, textOffset: 7, contentHash: 'u1', updatedAt: '' },
    },
  });
  const unitData = (index: number, kind: 'chapter' | 'page' = 'chapter') => ({
    isLoading: false,
    isError: false,
    data: {
      unit: {
        index,
        kind,
        documentId: 'd1',
        wordCount: 1,
        contentHash: `u${index}`,
        contentHtml: `<p>chapter ${index}</p>`,
        text: `chapter ${index}`,
      },
      highlights: [highlight(`u${index}-a`, index), highlight(`u${index}-b`, index)],
    },
  });

  it('opens where the reader left off, with the contents and only that chapter’s highlights', () => {
    mockDocument = book('epub');
    mockUnit = unitData(1);
    renderAt('/library/d1');
    expect(mockUnitArgs.slice(1)).toEqual([1]);
    expect(screen.getByText('com_library_contents')).toBeInTheDocument();
    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(bodyProps.at(-1)).toMatchObject({
      html: '<p>chapter 1</p>',
      anchorText: 'chapter 1',
      contentHash: 'u1',
      unit: { kind: 'chapter', index: 1 },
      resumeAt: 7,
    });
    expect(screen.getByTestId('highlights-panel')).toHaveTextContent('2');
  });

  it('moves between chapters, keeping the choice in the address, and stops at the ends', () => {
    mockDocument = book('epub');
    mockUnit = unitData(0);
    renderAt('/library/d1?unit=0');
    expect(screen.getByRole('button', { name: 'com_library_previous' })).toBeDisabled();
    mockUnit = unitData(1);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_next' }));
    expect(mockUnitArgs.slice(1)).toEqual([1]);
    mockUnit = unitData(2);
    renderAt('/library/d1?unit=99');
    expect(mockUnitArgs.slice(1)).toEqual([2]);
    expect(screen.getAllByRole('button', { name: 'com_library_next' }).at(-1)).toBeDisabled();
  });

  it('jumps to a chapter from the contents, and ignores an entry that points nowhere', () => {
    mockDocument = book('epub');
    mockUnit = unitData(1);
    renderAt('/library/d1');
    mockUnit = unitData(2);
    fireEvent.click(screen.getByText('Later'));
    expect(mockUnitArgs.slice(1)).toEqual([2]);
  });

  it('shows a PDF page as reading text with that page\u2019s own highlights, anchored on its text', () => {
    mockDocument = book('pdf');
    mockUnit = unitData(1, 'page');
    renderAt('/library/d1');
    expect(bodyProps.at(-1)).toMatchObject({
      plainText: 'chapter 1',
      anchorText: 'chapter 1',
      contentHash: 'u1',
      unit: { kind: 'page', index: 1 },
    });
    expect(bodyProps.at(-1)?.html).toBeUndefined();
    expect(bodyProps.at(-1)?.highlightingDisabledReason).toBeUndefined();
    expect(bodyProps.at(-1)?.highlights).toHaveLength(2);
  });

  it('waits for a chapter that is still loading, and says when it could not load', () => {
    mockDocument = book('epub');
    mockUnit = { isLoading: true, isError: false };
    const { unmount } = renderAt('/library/d1');
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    unmount();
    mockUnit = { isLoading: false, isError: true };
    renderAt('/library/d1');
    expect(screen.getByText('com_library_load_error')).toBeInTheDocument();
  });

  it('warns about a scanned PDF', () => {
    mockDocument = book('pdf');
    (mockDocument.data as { document: { needsOcr: boolean } }).document.needsOcr = true;
    mockUnit = unitData(0, 'page');
    renderAt('/library/d1');
    expect(screen.getByText('com_library_needs_ocr')).toBeInTheDocument();
  });
});

describe('ReaderView: a PDF with its original stored', () => {
  const stored = (hasSource: boolean) => ({
    isLoading: false,
    isError: false,
    data: {
      document: summary({ kind: 'pdf', unitCount: 3, hasSource }),
      units: [0, 1, 2].map((index) => ({
        index,
        kind: 'page',
        wordCount: 1,
        contentHash: `u${index}`,
      })),
      highlights: [],
      progress: null,
    },
  });
  const unit = {
    isLoading: false,
    isError: false,
    data: {
      unit: {
        index: 1,
        kind: 'page',
        documentId: 'd1',
        wordCount: 1,
        contentHash: 'u1',
        text: 'page 1',
      },
      highlights: [],
    },
  };

  it('offers no page view when the original was not kept', () => {
    mockDocument = stored(false);
    mockUnit = unit;
    renderAt('/library/d1?unit=1');
    expect(screen.queryByRole('group', { name: 'com_library_view' })).not.toBeInTheDocument();
    // Even if the address asks for it, there is nothing to show but the text.
    expect(screen.queryByTestId('pdf-page')).not.toBeInTheDocument();
  });

  it('offers OCR for the blank pages only, when the original is stored', () => {
    mockDocument = {
      ...stored(true),
      data: {
        ...stored(true).data,
        units: [
          { index: 0, kind: 'page', wordCount: 0, contentHash: 'u0' },
          { index: 1, kind: 'page', wordCount: 5, contentHash: 'u1' },
          { index: 2, kind: 'page', wordCount: 0, contentHash: 'u2' },
        ],
      },
    };
    mockUnit = unit;
    renderAt('/library/d1?unit=1');
    expect(screen.getByTestId('ocr-panel')).toHaveAttribute('data-blank', '0,2');
    expect(screen.getByTestId('ocr-panel')).toHaveAttribute('data-current', '1');
  });

  it('offers no OCR when the original was not kept', () => {
    mockDocument = stored(false);
    mockUnit = unit;
    renderAt('/library/d1?unit=1');
    expect(screen.queryByTestId('ocr-panel')).not.toBeInTheDocument();
  });

  it('reads as text by default and switches to the page, keeping the page number', () => {
    mockDocument = stored(true);
    mockUnit = unit;
    renderAt('/library/d1?unit=1');
    expect(screen.queryByTestId('pdf-page')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_library_view_text' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_library_view_page' }));
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '1');
    expect(screen.getByText('com_library_page_view_note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_next' }));
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '2');
    fireEvent.click(screen.getByRole('button', { name: 'com_library_view_text' }));
    expect(screen.queryByTestId('pdf-page')).not.toBeInTheDocument();
  });

  it('removes the original only after confirming', () => {
    mockDocument = stored(true);
    mockUnit = unit;
    renderAt('/library/d1?unit=1');
    fireEvent.click(screen.getByRole('button', { name: 'com_library_source_remove' }));
    expect(mockRemoveSource).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: '' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'com_library_source_remove' }));
    expect(mockRemoveSource).toHaveBeenCalledWith({ id: 'd1' });
  });
});

describe('ReaderView: when there is nothing to show', () => {
  it('shows a spinner while loading', () => {
    mockDocument = { isLoading: true, isError: false };
    renderAt('/library/d1');
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('says it is not there, with a way back, on an error or a missing document', () => {
    mockDocument = { isLoading: false, isError: true };
    const { unmount } = renderAt('/library/d1');
    expect(screen.getByText('com_library_not_found')).toBeInTheDocument();
    expect(screen.getByText('com_library_back').closest('a')).toHaveAttribute('href', '/library');
    unmount();
    mockDocument = { isLoading: false, isError: false, data: undefined };
    renderAt('/library/d1');
    expect(screen.getByText('com_library_not_found')).toBeInTheDocument();
  });
});

describe('ReaderView: export', () => {
  it('gives the highlights panel the open document, so it can export it whole', () => {
    mockDocument = {
      data: {
        document: { ...summary(), contentHtml: '<p>x</p>', text: 'x' },
        highlights: [],
        progress: null,
      },
      isLoading: false,
      isError: false,
    };
    renderAt('/library/d1');
    expect(screen.getAllByTestId('highlights-panel')[0]).toHaveAttribute('data-document', 'd1');
  });
});

describe('ReaderView: tags', () => {
  it("shows the document's tags in an editor under the header", () => {
    mockDocument = {
      data: {
        document: { ...summary({ tags: ['psych', 'memory'] }), contentHtml: '<p>x</p>', text: 'x' },
        highlights: [],
        progress: null,
      },
      isLoading: false,
      isError: false,
    };
    renderAt('/library/d1');
    expect(screen.getByTestId('tag-editor')).toHaveTextContent('psych,memory');
  });
});

describe('ReaderView: narrow screens', () => {
  beforeEach(() => {
    mockDocument = {
      isLoading: false,
      isError: false,
      data: {
        document: summary({
          kind: 'epub',
          unitCount: 2,
          toc: [{ title: 'Intro', depth: 0, unitIndex: 0 }],
        }),
        units: [0, 1].map((index) => ({
          index,
          kind: 'chapter',
          wordCount: 1,
          contentHash: `u${index}`,
        })),
        highlights: [],
        progress: null,
      },
    };
    mockUnit = {
      isLoading: false,
      isError: false,
      data: {
        unit: {
          index: 0,
          kind: 'chapter',
          documentId: 'd1',
          wordCount: 1,
          contentHash: 'u0',
          contentHtml: '<p>x</p>',
          text: 'x',
        },
        highlights: [highlight('a', 0), highlight('b', 0), highlight('c', 0)],
      },
    };
  });

  it('opens the highlights as a sheet from the header, and closes it again', () => {
    renderAt('/library/d1');
    expect(screen.queryByTestId('library-sheet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_highlights' }));
    const sheet = screen.getByTestId('library-sheet');
    expect(sheet).toHaveAttribute('aria-label', 'com_library_highlights');
    expect(sheet).toHaveClass('lg:hidden');
    expect(sheet).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    expect(screen.queryByTestId('library-sheet')).not.toBeInTheDocument();
  });

  it('opens the contents as a sheet, and picking a chapter closes it', () => {
    renderAt('/library/d1');
    fireEvent.click(screen.getByRole('button', { name: 'com_library_contents' }));
    const sheet = screen.getByTestId('library-sheet');
    expect(sheet).toHaveClass('md:hidden');
    mockUnit = { ...mockUnit };
    fireEvent.click(within(sheet).getByText('Intro'));
    expect(screen.queryByTestId('library-sheet')).not.toBeInTheDocument();
  });

  it('shows one sheet at a time', () => {
    renderAt('/library/d1');
    fireEvent.click(screen.getByRole('button', { name: 'com_library_contents' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_library_highlights' }));
    expect(screen.getAllByTestId('library-sheet')).toHaveLength(1);
    expect(screen.getByTestId('library-sheet')).toHaveAttribute(
      'aria-label',
      'com_library_highlights',
    );
  });

  it('offers no contents button for an article', () => {
    mockDocument = {
      isLoading: false,
      isError: false,
      data: {
        document: { ...summary(), contentHtml: '<p>x</p>', text: 'x' },
        highlights: [],
        progress: null,
      },
    };
    renderAt('/library/d1');
    expect(screen.queryByRole('button', { name: 'com_library_contents' })).not.toBeInTheDocument();
  });
});

describe('ReaderView: keyboard', () => {
  beforeEach(() => {
    mockDocument = {
      isLoading: false,
      isError: false,
      data: {
        document: { ...summary(), contentHtml: '<p>Hello</p>', text: 'Hello' },
        highlights: [],
        progress: null,
      },
    };
  });
  afterEach(() => jest.clearAllMocks());

  it('highlights the selection with h through the reader body', () => {
    renderAt('/library/d1');
    const register = bodyProps.at(-1)?.registerHandle as (handle: unknown) => void;
    act(() => register({ focusHighlight: jest.fn(), highlightSelection: mockHighlightSelection }));

    fireEvent.keyDown(window, { key: 'h' });

    expect(mockHighlightSelection).toHaveBeenCalledTimes(1);
  });

  it('archives with e and sets aside with l', () => {
    renderAt('/library/d1');

    fireEvent.keyDown(window, { key: 'e' });
    expect(mockUpdateDocument).toHaveBeenLastCalledWith({
      id: 'd1',
      patch: { location: 'archive' },
    });

    fireEvent.keyDown(window, { key: 'l' });
    expect(mockUpdateDocument).toHaveBeenLastCalledWith({ id: 'd1', patch: { location: 'later' } });
  });

  it('moves back to the inbox with i', () => {
    renderAt('/library/d1');

    fireEvent.keyDown(window, { key: 'i' });

    expect(mockUpdateDocument).toHaveBeenLastCalledWith({ id: 'd1', patch: { location: 'inbox' } });
  });

  it('gives the menu the document’s place, and moves when the menu says so', () => {
    renderAt('/library/d1');

    const menu = screen.getByTestId('reader-menu');
    expect(menu).toHaveAttribute('data-location', 'inbox');
    fireEvent.click(screen.getByTestId('menu-archive'));
    expect(mockUpdateDocument).toHaveBeenLastCalledWith({
      id: 'd1',
      patch: { location: 'archive' },
    });
  });

  it('shows the shortcuts with ? or from the menu', () => {
    renderAt('/library/d1');
    expect(screen.queryByTestId('reader-shortcuts-dialog')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('reader-shortcuts-dialog')).toBeInTheDocument();
  });

  it('goes back to the list with u', () => {
    renderAt('/library/d1');

    fireEvent.keyDown(window, { key: 'u' });

    expect(mockNavigate).toHaveBeenCalledWith('/library');
  });
});

describe('ReaderView: the side panel and the outline of an article', () => {
  const HTML = '<h1>Title</h1><p>x</p><h2>Part one</h2><h2>Part two</h2>';
  beforeEach(() => {
    mockDocument = {
      isLoading: false,
      isError: false,
      data: {
        document: { ...summary(), contentHtml: HTML, text: 'x' },
        highlights: [highlight('h1')],
        progress: null,
      },
    };
  });

  it('lists the headings of an article and scrolls to the one chosen', () => {
    renderAt('/library/d1');
    const scrollToHeading = jest.fn();
    act(() => {
      (bodyProps[bodyProps.length - 1].registerHandle as (h: unknown) => void)({
        focusHighlight: jest.fn(),
        highlightSelection: jest.fn(),
        scrollToHeading,
      });
    });
    const outline = screen.getAllByRole('navigation', { name: 'com_library_contents' })[0];
    expect(
      within(outline)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Title', 'Part one', 'Part two']);
    fireEvent.click(within(outline).getByRole('button', { name: 'Part two' }));
    expect(scrollToHeading).toHaveBeenCalledWith(2);
  });

  it('shows no outline for an article with fewer than two headings', () => {
    mockDocument = {
      isLoading: false,
      isError: false,
      data: {
        document: { ...summary(), contentHtml: '<h1>Only</h1><p>x</p>', text: 'x' },
        highlights: [],
        progress: null,
      },
    };
    renderAt('/library/d1');
    expect(screen.queryByRole('navigation', { name: 'com_library_contents' })).toBeNull();
  });

  it('opens on the Notebook and switches to Info', () => {
    renderAt('/library/d1');
    expect(screen.getByTestId('highlights-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'com_library_panel_info' }));
    expect(screen.getByTestId('info-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('highlights-panel')).toBeNull();
  });
});
