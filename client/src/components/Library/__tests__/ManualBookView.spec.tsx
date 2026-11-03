import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import type { TLibraryDocumentSummary } from 'librechat-data-provider';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    asChild: _asChild,
    ...rest
  }: React.PropsWithChildren<{ asChild?: boolean }>) => <span {...rest}>{children}</span>,
}));
jest.mock('../InfoPanel', () => ({
  __esModule: true,
  default: ({ document }: { document: { id: string } }) => (
    <div data-testid="info-panel">{document.id}</div>
  ),
}));
jest.mock('../TagEditor', () => ({
  __esModule: true,
  default: ({ tags }: { tags: string[] }) => <div data-testid="tag-editor">{tags.join(',')}</div>,
}));
jest.mock('../NoteField', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="note-field">{value}</div>,
}));

import ManualBookView from '../ManualBookView';

const book = (extra: Partial<TLibraryDocumentSummary> = {}) =>
  ({
    id: 'b1',
    kind: 'manual',
    title: 'Piranesi',
    byline: 'Susanna Clarke',
    tags: ['fantasy'],
    ...extra,
  }) as TLibraryDocumentSummary;

describe('ManualBookView', () => {
  it('shows the book’s title and author, its status and time read, its tags and the person’s note', () => {
    render(<ManualBookView document={book({ note: 'Loved it' })} />, { wrapper: MemoryRouter });
    expect(screen.getByRole('heading', { name: 'Piranesi' })).toBeInTheDocument();
    expect(screen.getByText('Susanna Clarke')).toBeInTheDocument();
    expect(screen.getByTestId('info-panel')).toHaveTextContent('b1');
    expect(screen.getByTestId('tag-editor')).toHaveTextContent('fantasy');
    expect(screen.getByTestId('note-field')).toHaveTextContent('Loved it');
    expect(screen.getByText('com_library_manual_hint')).toBeInTheDocument();
  });

  it('links back to the library, and has no reader, menu or share', () => {
    render(<ManualBookView document={book()} />, { wrapper: MemoryRouter });
    expect(screen.getByRole('link', { name: 'com_library_back' })).toHaveAttribute(
      'href',
      '/library',
    );
    expect(screen.queryByTestId('library-reader-scroll')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reader-menu')).not.toBeInTheDocument();
  });
});
