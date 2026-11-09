import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockBridgeClient } from 'test/bridgeMocks';

let mockState: { data?: { agentBridgeEnabled?: boolean }; isLoading: boolean };
let mockUser: { role?: string } | undefined;

jest.mock('~/data-provider', () => ({ useGetStartupConfig: () => mockState }));
jest.mock('~/hooks/AuthContext', () => ({ useAuthContext: () => ({ user: mockUser }) }));
jest.mock('@librechat/client', () => mockBridgeClient);

import BridgeGate from '../BridgeGate';

const renderGate = () =>
  render(
    <MemoryRouter initialEntries={['/bridge']}>
      <Routes>
        <Route
          path="/bridge"
          element={
            <BridgeGate>
              <p data-testid="page" />
            </BridgeGate>
          }
        />
        <Route path="/c/new" element={<p data-testid="home" />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mockState = { data: { agentBridgeEnabled: true }, isLoading: false };
  mockUser = { role: 'ADMIN' };
});

describe('BridgeGate', () => {
  it('shows the page to an admin where the bridge is on', () => {
    renderGate();
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  it('waits for the config rather than bouncing early', () => {
    mockState = { data: undefined, isLoading: true };
    renderGate();
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it.each([[{ agentBridgeEnabled: false }], [{}], [undefined]])(
    'sends everyone home when the bridge is off (%p)',
    (data) => {
      mockState = { data, isLoading: false };
      renderGate();
      expect(screen.getByTestId('home')).toBeInTheDocument();
      expect(screen.queryByTestId('page')).not.toBeInTheDocument();
    },
  );

  it.each([[{ role: 'USER' }], [{ role: 'custom-role' }], [{}], [undefined]])(
    'sends a person who is not an admin home (%p)',
    (user) => {
      mockUser = user;
      renderGate();
      expect(screen.getByTestId('home')).toBeInTheDocument();
      expect(screen.queryByTestId('page')).not.toBeInTheDocument();
    },
  );
});
