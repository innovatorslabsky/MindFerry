import { QueryKeys, dataService } from 'librechat-data-provider';
import {
  useQuery,
  useInfiniteQuery,
  UseQueryOptions,
  QueryObserverResult,
} from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';

/**
 * Hook for fetching all accessible MCP servers with permission metadata
 */
export const useMCPServersQuery = <TData = t.MCPServersListResponse>(
  config?: UseQueryOptions<t.MCPServersListResponse, unknown, TData>,
): QueryObserverResult<TData> => {
  return useQuery<t.MCPServersListResponse, unknown, TData>(
    [QueryKeys.mcpServers],
    () => dataService.getMCPServers(),
    {
      staleTime: 30 * 1000, // 30 seconds — short enough to pick up servers that finish initializing after first load
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
      refetchOnMount: true,
      retry: false,
      ...config,
    },
  );
};

/**
 * Cursor-paginated search over the operator-enabled MCP directory. A 404 means the
 * directory is switched off, so it is never retried.
 */
export const useMCPDirectoryQuery = (
  params: Omit<t.MCPDirectoryParams, 'cursor'>,
  config?: { enabled?: boolean },
) => {
  return useInfiniteQuery<t.MCPDirectoryResponse>(
    [QueryKeys.mcpDirectory, params],
    ({ pageParam }) => dataService.getMCPDirectory({ ...params, cursor: pageParam }),
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: false,
      ...config,
    },
  );
};

/**
 * Hook for fetching MCP-specific tools
 * @param config - React Query configuration
 * @returns MCP servers with their tools
 */
export const useMCPToolsQuery = <TData = t.MCPServersResponse>(
  config?: UseQueryOptions<t.MCPServersResponse, unknown, TData>,
): QueryObserverResult<TData> => {
  return useQuery<t.MCPServersResponse, unknown, TData>(
    [QueryKeys.mcpTools],
    () => dataService.getMCPTools(),
    {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 5 * 60 * 1000,
      refetchInterval: false,
      refetchIntervalInBackground: false,
      ...config,
    },
  );
};
