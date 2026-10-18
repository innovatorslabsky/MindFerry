import React from 'react';
import { render, screen } from '@testing-library/react';

let mockImage: { data?: Blob } = {};
const mockQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  useLibraryThumbnailQuery: (...args: unknown[]) => {
    mockQuery(...args);
    return mockImage;
  },
}));

import Thumbnail from '../Thumbnail';

beforeEach(() => {
  mockImage = {};
  URL.createObjectURL = jest.fn(() => 'blob:thumb');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => jest.clearAllMocks());

describe('Thumbnail', () => {
  it('shows an icon tile for a document with no picture', () => {
    render(<Thumbnail document={{ id: 'd1', kind: 'pdf' }} />);
    expect(screen.getByTestId('library-thumbnail')).toBeInTheDocument();
    expect(screen.queryByTestId('library-thumbnail-image')).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith('d1', undefined);
  });

  it('shows the picture once it has been fetched, and lets go of it afterwards', () => {
    mockImage = { data: new Blob(['x'], { type: 'image/png' }) };
    const { unmount } = render(
      <Thumbnail document={{ id: 'd1', kind: 'article', thumbnailPath: '__thumbnail__' }} />,
    );
    expect(screen.getByTestId('library-thumbnail-image')).toHaveAttribute('src', 'blob:thumb');
    expect(mockQuery).toHaveBeenCalledWith('d1', '__thumbnail__');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb');
  });
});
