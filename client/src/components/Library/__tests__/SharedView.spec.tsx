import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

const mockParams: { token?: string } = { token: 'T'.repeat(22) };
let mockShared: { data?: unknown; isLoading: boolean; isError: boolean } = {
  isLoading: false,
  isError: false,
};
let mockUnitData: unknown;
const mockPaint = jest.fn();
const mockUnitCalls: Array<number | undefined> = [];

jest.mock('react-router-dom', () => ({ useParams: () => mockParams }));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));
jest.mock('@librechat/client', () => ({ Spinner: () => <div data-testid="spinner" /> }));
jest.mock('librechat-data-provider', () => ({
  librarySharedResource: (token: string, path: string) => `/shared/${token}?path=${path}`,
}));
jest.mock('~/utils/libraryAnchors', () => ({
  paintHighlights: (...args: unknown[]) => mockPaint(...args),
  releaseHighlights: jest.fn(),
}));
jest.mock('~/data-provider', () => ({
  useLibrarySharedQuery: () => mockShared,
  useLibrarySharedUnitQuery: (_token: string, index?: number) => {
    mockUnitCalls.push(index);
    return { data: mockUnitData };
  },
}));

import SharedView from '../SharedView';

const article = {
  document: {
    id: 'd1',
    kind: 'article',
    title: 'Shared essay',
    byline: 'Ada',
    siteName: 'Example',
    readingMinutes: 4,
    sourceUrl: 'https://example.com/essay',
    contentHtml: '<p>Hello world</p>',
    text: 'Hello world',
  },
  highlights: [{ id: 'h1', anchor: { start: 0, end: 5 }, color: 'yellow', orphaned: false }],
  notice: 'Shared by a reader',
  reportEmail: 'abuse@example.com',
};

afterEach(() => {
  jest.clearAllMocks();
  mockUnitCalls.length = 0;
  mockUnitData = undefined;
  mockShared = { isLoading: false, isError: false };
  document.head.querySelectorAll('meta[name="robots"]').forEach((node) => node.remove());
});

describe('SharedView', () => {
  it('shows the article with its notice, source and report link, and paints the highlights', () => {
    mockShared = { data: article, isLoading: false, isError: false };
    render(<SharedView />);

    expect(screen.getByRole('heading', { name: 'Shared essay' })).toBeInTheDocument();
    expect(screen.getByTestId('shared-content')).toHaveTextContent('Hello world');
    expect(screen.getByTestId('shared-notice')).toHaveTextContent('Shared by a reader');
    expect(screen.getByRole('link', { name: 'com_library_share_original' })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow',
    );
    expect(screen.getByTestId('shared-report')).toHaveAttribute('href', 'mailto:abuse@example.com');
    expect(mockPaint).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ id: 'h1', tags: [] })]),
    );
  });

  it('asks search engines not to index the page', () => {
    mockShared = { data: article, isLoading: false, isError: false };
    render(<SharedView />);
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      expect.stringContaining('noindex'),
    );
  });

  it('says so when the link no longer works', () => {
    mockShared = { isLoading: false, isError: true };
    render(<SharedView />);
    expect(screen.getByTestId('shared-missing')).toHaveTextContent('com_library_share_missing');
  });

  it('reads a book a chapter at a time and gives its pictures their public address', () => {
    mockShared = {
      data: {
        document: { ...article.document, kind: 'epub', contentHtml: undefined, text: undefined },
        units: [
          { index: 0, kind: 'chapter', title: 'One', wordCount: 10, contentHash: 'a' },
          { index: 1, kind: 'chapter', title: 'Two', wordCount: 10, contentHash: 'b' },
        ],
        highlights: [],
      },
      isLoading: false,
      isError: false,
    };
    mockUnitData = {
      unit: {
        index: 0,
        kind: 'chapter',
        contentHtml: '<p>Chapter</p><img data-epub-resource="a.png">',
        text: 'Chapter',
      },
      highlights: [],
    };
    render(<SharedView />);

    expect(screen.getByTestId('shared-content').querySelector('img')).toHaveAttribute(
      'src',
      `/shared/${'T'.repeat(22)}?path=a.png`,
    );
    fireEvent.change(screen.getByTestId('shared-unit-select'), { target: { value: '1' } });
    expect(mockUnitCalls).toContain(1);
  });
});
