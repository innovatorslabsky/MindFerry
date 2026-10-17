import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

let mockConfig: { libraryEnabled?: boolean } | undefined = { libraryEnabled: true };

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/data-provider', () => ({ useGetStartupConfig: () => ({ data: mockConfig }) }));
jest.mock('@librechat/client', () => mockClient);

import LibraryButton from '../../Nav/LibraryButton';

const renderButton = (layout?: 'icon' | 'row') =>
  render(<LibraryButton layout={layout} />, { wrapper: MemoryRouter });

describe('LibraryButton', () => {
  afterEach(() => {
    mockConfig = { libraryEnabled: true };
  });

  it('links to the library when the operator turned it on', () => {
    renderButton();
    expect(screen.getByTestId('nav-library-button')).toHaveAttribute('href', '/library');
  });

  it.each([[{ libraryEnabled: false }], [{}], [undefined]])(
    'leaves no gap when the library is off (%p)',
    (config) => {
      mockConfig = config;
      const { container } = renderButton();
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('carries its own label as a row and relies on the tooltip as an icon', () => {
    renderButton('row');
    expect(screen.getByText('com_library_nav')).toBeInTheDocument();
  });
});
