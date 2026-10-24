import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockSave = jest.fn();
const mockUpload = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockBulkUpdate = jest.fn();
const mockBulkRemove = jest.fn();
const mockNavigate = jest.fn();
const mockToast = jest.fn();
let mockList: { data?: { documents: unknown[] }; isLoading: boolean; isError: boolean } = {
  data: { documents: [] },
  isLoading: false,
  isError: false,
};
let mockQueryParams: unknown;
let mockFolders: unknown[] = [];

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('~/hooks/Input', () => ({ useDebounce: (value: string) => value }));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useLibraryFoldersQuery: () => ({ data: { folders: mockFolders } }),
  useLibraryDocumentsQuery: (params: unknown) => {
    mockQueryParams = params;
    return mockList;
  },
  useSaveLibraryDocumentMutation: () => ({ mutate: mockSave, isLoading: false }),
  useUploadLibraryFileMutation: () => ({ mutate: mockUpload, isLoading: false }),
  useUpdateLibraryDocumentMutation: () => ({ mutate: mockUpdate }),
  useDeleteLibraryDocumentMutation: () => ({ mutate: mockRemove }),
  useBulkUpdateLibraryDocumentsMutation: () => ({ mutate: mockBulkUpdate, isLoading: false }),
  useBulkDeleteLibraryDocumentsMutation: () => ({ mutate: mockBulkRemove, isLoading: false }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

jest.mock('../ExportButtons', () => ({
  __esModule: true,
  default: ({ documentId }: { documentId?: string }) => (
    <div data-testid="export-buttons" data-document={documentId ?? ''} />
  ),
}));
jest.mock('../FolderBar', () => ({
  __esModule: true,
  NO_FOLDER: 'none',
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <button data-testid="folder-bar" data-value={value} onClick={() => onChange('f1')} />
  ),
}));
jest.mock('../Shelves', () => ({
  __esModule: true,
  default: () => <div data-testid="shelves" />,
}));
jest.mock('../PinnedViews', () => ({
  __esModule: true,
  default: ({
    current,
    canPin,
    onOpen,
  }: {
    current: unknown;
    canPin: boolean;
    onOpen: (filter: Record<string, string>) => void;
  }) => (
    <button
      data-testid="pinned"
      data-current={JSON.stringify(current)}
      data-can-pin={String(canPin)}
      onClick={() => onOpen({ location: 'later', kind: 'pdf', tag: 'paper', sort: 'title' })}
    />
  ),
}));
jest.mock('../Thumbnail', () => ({
  __esModule: true,
  default: ({ document }: { document: { id: string; thumbnailPath?: string } }) => (
    <div data-testid="thumbnail" data-id={document.id} data-path={document.thumbnailPath ?? ''} />
  ),
}));
jest.mock('../InboxPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="inbox-panel" />,
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
  mockFolders = [];
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

describe('LibraryView: the shelves', () => {
  it('shows them on the plain inbox, and not once the list is narrowed or searched', () => {
    render(<LibraryView />, { wrapper: MemoryRouter });
    expect(screen.getByTestId('shelves')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'com_library_kind_pdf' }));
    expect(screen.queryByTestId('shelves')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_kind_all' }));
    expect(screen.getByTestId('shelves')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'memory' } });
    expect(screen.queryByTestId('shelves')).not.toBeInTheDocument();
  });

  it('leaves them off the other tabs', () => {
    render(<LibraryView />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'com_library_tab_later' }));
    expect(screen.queryByTestId('shelves')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('inbox-panel')).toBeInTheDocument();
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

describe('LibraryView: export', () => {
  it('offers to export everything, not one document', () => {
    renderView();
    expect(screen.getByTestId('export-buttons')).toHaveAttribute('data-document', '');
  });
});

describe('LibraryView: folders', () => {
  it('asks for the chosen folder, and hides the folder bar on the Feed tab', () => {
    renderView();
    fireEvent.click(screen.getByTestId('folder-bar'));
    expect(mockQueryParams).toMatchObject({ location: 'inbox', folder: 'f1' });
    fireEvent.click(screen.getByRole('button', { name: 'com_library_tab_feed' }));
    expect(screen.queryByTestId('folder-bar')).not.toBeInTheDocument();
  });

  it('offers to move a document only once there is a folder, and files it', () => {
    mockList = { data: { documents: [doc()] }, isLoading: false, isError: false };
    const { unmount } = renderView();
    expect(screen.queryByLabelText(/com_library_folder_move/)).not.toBeInTheDocument();
    unmount();
    mockFolders = [{ id: 'f1', name: 'Work', documentCount: 0, createdAt: '' }];
    renderView();
    const select = screen.getByLabelText(/com_library_folder_move/);
    fireEvent.change(select, { target: { value: 'f1' } });
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'd1', patch: { folderId: 'f1' } });
    fireEvent.change(select, { target: { value: '' } });
    expect(mockUpdate).toHaveBeenLastCalledWith({ id: 'd1', patch: { folderId: null } });
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

describe('LibraryView: bulk actions and keyboard', () => {
  const two = () => {
    mockList = {
      data: { documents: [doc(), doc({ id: 'd2', title: 'Second page' })] },
      isLoading: false,
      isError: false,
    };
  };

  it('acts on every selected document at once', () => {
    two();
    renderView();

    fireEvent.click(screen.getByLabelText('com_library_select_row:Spaced repetition'));
    fireEvent.click(screen.getByLabelText('com_library_select_row:Second page'));
    const bar = screen.getByTestId('library-bulk-toolbar');
    expect(bar).toHaveTextContent('com_library_selected_count:2');

    fireEvent.click(within(bar).getByText('com_library_tab_archive'));

    expect(mockBulkUpdate).toHaveBeenCalledWith({ ids: ['d1', 'd2'], location: 'archive' });
  });

  it('selects everything from the header checkbox and deletes only after confirming', () => {
    two();
    renderView();

    fireEvent.click(screen.getByLabelText('com_library_select_all'));
    fireEvent.click(within(screen.getByTestId('library-bulk-toolbar')).getByText('com_ui_delete'));
    expect(mockBulkRemove).not.toHaveBeenCalled();

    expect(screen.getByRole('dialog')).toHaveTextContent('com_library_bulk_delete_confirm:2');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'com_ui_delete' }),
    );
    expect(mockBulkRemove).toHaveBeenCalledWith({ ids: ['d1', 'd2'] });
  });

  it('moves with j and k, and archives the document it stands on with e', () => {
    two();
    renderView();

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getAllByTestId('library-row')[0]).toHaveAttribute('aria-current', 'true');

    fireEvent.keyDown(window, { key: 'e' });
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'd1', patch: { location: 'archive' } });
  });

  it('opens the document with o, selects it with x and leaves typing alone', () => {
    two();
    renderView();

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'o' });
    expect(mockNavigate).toHaveBeenCalledWith('/library/d1');

    fireEvent.keyDown(window, { key: 'x' });
    expect(screen.getByLabelText('com_library_select_row:Spaced repetition')).toBeChecked();

    mockUpdate.mockClear();
    fireEvent.keyDown(screen.getByLabelText('com_library_search_placeholder'), { key: 'e' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('lists the shortcuts on request', () => {
    two();
    renderView();

    fireEvent.keyDown(window, { key: '?' });

    expect(screen.getByTestId('library-shortcuts')).toBeInTheDocument();
  });
});

describe('LibraryView: excerpt, kind and sort', () => {
  it('gives each row its picture', () => {
    mockList = {
      data: { documents: [doc({ thumbnailPath: '__thumbnail__' }), doc({ id: 'd2' })] },
      isLoading: false,
      isError: false,
    };
    renderView();
    const pictures = screen.getAllByTestId('thumbnail');
    expect(pictures.map((p) => p.getAttribute('data-path'))).toEqual(['__thumbnail__', '']);
  });

  it('shows the opening of each document under its title', () => {
    mockList = {
      data: {
        documents: [doc({ excerpt: 'Memory decays on a forgetting curve.' }), doc({ id: 'd2' })],
      },
      isLoading: false,
      isError: false,
    };
    renderView();
    const excerpts = screen.getAllByTestId('library-row-excerpt');
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]).toHaveTextContent('Memory decays on a forgetting curve.');
  });

  it('asks for one kind of document and for a sort order', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_kind_pdf' }));
    expect(mockQueryParams).toMatchObject({ kind: 'pdf', sort: 'updated' });
    fireEvent.change(screen.getByLabelText('com_library_sort'), { target: { value: 'title' } });
    expect(mockQueryParams).toMatchObject({ kind: 'pdf', sort: 'title' });
    fireEvent.click(screen.getByRole('button', { name: 'com_library_kind_all' }));
    expect(mockQueryParams).toMatchObject({ kind: undefined, sort: 'title' });
  });

  it('leaves the kind and sort out of a search', () => {
    renderView();
    fireEvent.change(screen.getByPlaceholderText('com_library_search_placeholder'), {
      target: { value: 'memory' },
    });
    expect(mockQueryParams).toEqual({ q: 'memory', limit: expect.any(Number) });
    expect(screen.queryByLabelText('com_library_sort')).toBeNull();
  });
});

describe('LibraryView: pinned views', () => {
  it('tells the pinned views what the list shows, and cannot pin while searching', () => {
    renderView();
    const pinned = screen.getByTestId('pinned');
    expect(JSON.parse(pinned.getAttribute('data-current') ?? '{}')).toEqual({
      location: 'inbox',
      sort: 'updated',
    });
    expect(pinned).toHaveAttribute('data-can-pin', 'true');
    fireEvent.change(screen.getByPlaceholderText('com_library_search_placeholder'), {
      target: { value: 'memory' },
    });
    expect(screen.getByTestId('pinned')).toHaveAttribute('data-can-pin', 'false');
  });

  it('opens a pinned view: its filters apply and a search is left behind', () => {
    renderView();
    const search = screen.getByPlaceholderText('com_library_search_placeholder');
    fireEvent.change(search, { target: { value: 'memory' } });
    fireEvent.click(screen.getByTestId('pinned'));
    expect(search).toHaveValue('');
    expect(mockQueryParams).toMatchObject({
      location: 'later',
      kind: 'pdf',
      tag: 'paper',
      sort: 'title',
    });
  });
});
