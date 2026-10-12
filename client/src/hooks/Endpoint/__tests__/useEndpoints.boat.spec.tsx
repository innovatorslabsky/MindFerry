import React from 'react';
import { render, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TEndpointsConfig, TStartupConfig } from 'librechat-data-provider';
import { useEndpoints } from '../useEndpoints';

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: () => ({ data: {} }),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: ['agents'] }),
}));

jest.mock('~/hooks', () => ({
  useHasAccess: () => true,
  useShowMarketplace: () => true,
}));

jest.mock('@librechat/client', () => ({
  Sparkles: () => <span data-testid="sparkles" />,
  ProviderIcon: () => <span data-testid="provider-icon" />,
}));

jest.mock('../useProviderIcon', () => ({
  resolveProviderIcon: () => ({ provider: undefined, imageURL: undefined }),
}));

jest.mock('~/utils', () => ({
  mapEndpoints: (config: unknown) => config,
  cn: (...classes: string[]) => classes.filter(Boolean).join(' '),
}));

describe('useEndpoints agents icon', () => {
  it('marks My Agents with the MindFerry boat instead of the feather', () => {
    const { result } = renderHook(() =>
      useEndpoints({
        agents: [],
        endpointsConfig: {} as TEndpointsConfig,
        startupConfig: undefined as TStartupConfig | undefined,
      }),
    );
    const agents = result.current.mappedEndpoints.find(
      (endpoint) => endpoint.value === EModelEndpoint.agents,
    );
    const { container } = render(<>{agents?.icon}</>);

    expect(container.querySelector('img')).toHaveAttribute('src', 'assets/logo.svg');
    expect(container.querySelector('svg')).toBeNull();
  });
});
