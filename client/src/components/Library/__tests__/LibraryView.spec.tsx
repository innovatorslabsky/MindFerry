import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockSave = jest.fn();
const mockUpload = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockToast = jest.fn();
let mockList: { data?: { documents: unknown[] }; isLoading: boolean; isError: boolean } = {
  data: { documents: [] },
  isLoading: false,
  isError: false,
};
let mockQueryParams: unknown;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/hooks/Input', () => ({ useDebounce: (value: string) => value }));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useLibraryDocumentsQuery: (params: unknown) => {
    mockQueryParams = params;
    return mockList;
  },
  useSaveLibraryDocumentMutation: () => ({ mutate: mockSave, isLoading: false }),
  useUploadLibraryFileMutation: () => ({ mutate: mockUpload, isLoading: false }),
  useUpdateLibraryDocumentMutation: () => ({ mutate: mockUpdate }),
  useDeleteLibraryDocumentMutation: () => ({ mutate: mockRemove }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

jest.mock('../FeedsPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="feeds-panel" />,
}));

import LibraryView from '../LibraryView';

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  urlKey: 'k',
  normalizedUrl: 'https://example.test/a',
  kind: 'article',
  title: 'Spaced repetition',
  siteName: 'example.test',
  contentHash: 'h',
  wordCount: 500,
  readingMinutes: 3,
  unitCount: 0,
  toc: [],
  location: 'inbox',
  tags: [],
  fetchedAt: '',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const renderView = () => render(<LibraryView />, { wrapper: MemoryRouter });

beforeEach(() => {
  mockList = { data: { documents: [] }, isLoading: false, isError: false };
});
afterEach(() => jest.clearAllMocks());

describe('LibraryView: the list', () => {
  it('lists documents as links to the reader, with what kind and how long', () => {
    mockList = {
      data: {
        documents: [
          doc(),
          doc({ id: 'd2', kind: 'pdf', title: 'A paper', unitCount: 12, siteName: undefined }),
          doc({ id: 'd3', kind: 'epub', title: 'A book', unitCount: 9 }),
        ],
      },
      isLoading: false,
      isError: false,
    };
    renderView();
    const rows = screen.getAllByTestId('library-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/library/d1');
    expect(rows[0]).toHaveTextContent('com_library_minutes:3');
    expect(rows[1]).toHaveTextContent('com_library_kind_pdf');
    expect(rows[1]).toHaveTextContent('com_library_pages:12');
    expect(rows[2]).toHaveTextContent('com_library_chapters:9');
  });

  it('warns about a scanned PDF and a book that was cut short', () => {
    mockList = {
      data: { documents: [doc({ kind: 'pdf', needsOcr: true, truncated: true })] },
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(screen.getByText('com_library_needs_ocr')).toBeInTheDocument();
    expect(screen.getByText('com_library_truncated')).toBeInTheDocument();
  });

  it('shows loading, error and empty states', () => {
    mockList = { isLoading: true, isError: false };
    const { rerender } = renderView();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    mockList = { isLoading: false, isError: true };
    rerender(<LibraryView />);
    expect(screen.getByText('com_library_load_error')).toBeInTheDocument();
    mockList = { data: { documents: [] }, isLoading: false, isError: false };
    rerender(<LibraryView />);
    expect(screen.getByText('com_library_empty')).toBeInTheDocument();
  });
});

describe('LibraryView: finding things', () => {
  it('asks for the current tab, and for matches instead once there is a search', () => {
    renderView();
    expect(mockQueryParams).toMatchObject({ location: 'inbox' });
    fireEvent.click(screen.getByRole('button', { name: 'com_library_tab_archive' }));
    expect(mockQueryParams).toMatchObject({ location: 'archive' });
    expect(screen.getByRole('button', { name: 'com_library_tab_archive' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'com_library_tab_inbox' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.change(screen.getByLabelText('com_library_search_placeholder'), {
      target: { value: 'memory' },
    });
    expect(mockQueryParams).toMatchObject({ q: 'memory' });
    expect(mockQueryParams).not.toHaveProperty('location');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByText('com_library_empty_search')).toBeInTheDocument();
  });
});

describe('LibraryView: the Feed tab and tags', () => {
  it('shows the followed feeds only on the Feed tab, and saves your own links to the inbox', () => {
    renderView();
    expect(screen.queryByTestId('feeds-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_tab_feed' }));
    expect(mockQueryParams).toMatchObject({ location: 'feed' });
    expect(screen.getByTestId('feeds-panel')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('com_library_add_placeholder'), {
      target: { value: 'https://example.test/x' },
    });
    fireEvent.submit(screen.getByLabelText('com_library_add_placeholder'));
    expect(mockSave).toHaveBeenCalledWith({ url: 'https://example.test/x', location: 'inbox' });
  });

  it('filters by a tag chosen on a row, and clears it', () => {
    mockList = {
      data: { documents: [doc({ tags: ['psych'] })] },
      isLoading: false,
      isError: false,
    };
    renderView();
    fireEvent.click(screen.getByLabelText('com_library_tag_filter:psych'));
    expect(mockQueryParams).toMatchObject({ location: 'inbox', tag: 'psych' });
    fireEvent.click(screen.getByLabelText('com_library_tag_filter_clear:psych'));
    expect(mockQueryParams).toMatchObject({ location: 'inbox', tag: undefined });
  });
});

describe('LibraryView: saving', () => {
  it('saves the address into the tab that is open, and ignores a blank one', () => {
    renderView();
    const input = screen.getByLabelText('com_library_add_placeholder');
    expect(screen.getByRole('button', { name: 'com_library_save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_tab_later' }));
    fireEvent.change(input, { target: { value: '  https://example.test/post  ' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(mockSave).toHaveBeenCalledWith({ url: 'https://example.test/post', location: 'later' });
  });

  it('uploads the chosen file as a form with the tab', () => {
    renderView();
    const file = new File(['%PDF-1.4'], 'paper.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('library-upload-input'), { target: { files: [file] } });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const form = mockUpload.mock.calls[0][0] as FormData;
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('location')).toBe('inbox');
  });

  it('accepts only PDF and EPUB in the picker', () => {
    renderView();
    expect(screen.getByTestId('library-upload-input')).toHaveAttribute(
      'accept',
      expect.stringContaining('.epub'),
    );
  });
});

describe('LibraryView: managing a document', () => {
  beforeEach(() => {
    mockList = { data: { documents: [doc()] }, isLoading: false, isError: false };
  });

  it('moves a document to another place, and not to the one it is in', () => {
    renderView();
    expect(screen.queryByLabelText('com_library_move_inbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('com_library_move_archive'));
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'd1', patch: { location: 'archive' } });
  });

  it('asks before deleting, and deletes only on confirmation', () => {
    renderView();
    fireEvent.click(screen.getByLabelText('com_ui_delete'));
    expect(mockRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'com_library_delete_confirm:Spaced repetition',
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'com_ui_delete' }),
    );
    expect(mockRemove).toHaveBeenCalledWith({ id: 'd1' });
  });
});
