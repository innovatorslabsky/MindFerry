import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockUpdate = jest.fn();
const mockToast = jest.fn();
let mockUpdateOptions: { onSuccess?: () => void; onError?: () => void } | undefined;

jest.mock('recoil', () => ({ ...jest.requireActual('recoil'), useRecoilValue: () => null }));
jest.mock('~/store', () => ({ __esModule: true, default: { conversationByIndex: () => 'convo' } }));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useSummarizeLibraryDocumentMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUpdateLibraryDocumentMutation: (options: typeof mockUpdateOptions) => {
    mockUpdateOptions = options;
    return { mutate: mockUpdate, isLoading: false };
  },
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import InfoPanel, { formatDate, webAddress } from '../InfoPanel';

const doc = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'd1',
    urlKey: 'k',
    normalizedUrl: 'https://www.example.test/post',
    kind: 'article',
    title: 'Spaced repetition',
    siteName: 'example.test',
    byline: 'Ada Lovelace',
    publishedTime: '2024-03-05T00:00:00Z',
    contentHash: 'h',
    wordCount: 1500,
    readingMinutes: 7,
    unitCount: 0,
    toc: [],
    location: 'inbox',
    tags: [],
    hasSource: false,
    fetchedAt: '',
    createdAt: '2024-04-01T00:00:00Z',
    updatedAt: '',
    ...overrides,
  }) as never;

afterEach(() => jest.clearAllMocks());

describe('helpers', () => {
  it('formats a date it can read and passes on one it cannot', () => {
    expect(formatDate('2024-03-05T12:00:00Z')).toBe(
      new Date('2024-03-05T12:00:00Z').toLocaleDateString(),
    );
    expect(formatDate('spring 2024')).toBe('spring 2024');
    expect(formatDate('2024-13-45')).toBe('2024-13-45');
    expect(formatDate(undefined)).toBeUndefined();
  });

  it('only turns web addresses into links', () => {
    expect(webAddress('https://example.test/a')).toBe('https://example.test/a');
    expect(webAddress('mail://abc')).toBeUndefined();
    expect(webAddress('javascript:alert(1)')).toBeUndefined();
    expect(webAddress('not a url')).toBeUndefined();
  });
});

describe('InfoPanel: details', () => {
  it('shows what is known about an article, with a link to where it came from', () => {
    render(<InfoPanel document={doc()} />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('com_library_kind_article_one')).toBeInTheDocument();
    expect(screen.getByText('com_library_length_article:7,1,500')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'www.example.test' });
    expect(link).toHaveAttribute('href', 'https://www.example.test/post');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('describes a book by its sections, and gives a newsletter no link', () => {
    render(
      <InfoPanel
        document={doc({
          kind: 'epub',
          unitCount: 12,
          normalizedUrl: 'mail://abc',
          siteName: undefined,
        })}
      />,
    );
    expect(screen.getByText('com_library_length_book:12,7')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('InfoPanel: editing the metadata', () => {
  const open = (document = doc()) => {
    render(<InfoPanel document={document} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_library_edit_metadata' }));
  };

  it('saves a new title and author', () => {
    open();
    fireEvent.change(screen.getByLabelText('com_library_meta_title'), {
      target: { value: '  A better title ' },
    });
    fireEvent.change(screen.getByLabelText('com_library_meta_author'), { target: { value: 'Me' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_library_meta_save' }));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'd1',
      patch: { title: 'A better title', byline: 'Me' },
    });
  });

  it('takes the author off when the field is emptied', () => {
    open();
    fireEvent.change(screen.getByLabelText('com_library_meta_author'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_library_meta_save' }));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'd1',
      patch: { title: 'Spaced repetition', byline: null },
    });
  });

  it('will not save an empty title', () => {
    open();
    fireEvent.change(screen.getByLabelText('com_library_meta_title'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'com_library_meta_save' })).toBeDisabled();
  });

  it('closes on cancel and after a save, and says so when it fails', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));
    expect(screen.queryByTestId('library-metadata-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_edit_metadata' }));
    mockUpdateOptions?.onError?.();
    expect(mockToast).toHaveBeenCalledWith({ message: 'com_library_edit_error', status: 'error' });
  });
});

describe('InfoPanel: the summary', () => {
  it('is saved when the field loses focus and only if it changed', () => {
    render(<InfoPanel document={doc({ summary: 'Old.' })} />);
    const field = screen.getByLabelText('com_library_summary');
    expect(field).toHaveValue('Old.');
    fireEvent.blur(field);
    expect(mockUpdate).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: ' New summary ' } });
    fireEvent.blur(field);
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'd1', patch: { summary: 'New summary' } });
  });

  it('is removed by emptying it', () => {
    render(<InfoPanel document={doc({ summary: 'Old.' })} />);
    const field = screen.getByLabelText('com_library_summary');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'd1', patch: { summary: '' } });
  });
});
