import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

type Params = { sort?: string; kind?: string; location?: string; limit?: number };
let mockResults: Record<string, unknown[]> = {};
const mockQuery = jest.fn((params: Params) => ({
  data: { documents: mockResults[params.sort ?? ''] ?? [] },
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/data-provider', () => ({
  useLibraryDocumentsQuery: (params: Params) => mockQuery(params),
  useLibraryThumbnailQuery: () => ({ data: undefined }),
}));
jest.mock('@librechat/client', () => ({ ...mockClient }));

import Shelves from '../Shelves';

const doc = (id: string, title: string, readingMinutes: number) => ({
  id,
  title,
  readingMinutes,
  kind: 'article',
  tags: [],
});

const renderShelves = () => render(<Shelves />, { wrapper: MemoryRouter });

beforeEach(() => {
  mockResults = {};
  mockQuery.mockClear();
});

describe('Shelves', () => {
  it('asks for the inbox’s articles, shortest and longest first', () => {
    renderShelves();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'inbox', kind: 'article', sort: 'shortest' }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'inbox', kind: 'article', sort: 'longest' }),
    );
  });

  it('puts only the short ones on the quick shelf and only the long ones on the long shelf', () => {
    mockResults = {
      shortest: [doc('a', 'Tiny', 2), doc('b', 'Five', 5), doc('c', 'Medium', 9)],
      longest: [doc('d', 'Epic', 40), doc('e', 'Fifteen', 15), doc('c', 'Medium', 9)],
    };
    renderShelves();

    const quick = within(screen.getByTestId('library-shelf-quick'));
    expect(quick.getByRole('link', { name: /Tiny/ })).toHaveAttribute('href', '/library/a');
    expect(quick.getByRole('link', { name: /Five/ })).toBeInTheDocument();
    expect(quick.queryByText('Medium')).not.toBeInTheDocument();

    const long = within(screen.getByTestId('library-shelf-long'));
    expect(long.getByRole('link', { name: /Epic/ })).toHaveAttribute('href', '/library/d');
    expect(long.getByRole('link', { name: /Fifteen/ })).toBeInTheDocument();
    expect(long.queryByText('Medium')).not.toBeInTheDocument();
  });

  it('shows a shelf’s length and leaves out a shelf with nothing on it', () => {
    mockResults = { shortest: [doc('a', 'Tiny', 0)], longest: [doc('c', 'Medium', 9)] };
    renderShelves();

    expect(screen.getByText('com_library_minutes:1')).toBeInTheDocument();
    expect(screen.queryByTestId('library-shelf-long')).not.toBeInTheDocument();
  });

  it('renders nothing when neither shelf has anything', () => {
    mockResults = { shortest: [doc('c', 'Medium', 9)], longest: [doc('c', 'Medium', 9)] };
    const { container } = renderShelves();
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps each shelf to eight', () => {
    mockResults = {
      shortest: Array.from({ length: 12 }, (_, i) => doc(`s${i}`, `Short ${i}`, 3)),
    };
    renderShelves();
    expect(within(screen.getByTestId('library-shelf-quick')).getAllByRole('link')).toHaveLength(8);
  });
});
