import { useRecoilValue } from 'recoil';
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type t from 'librechat-data-provider';
import store from '~/store';

/** Recent threads, or matches for `q` when it's non-empty — the read side of
 *  MindFerry's own "browse the archive" page, distinct from the MCP tools an
 *  external client uses for the same data. */
export const useListHubThreadsQuery = (
  params: { q?: string; limit?: number; surface?: t.THubSurface; excludeLive?: boolean } = {},
  config?: UseQueryOptions<t.TListHubThreadsResponse>,
): QueryObserverResult<t.TListHubThreadsResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TListHubThreadsResponse>(
    [
      QueryKeys.hubThreads,
      params.q ?? '',
      params.limit ?? null,
      params.surface ?? '',
      params.excludeLive === true,
    ],
    () => dataService.listHubThreads(params),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetHubThreadQuery = (
  id: string | undefined,
  config?: UseQueryOptions<t.TGetHubThreadResponse>,
): QueryObserverResult<t.TGetHubThreadResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TGetHubThreadResponse>(
    [QueryKeys.hubThread, id],
    () => dataService.getHubThread(id as string),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled && id != null,
    },
  );
};

export const useListHubNotesQuery = (
  threadId?: string,
  config?: UseQueryOptions<t.TListHubNotesResponse>,
): QueryObserverResult<t.TListHubNotesResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TListHubNotesResponse>(
    [QueryKeys.hubNotes, threadId ?? ''],
    () => dataService.listHubNotes(threadId),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};
