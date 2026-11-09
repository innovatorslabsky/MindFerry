import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { mockBridgeClient } from 'test/bridgeMocks';

let mockConfig: { agentBridgeEnabled?: boolean } | undefined;
let mockUser: { role?: string } | undefined;

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/data-provider', () => ({ useGetStartupConfig: () => ({ data: mockConfig }) }));
jest.mock('~/hooks/AuthContext', () => ({ useAuthContext: () => ({ user: mockUser }) }));
jest.mock('@librechat/client', () => mockBridgeClient);

import BridgeButton from '../../Nav/BridgeButton';

const renderButton = (layout?: 'icon' | 'row') =>
  render(<BridgeButton layout={layout} />, { wrapper: MemoryRouter });

beforeEach(() => {
  mockConfig = { agentBridgeEnabled: true };
  mockUser = { role: 'ADMIN' };
});

describe('BridgeButton', () => {
  it('links an admin to the page when the bridge is on', () => {
    renderButton();
    expect(screen.getByTestId('nav-bridge-button')).toHaveAttribute('href', '/bridge');
  });

  it.each([[{ agentBridgeEnabled: false }], [{}], [undefined]])(
    'leaves no gap when the bridge is off (%p)',
    (config) => {
      mockConfig = config;
      expect(renderButton().container).toBeEmptyDOMElement();
    },
  );

  it.each([[{ role: 'USER' }], [{}], [undefined]])(
    'leaves no gap for someone who is not an admin (%p)',
    (user) => {
      mockUser = user;
      expect(renderButton().container).toBeEmptyDOMElement();
    },
  );

  it('carries its own label as a row', () => {
    renderButton('row');
    expect(screen.getByText('com_bridge_nav')).toBeInTheDocument();
  });
});
