import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockCreate = jest.fn();
const mockProgress = jest.fn();
const mockToast = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useCreateLibraryHighlightMutation: () => ({ mutate: mockCreate }),
  useSetLibraryProgressMutation: () => ({ mutate: mockProgress }),
}));
const mockGetResource = jest.fn();
jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: { getLibraryResource: (...args: unknown[]) => mockGetResource(...args) },
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import type { TLibraryHighlight } from 'librechat-data-provider';
import ReaderBody from '../ReaderBody';

const HTML = '<h1>Title</h1><p>Memory <em>decays</em> on a forgetting curve.</p>';
const TEXT = 'TitleMemory decays on a forgetting curve.';
const HASH = 'a'.repeat(64);

const highlight = (overrides: Partial<TLibraryHighlight> = {}): TLibraryHighlight => ({
  id: 'h1',
  documentId: 'd1',
  anchor: { exact: 'Memory', prefix: 'Title', suffix: ' decays', start: 5, end: 11 },
  color: 'yellow',
  tags: [],
  contentHash: HASH,
  orphaned: false,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

function select(from: number, to: number) {
  const content = screen.getByTestId('library-reader-content');
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let position = 0;
  const range = document.createRange();
  let started = false;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    if (!started && from < position + length) {
      range.setStart(node, from - position);
      started = true;
    }
    if (started && to <= position + length) {
      range.setEnd(node, to - position);
      break;
    }
    position += length;
  }
  const selection = window.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(content);
}

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

afterEach(() => {
  jest.clearAllMocks();
  window.getSelection()?.removeAllRanges();
});

const renderBody = (props: Partial<React.ComponentProps<typeof ReaderBody>> = {}) =>
  render(
    <ReaderBody
      documentId="d1"
      html={HTML}
      anchorText={TEXT}
      contentHash={HASH}
      highlights={[]}
      {...props}
    />,
  );

describe('ReaderBody: showing text', () => {
  it('renders the server HTML as it is', () => {
    renderBody();
    expect(screen.getByTestId('library-reader-content').innerHTML).toBe(HTML);
    expect(screen.queryByTestId('library-highlighting-off')).not.toBeInTheDocument();
  });

  it('draws existing highlights over the text without changing it', () => {
    renderBody({ highlights: [highlight({ color: 'blue' })] });
    const content = screen.getByTestId('library-reader-content');
    const mark = content.querySelector('mark[data-library-highlight="h1"]');
    expect(mark?.textContent).toBe('Memory');
    expect(mark?.getAttribute('data-color')).toBe('blue');
    expect(content.textContent).toBe(TEXT);
  });

  it('shows plain text such as a PDF page as one block with its line breaks kept', () => {
    const page = 'First paragraph.\n\nSecond paragraph.';
    renderBody({ html: undefined, plainText: page, anchorText: page });
    const content = screen.getByTestId('library-reader-content');
    // One text node, so the text on screen is exactly the text highlights are anchored in.
    expect(content.textContent).toBe(page);
    expect(content.childNodes).toHaveLength(1);
    expect(content).toHaveClass('whitespace-pre-wrap');
    expect(screen.queryByTestId('library-highlighting-off')).not.toBeInTheDocument();
  });

  it('highlights plain text too, with offsets that count its line breaks', () => {
    const page = 'First paragraph.\n\nSecond paragraph.';
    renderBody({
      html: undefined,
      plainText: page,
      anchorText: page,
      unit: { kind: 'page', index: 3 },
      highlights: [
        highlight({ anchor: { exact: 'Second', prefix: '', suffix: '', start: 18, end: 24 } }),
      ],
    });
    expect(screen.getByTestId('library-reader-content').querySelector('mark')?.textContent).toBe(
      'Second',
    );
    select(18, 24);
    fireEvent.click(screen.getByLabelText('com_library_highlight_with:com_library_color_red'));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      anchor: { exact: 'Second', start: 18, end: 24 },
      unit: { kind: 'page', index: 3 },
      color: 'red',
    });
  });
});

describe('ReaderBody: making a highlight', () => {
  it('offers colours after a selection and sends the anchor, hash and unit', () => {
    renderBody({ unit: { kind: 'chapter', index: 2 } });
    select(5, 11);
    expect(screen.getByTestId('library-highlight-toolbar')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('com_library_highlight_with:com_library_color_green'));
    expect(mockCreate).toHaveBeenCalledWith({
      documentId: 'd1',
      anchor: {
        exact: 'Memory',
        prefix: 'Title',
        suffix: ' decays on a forgetting curve.',
        start: 5,
        end: 11,
      },
      contentHash: HASH,
      color: 'green',
      unit: { kind: 'chapter', index: 2 },
    });
    expect(screen.queryByTestId('library-highlight-toolbar')).not.toBeInTheDocument();
  });

  it('highlights the current selection in yellow when told to by the parent', () => {
    let handle: { highlightSelection: (color?: string) => boolean } | null = null;
    renderBody({
      registerHandle: (next) => {
        handle = next as typeof handle;
      },
    });
    expect(handle!.highlightSelection()).toBe(false);

    select(5, 11);
    let made = false;
    act(() => {
      made = handle!.highlightSelection();
    });
    expect(made).toBe(true);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'yellow',
        anchor: expect.objectContaining({ exact: 'Memory' }),
      }),
    );
    expect(screen.queryByTestId('library-highlight-toolbar')).not.toBeInTheDocument();
  });

  it('works across elements: the offsets count text, not markup', () => {
    renderBody();
    select(5, 18);
    fireEvent.click(screen.getByLabelText('com_library_highlight_with:com_library_color_yellow'));
    expect(mockCreate.mock.calls[0][0].anchor).toMatchObject({
      exact: 'Memory decays',
      start: 5,
      end: 18,
    });
  });

  it('offers nothing for an empty selection', () => {
    renderBody();
    const content = screen.getByTestId('library-reader-content');
    window.getSelection()?.removeAllRanges();
    fireEvent.mouseUp(content);
    expect(screen.queryByTestId('library-highlight-toolbar')).not.toBeInTheDocument();
  });

  it('turns highlighting off, and says so, when the rendered text is not the saved text', () => {
    renderBody({ anchorText: `${TEXT} something the browser did not render` });
    expect(screen.getByTestId('library-highlighting-off')).toBeInTheDocument();
    select(5, 11);
    expect(screen.queryByTestId('library-highlight-toolbar')).not.toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('turns highlighting off for text that cannot carry it, giving the reason', () => {
    renderBody({ highlightingDisabledReason: 'PDF pages cannot be highlighted yet' });
    select(5, 11);
    expect(screen.queryByTestId('library-highlight-toolbar')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('PDF pages cannot be highlighted yet');
  });

  it('puts the toolbar away when the reader scrolls', () => {
    renderBody();
    select(5, 11);
    fireEvent.scroll(screen.getByTestId('library-reader-scroll'));
    expect(screen.queryByTestId('library-highlight-toolbar')).not.toBeInTheDocument();
  });
});

describe('ReaderBody: remembering the position', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('saves the position once the reader stops scrolling, with the chapter if there is one', () => {
    renderBody({ unit: { kind: 'chapter', index: 4 } });
    const scroll = screen.getByTestId('library-reader-scroll');
    fireEvent.scroll(scroll);
    fireEvent.scroll(scroll);
    expect(mockProgress).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(mockProgress).toHaveBeenCalledTimes(1);
    expect(mockProgress).toHaveBeenCalledWith({
      id: 'd1',
      textOffset: expect.any(Number),
      unitIndex: 4,
    });
  });

  it('does not save a position over text it cannot place', () => {
    renderBody({ anchorText: 'something else entirely' });
    fireEvent.scroll(screen.getByTestId('library-reader-scroll'));
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(mockProgress).not.toHaveBeenCalled();
  });
});

describe('ReaderBody: book pictures', () => {
  const CHAPTER =
    '<p>Before</p><img alt="fig" data-epub-resource="OEBPS/images/a.png"><p>After</p>';
  const CHAPTER_TEXT = 'BeforeAfter';

  beforeEach(() => {
    mockGetResource.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    URL.createObjectURL = jest.fn(() => 'blob:fake-url');
    URL.revokeObjectURL = jest.fn();
  });

  it('fetches a chapter\u2019s pictures with the session and shows them, leaving the text alone', async () => {
    renderBody({
      html: CHAPTER,
      anchorText: CHAPTER_TEXT,
      unit: { kind: 'chapter', index: 0 },
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('library-reader-content').querySelector('img')?.getAttribute('src'),
      ).toBe('blob:fake-url'),
    );
    expect(mockGetResource).toHaveBeenCalledWith('d1', 'OEBPS/images/a.png');
    expect(screen.getByTestId('library-reader-content').textContent).toBe(CHAPTER_TEXT);
    expect(screen.queryByTestId('library-highlighting-off')).not.toBeInTheDocument();
  });

  it('leaves a picture out when it cannot be fetched, without complaint', async () => {
    mockGetResource.mockRejectedValue(new Error('404'));
    renderBody({ html: CHAPTER, anchorText: CHAPTER_TEXT, unit: { kind: 'chapter', index: 0 } });
    await waitFor(() => expect(mockGetResource).toHaveBeenCalled());
    expect(
      screen.getByTestId('library-reader-content').querySelector('img')?.getAttribute('src'),
    ).toBeNull();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('does not fetch pictures for an article or a page', () => {
    renderBody({ html: CHAPTER, anchorText: CHAPTER_TEXT });
    renderBody({
      html: CHAPTER,
      anchorText: CHAPTER_TEXT,
      unit: { kind: 'page', index: 0 },
    });
    expect(mockGetResource).not.toHaveBeenCalled();
  });

  it('lets go of its object URLs when the chapter goes away', async () => {
    const { unmount } = renderBody({
      html: CHAPTER,
      anchorText: CHAPTER_TEXT,
      unit: { kind: 'chapter', index: 0 },
    });
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
