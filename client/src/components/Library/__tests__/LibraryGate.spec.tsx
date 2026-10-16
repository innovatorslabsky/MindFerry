import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

let mockState: { data?: { libraryEnabled?: boolean }; isLoading: boolean } = {
  data: { libraryEnabled: true },
  isLoading: false,
};

jest.mock('~/data-provider', () => ({ useGetStartupConfig: () => mockState }));
jest.mock('@librechat/client', () => mockClient);

import LibraryGate from '../LibraryGate';

const renderGate = () =>
  render(
    <MemoryRouter initialEntries={['/library']}>
      <Routes>
        <Route
          path="/library"
          element={
            <LibraryGate>
              <p data-testid="page" />
            </LibraryGate>
          }
        />
        <Route path="/c/new" element={<p data-testid="home" />} />
      </Routes>
    </MemoryRouter>,
  );

describe('LibraryGate', () => {
  it('shows the page where the library is on', () => {
    mockState = { data: { libraryEnabled: true }, isLoading: false };
    renderGate();
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  it('waits for the config rather than bouncing early', () => {
    mockState = { data: undefined, isLoading: true };
    renderGate();
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it.each([[{ libraryEnabled: false }], [{}], [undefined]])(
    'sends the person home when the library is off (%p)',
    (data) => {
      mockState = { data, isLoading: false };
      renderGate();
      expect(screen.getByTestId('home')).toBeInTheDocument();
    },
  );
});
