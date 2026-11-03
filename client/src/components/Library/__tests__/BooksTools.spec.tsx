import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockAdd = jest.fn();
const mockImport = jest.fn();
const mockKindle = jest.fn();
const mockToast = jest.fn();
let addOptions: { onSuccess?: () => void } = {};
let kindleOptions: {
  onSuccess?: (data: { books: number; highlights: number; existing: number }) => void;
  onError?: (error: unknown) => void;
} = {};
let importOptions: {
  onSuccess?: (data: { created: number; existing: number; skipped: number }) => void;
  onError?: (error: unknown) => void;
} = {};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useAddLibraryBookMutation: (options: typeof addOptions) => {
    addOptions = options;
    return { mutate: mockAdd, isLoading: false };
  },
  useImportLibraryKindleMutation: (options: typeof kindleOptions) => {
    kindleOptions = options;
    return { mutate: mockKindle, isLoading: false };
  },
  useImportLibraryGoodreadsMutation: (options: typeof importOptions) => {
    importOptions = options;
    return { mutate: mockImport, isLoading: false };
  },
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Spinner: () => <span />,
  OGDialogTemplate: ({ title, main }: { title: string; main: React.ReactNode }) => (
    <div>
      <h2>{title}</h2>
      {main}
    </div>
  ),
  useToastContext: () => ({ showToast: mockToast }),
}));

import BooksTools from '../BooksTools';

afterEach(() => jest.clearAllMocks());

const openForm = () => {
  render(<BooksTools />);
  fireEvent.click(screen.getByRole('button', { name: /com_library_add_book$/ }));
};

describe('BooksTools: adding a book by hand', () => {
  it('needs a title, and pages that are a whole number in range, before it can be added', () => {
    openForm();
    const add = screen.getByRole('button', { name: 'com_library_add_book_save' });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText('com_library_add_book_title'), {
      target: { value: 'Piranesi' },
    });
    expect(add).toBeEnabled();
    for (const bad of ['0', '2.5', '20001', '-4']) {
      fireEvent.change(screen.getByLabelText('com_library_add_book_pages'), {
        target: { value: bad },
      });
      expect(add).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText('com_library_add_book_pages'), {
      target: { value: '272' },
    });
    expect(add).toBeEnabled();
  });

  it('sends the title, author, pages and status, trimmed, and leaves out what was not given', () => {
    openForm();
    fireEvent.change(screen.getByLabelText('com_library_add_book_title'), {
      target: { value: '  Piranesi ' },
    });
    fireEvent.submit(screen.getByTestId('library-add-book'));
    expect(mockAdd).toHaveBeenLastCalledWith({ title: 'Piranesi', readingStatus: 'reading' });

    fireEvent.change(screen.getByLabelText('com_library_add_book_author'), {
      target: { value: 'Susanna Clarke' },
    });
    fireEvent.change(screen.getByLabelText('com_library_add_book_pages'), {
      target: { value: '272' },
    });
    fireEvent.change(screen.getByLabelText('com_library_status'), {
      target: { value: 'finished' },
    });
    fireEvent.submit(screen.getByTestId('library-add-book'));
    expect(mockAdd).toHaveBeenLastCalledWith({
      title: 'Piranesi',
      byline: 'Susanna Clarke',
      pages: 272,
      readingStatus: 'finished',
    });
  });

  it('says so and closes once the book is added', () => {
    openForm();
    act(() => addOptions.onSuccess?.());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_library_add_book_done' }),
    );
    expect(screen.queryByTestId('library-add-book')).not.toBeInTheDocument();
  });
});

describe('BooksTools: importing from Goodreads', () => {
  it('sends the chosen file, and says how many books came in', () => {
    render(<BooksTools />);
    const file = new File(['Title\nA'], 'goodreads_library_export.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('library-goodreads-file'), { target: { files: [file] } });
    expect(mockImport).toHaveBeenCalledTimes(1);
    const form = mockImport.mock.calls[0][0] as FormData;
    expect((form.get('file') as File).name).toBe('goodreads_library_export.csv');

    importOptions.onSuccess?.({ created: 12, existing: 3, skipped: 0 });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_library_goodreads_done:12,3' }),
    );
  });

  it('explains a file that is not an export', () => {
    render(<BooksTools />);
    importOptions.onError?.({ response: { data: { error: { code: 'invalid_file' } } } });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_library_goodreads_invalid' }),
    );
  });

  it('accepts only CSV in the picker', () => {
    render(<BooksTools />);
    expect(screen.getByTestId('library-goodreads-file')).toHaveAttribute(
      'accept',
      expect.stringContaining('.csv'),
    );
  });
});

describe('BooksTools: importing Kindle highlights', () => {
  it('sends the chosen file, and says how many highlights came in', () => {
    render(<BooksTools />);
    const file = new File(['x'], 'My Clippings.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('library-kindle-file'), { target: { files: [file] } });
    const form = mockKindle.mock.calls[0][0] as FormData;
    expect((form.get('file') as File).name).toBe('My Clippings.txt');

    kindleOptions.onSuccess?.({ books: 4, highlights: 37, existing: 2 });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_library_kindle_done:37,4,2' }),
    );
  });

  it('explains a file that is not clippings, and any other failure', () => {
    render(<BooksTools />);
    kindleOptions.onError?.({ response: { data: { error: { code: 'invalid_file' } } } });
    expect(mockToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'com_library_kindle_invalid' }),
    );
    kindleOptions.onError?.(new Error('network'));
    expect(mockToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'com_library_kindle_error' }),
    );
  });

  it('accepts only text files in the picker', () => {
    render(<BooksTools />);
    expect(screen.getByTestId('library-kindle-file')).toHaveAttribute(
      'accept',
      expect.stringContaining('.txt'),
    );
  });
});
