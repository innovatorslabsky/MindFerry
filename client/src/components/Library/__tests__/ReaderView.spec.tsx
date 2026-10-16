import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

let mockDocument: { data?: unknown; isLoading: boolean; isError: boolean };
let mockUnit: { data?: unknown; isLoading: boolean; isError: boolean };
let mockUnitArgs: unknown[] = [];
const bodyProps: Array<Record<string, unknown>> = [];

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/data-provider', () => ({
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
jest.mock('../HighlightsPanel', () => ({
  __esModule: true,
  default: ({ highlights }: { highlights: unknown[] }) => (
    <div data-testid="highlights-panel">{highlights.length}</div>
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
        readableText: `page ${index} reflowed`,
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

  it('shows a PDF page as reading text with highlighting off, and says why', () => {
    mockDocument = book('pdf');
    mockUnit = unitData(1, 'page');
    renderAt('/library/d1');
    expect(bodyProps.at(-1)).toMatchObject({
      plainText: 'page 1 reflowed',
      highlightingDisabledReason: 'com_library_pdf_no_highlight',
      unit: { kind: 'page', index: 1 },
    });
    expect(bodyProps.at(-1)?.html).toBeUndefined();
    expect(bodyProps.at(-1)?.highlights).toEqual([]);
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
