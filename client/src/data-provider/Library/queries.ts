import { useRecoilValue } from 'recoil';
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type t from 'librechat-data-provider';
import store from '~/store';

/** The person's saved documents, or matches for `q`. Text is not included: a list never needs it. */
export const useLibraryDocumentsQuery = (
  params: t.TLibraryListParams = {},
  config?: UseQueryOptions<t.TLibraryListResponse>,
): QueryObserverResult<t.TLibraryListResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TLibraryListResponse>(
    [
      QueryKeys.libraryDocuments,
      params.q ?? '',
      params.location ?? '',
      params.tag ?? '',
      params.folder ?? '',
      params.kind ?? '',
      params.sort ?? '',
      params.limit ?? null,
      params.skip ?? null,
    ],
    () => dataService.listLibraryDocuments(params),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

/** One document with its highlights and reading position. A book comes back as a listing of units. */
export const useLibraryDocumentQuery = (
  id: string | undefined,
  config?: UseQueryOptions<t.TLibraryDocumentResponse>,
): QueryObserverResult<t.TLibraryDocumentResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TLibraryDocumentResponse>(
    [QueryKeys.libraryDocument, id],
    () => dataService.getLibraryDocument(id as string),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled && id != null,
    },
  );
};

/** One chapter or page of a book, with the highlights made in it. */
export const useLibraryUnitQuery = (
  id: string | undefined,
  index: number | undefined,
  config?: UseQueryOptions<t.TLibraryUnitResponse>,
): QueryObserverResult<t.TLibraryUnitResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TLibraryUnitResponse>(
    [QueryKeys.libraryUnit, id, index],
    () => dataService.getLibraryUnit(id as string, index as number),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled && id != null && index != null,
    },
  );
};

/**
 * The stored original of a PDF. It can be large, so it is read only when a page is shown and is not
 * kept in the cache once nothing is showing it.
 */
export const useLibrarySourceQuery = (
  id: string | undefined,
  config?: UseQueryOptions<Blob>,
): QueryObserverResult<Blob> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<Blob>(
    [QueryKeys.librarySource, id],
    () => dataService.getLibrarySource(id as string),
    {
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      cacheTime: 0,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled && id != null,
    },
  );
};

/** The small picture shown beside a document in a list: fetched with the session, kept for a while. */
export const useLibraryThumbnailQuery = (
  id: string,
  path: string | undefined,
): QueryObserverResult<Blob> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<Blob>(
    [QueryKeys.libraryThumbnail, id, path],
    () => dataService.getLibraryResource(id, path as string),
    {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 10 * 60 * 1000,
      cacheTime: 10 * 60 * 1000,
      enabled: queriesEnabled && path != null,
    },
  );
};

/** The feeds this person follows. */
export const useLibraryFeedsQuery = (
  config?: UseQueryOptions<{ feeds: t.TLibraryFeed[] }>,
): QueryObserverResult<{ feeds: t.TLibraryFeed[] }> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<{ feeds: t.TLibraryFeed[] }>(
    [QueryKeys.libraryFeeds],
    () => dataService.listLibraryFeeds(),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

/** The views this person pinned: named sets of list filters. */
export const useLibraryViewsQuery = (
  config?: UseQueryOptions<{ views: t.TLibraryView[] }>,
): QueryObserverResult<{ views: t.TLibraryView[] }> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<{ views: t.TLibraryView[] }>(
    [QueryKeys.libraryViews],
    () => dataService.listLibraryViews(),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

/** The folders this person files documents into, with how many each holds. */
export const useLibraryFoldersQuery = (
  config?: UseQueryOptions<{ folders: t.TLibraryFolder[] }>,
): QueryObserverResult<{ folders: t.TLibraryFolder[] }> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<{ folders: t.TLibraryFolder[] }>(
    [QueryKeys.libraryFolders],
    () => dataService.listLibraryFolders(),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

/** How many documents the person has saved, for "N documents at your service". */
export const useLibraryCountQuery = (
  config?: UseQueryOptions<t.TLibraryCount>,
): QueryObserverResult<t.TLibraryCount> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TLibraryCount>([QueryKeys.libraryCount], () => dataService.getLibraryCount(), {
    refetchOnWindowFocus: false,
    ...config,
    enabled: (config?.enabled ?? true) === true && queriesEnabled,
  });
};

/**
 * Today's review of old highlights. It is read once and then worked through on screen, so it is
 * never refetched by itself: that would reshuffle the cards under the reader's eyes.
 */
export const useLibraryReviewQuery = (
  extra: number,
  config?: UseQueryOptions<t.TLibraryDailyReview>,
): QueryObserverResult<t.TLibraryDailyReview> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TLibraryDailyReview>(
    [QueryKeys.libraryReview, extra],
    () => dataService.getLibraryDailyReview(new Date().getTimezoneOffset(), extra),
    {
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      cacheTime: 0,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

/** Whether the person has a newsletter address, and since when. The secret itself is never returned. */
export const useLibraryInboxQuery = (
  config?: UseQueryOptions<{ inbox: t.TLibraryInbox }>,
): QueryObserverResult<{ inbox: t.TLibraryInbox }> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<{ inbox: t.TLibraryInbox }>(
    [QueryKeys.libraryInbox],
    () => dataService.getLibraryInbox(),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};
