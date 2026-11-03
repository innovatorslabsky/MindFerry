import React from 'react';
import { RecoilRoot } from 'recoil';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockList = jest.fn();
jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: { listLibraryDocuments: (params: unknown) => mockList(params) },
}));

import { useLibraryDocumentsQuery } from '../queries';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <RecoilRoot>
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  </RecoilRoot>
);

describe('useLibraryDocumentsQuery', () => {
  it('asks again when only the reading status changes, instead of showing the list it already has', async () => {
    mockList.mockResolvedValue({ documents: [] });
    const { rerender } = renderHook(
      ({ status }: { status?: 'finished' }) =>
        useLibraryDocumentsQuery({ location: 'inbox', status }),
      { wrapper, initialProps: {} as { status?: 'finished' } },
    );
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));

    rerender({ status: 'finished' });
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(mockList).toHaveBeenLastCalledWith({ location: 'inbox', status: 'finished' });
  });
});
