import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import type t from 'librechat-data-provider';

/** Saving, uploading or deleting changes what every list shows. */
function useRefreshLibraryLists() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries([QueryKeys.libraryDocuments]);
    // Filing and deleting change how many each folder holds.
    queryClient.invalidateQueries([QueryKeys.libraryFolders]);
  };
}

/** Saves a page by address, or from HTML the browser already holds. */
export const useSaveLibraryDocumentMutation = (
  options?: t.MutationOptions<t.TLibrarySaveResponse, t.TLibrarySaveRequest>,
): UseMutationResult<t.TLibrarySaveResponse, unknown, t.TLibrarySaveRequest, unknown> => {
  const refresh = useRefreshLibraryLists();
  const queryClient = useQueryClient();
  return useMutation((request: t.TLibrarySaveRequest) => dataService.saveLibraryDocument(request), {
    ...options,
    onSuccess: (data, variables, context) => {
      refresh();
      // A page saved again may have been re-read, so an open copy is stale.
      queryClient.invalidateQueries([QueryKeys.libraryDocument, data.document.id]);
      queryClient.invalidateQueries([QueryKeys.libraryUnit, data.document.id]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const useUploadLibraryFileMutation = (
  options?: t.MutationOptions<t.TLibrarySaveResponse, FormData>,
): UseMutationResult<t.TLibrarySaveResponse, unknown, FormData, unknown> => {
  const refresh = useRefreshLibraryLists();
  return useMutation((form: FormData) => dataService.uploadLibraryFile(form), {
    ...options,
    onSuccess: (data, variables, context) => {
      refresh();
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export type UpdateLibraryDocumentVariables = {
  id: string;
  patch: t.TLibraryDocumentPatch;
};

export const useUpdateLibraryDocumentMutation = (
  options?: t.MutationOptions<
    { document: t.TLibraryDocumentSummary },
    UpdateLibraryDocumentVariables
  >,
): UseMutationResult<
  { document: t.TLibraryDocumentSummary },
  unknown,
  UpdateLibraryDocumentVariables,
  unknown
> => {
  const refresh = useRefreshLibraryLists();
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, patch }: UpdateLibraryDocumentVariables) => dataService.updateLibraryDocument(id, patch),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        refresh();
        queryClient.invalidateQueries([QueryKeys.libraryDocument, variables.id]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useDeleteLibraryDocumentMutation = (
  options?: t.MutationOptions<void, { id: string }>,
): UseMutationResult<void, unknown, { id: string }, unknown> => {
  const refresh = useRefreshLibraryLists();
  const queryClient = useQueryClient();
  return useMutation(({ id }: { id: string }) => dataService.deleteLibraryDocument(id), {
    ...options,
    onSuccess: (data, variables, context) => {
      refresh();
      queryClient.removeQueries([QueryKeys.libraryDocument, variables.id]);
      queryClient.removeQueries([QueryKeys.libraryUnit, variables.id]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export type BulkLibraryResult = { done: number; failed: number };

/** How many of a batch of requests went through; one failing never stops the rest. */
async function settleAll(requests: Promise<unknown>[]): Promise<BulkLibraryResult> {
  const results = await Promise.allSettled(requests);
  const failed = results.filter((result) => result.status === 'rejected').length;
  return { done: results.length - failed, failed };
}

/** Moves or files several documents at once, then refreshes the lists a single time. */
export const useBulkUpdateLibraryDocumentsMutation = (
  options?: t.MutationOptions<
    BulkLibraryResult,
    { ids: string[] } & UpdateLibraryDocumentVariables['patch']
  >,
): UseMutationResult<
  BulkLibraryResult,
  unknown,
  { ids: string[] } & UpdateLibraryDocumentVariables['patch'],
  unknown
> => {
  const refresh = useRefreshLibraryLists();
  const queryClient = useQueryClient();
  return useMutation(
    ({ ids, ...patch }: { ids: string[] } & UpdateLibraryDocumentVariables['patch']) =>
      settleAll(ids.map((id) => dataService.updateLibraryDocument(id, patch))),
    {
      ...options,
      onSettled: (data, error, variables, context) => {
        refresh();
        variables.ids.forEach((id) =>
          queryClient.invalidateQueries([QueryKeys.libraryDocument, id]),
        );
        options?.onSettled?.(data, error, variables, context);
      },
    },
  );
};

export const useBulkDeleteLibraryDocumentsMutation = (
  options?: t.MutationOptions<BulkLibraryResult, { ids: string[] }>,
): UseMutationResult<BulkLibraryResult, unknown, { ids: string[] }, unknown> => {
  const refresh = useRefreshLibraryLists();
  const queryClient = useQueryClient();
  return useMutation(
    ({ ids }: { ids: string[] }) =>
      settleAll(ids.map((id) => dataService.deleteLibraryDocument(id))),
    {
      ...options,
      onSettled: (data, error, variables, context) => {
        refresh();
        variables.ids.forEach((id) => {
          queryClient.removeQueries([QueryKeys.libraryDocument, id]);
          queryClient.removeQueries([QueryKeys.libraryUnit, id]);
        });
        options?.onSettled?.(data, error, variables, context);
      },
    },
  );
};

/** Going through the review is a quiet write: the cards on screen already moved on. */
export const useReviewLibraryHighlightMutation = (): UseMutationResult<
  void,
  unknown,
  { id: string; action: t.TLibraryReviewAction },
  unknown
> =>
  useMutation(({ id, action }: { id: string; action: t.TLibraryReviewAction }) =>
    dataService.reviewLibraryHighlight(id, action),
  );

/** Opens a new chat that starts from a document; the document itself is untouched. */
export const useStartLibraryChatMutation = (
  options?: t.MutationOptions<t.TLibraryChatResponse, { id: string } & t.TLibraryChatRequest>,
): UseMutationResult<
  t.TLibraryChatResponse,
  unknown,
  { id: string } & t.TLibraryChatRequest,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, ...request }: { id: string } & t.TLibraryChatRequest) =>
      dataService.startLibraryChat(id, request),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.allConversations]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

/** Makes the newsletter address, or replaces it; the new secret comes back once. */
export const useRotateLibraryInboxMutation = (
  options?: t.MutationOptions<t.TLibraryInboxCreated, void>,
): UseMutationResult<t.TLibraryInboxCreated, unknown, void, unknown> => {
  const queryClient = useQueryClient();
  return useMutation(() => dataService.rotateLibraryInbox(), {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.libraryInbox]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const useDeleteLibraryInboxMutation = (
  options?: t.MutationOptions<void, void>,
): UseMutationResult<void, unknown, void, unknown> => {
  const queryClient = useQueryClient();
  return useMutation(() => dataService.deleteLibraryInbox(), {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.libraryInbox]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const usePreviewLibraryFeedMutation = (
  options?: t.MutationOptions<{ feed: t.TLibraryFeedPreview }, string>,
): UseMutationResult<{ feed: t.TLibraryFeedPreview }, unknown, string, unknown> =>
  useMutation((url: string) => dataService.previewLibraryFeed(url), options);

/** The reading position is a quiet write: nothing refetches because of it. */
export const useSetLibraryProgressMutation = (): UseMutationResult<
  { progress: t.TLibraryProgress },
  unknown,
  { id: string; textOffset: number; unitIndex?: number },
  unknown
> =>
  useMutation(({ id, ...body }: { id: string; textOffset: number; unitIndex?: number }) =>
    dataService.setLibraryProgress(id, body),
  );

/** A highlight belongs to the open document or unit, so only that one is refreshed. */
function useRefreshHighlights() {
  const queryClient = useQueryClient();
  return (documentId: string) => {
    queryClient.invalidateQueries([QueryKeys.libraryDocument, documentId]);
    queryClient.invalidateQueries([QueryKeys.libraryUnit, documentId]);
  };
}

export const useCreateLibraryHighlightMutation = (
  options?: t.MutationOptions<{ highlight: t.TLibraryHighlight }, t.TLibraryCreateHighlight>,
): UseMutationResult<
  { highlight: t.TLibraryHighlight },
  unknown,
  t.TLibraryCreateHighlight,
  unknown
> => {
  const refresh = useRefreshHighlights();
  return useMutation(
    (data: t.TLibraryCreateHighlight) => dataService.createLibraryHighlight(data),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        refresh(variables.documentId);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export type UpdateLibraryHighlightVariables = {
  id: string;
  documentId: string;
  patch: t.TLibraryPatchHighlight;
};

export const useUpdateLibraryHighlightMutation = (
  options?: t.MutationOptions<{ highlight: t.TLibraryHighlight }, UpdateLibraryHighlightVariables>,
): UseMutationResult<
  { highlight: t.TLibraryHighlight },
  unknown,
  UpdateLibraryHighlightVariables,
  unknown
> => {
  const refresh = useRefreshHighlights();
  return useMutation(
    ({ id, patch }: UpdateLibraryHighlightVariables) =>
      dataService.updateLibraryHighlight(id, patch),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        refresh(variables.documentId);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export type DeleteLibraryHighlightVariables = { id: string; documentId: string };

export const useDeleteLibraryHighlightMutation = (
  options?: t.MutationOptions<void, DeleteLibraryHighlightVariables>,
): UseMutationResult<void, unknown, DeleteLibraryHighlightVariables, unknown> => {
  const refresh = useRefreshHighlights();
  return useMutation(
    ({ id }: DeleteLibraryHighlightVariables) => dataService.deleteLibraryHighlight(id),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        refresh(variables.documentId);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

/** Following a feed, or checking one, saves items to the Feed tab and updates the feed's own row. */
function useRefreshLibraryFeeds() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries([QueryKeys.libraryDocuments]);
    queryClient.invalidateQueries([QueryKeys.libraryFeeds]);
  };
}

export const useFollowLibraryFeedMutation = (
  options?: t.MutationOptions<t.TLibraryFollowResponse, string>,
): UseMutationResult<t.TLibraryFollowResponse, unknown, string, unknown> => {
  const refresh = useRefreshLibraryFeeds();
  return useMutation((url: string) => dataService.followLibraryFeed(url), {
    ...options,
    onSuccess: (data, variables, context) => {
      refresh();
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const useRefreshLibraryFeedMutation = (
  options?: t.MutationOptions<{ refresh: t.TLibraryFeedRefresh }, string>,
): UseMutationResult<{ refresh: t.TLibraryFeedRefresh }, unknown, string, unknown> => {
  const refresh = useRefreshLibraryFeeds();
  return useMutation((id: string) => dataService.refreshLibraryFeed(id), {
    ...options,
    onSuccess: (data, variables, context) => {
      refresh();
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const useUnfollowLibraryFeedMutation = (
  options?: t.MutationOptions<void, string>,
): UseMutationResult<void, unknown, string, unknown> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.unfollowLibraryFeed(id), {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.libraryFeeds]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

/** Drops the stored original of a PDF; its text, pages and highlights stay. */
export const useDeleteLibrarySourceMutation = (
  options?: t.MutationOptions<void, { id: string }>,
): UseMutationResult<void, unknown, { id: string }, unknown> => {
  const refresh = useRefreshLibraryLists();
  const queryClient = useQueryClient();
  return useMutation(({ id }: { id: string }) => dataService.deleteLibrarySource(id), {
    ...options,
    onSuccess: (data, variables, context) => {
      refresh();
      queryClient.removeQueries([QueryKeys.librarySource, variables.id]);
      queryClient.invalidateQueries([QueryKeys.libraryDocument, variables.id]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const useCreateLibraryViewMutation = (
  options?: t.MutationOptions<
    { view: t.TLibraryView },
    { name: string; filter: t.TLibraryViewFilter }
  >,
): UseMutationResult<
  { view: t.TLibraryView },
  unknown,
  { name: string; filter: t.TLibraryViewFilter },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ name, filter }: { name: string; filter: t.TLibraryViewFilter }) =>
      dataService.createLibraryView(name, filter),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.libraryViews]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useRenameLibraryViewMutation = (
  options?: t.MutationOptions<{ view: t.TLibraryView }, { id: string; name: string }>,
): UseMutationResult<{ view: t.TLibraryView }, unknown, { id: string; name: string }, unknown> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, name }: { id: string; name: string }) => dataService.renameLibraryView(id, name),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.libraryViews]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useDeleteLibraryViewMutation = (
  options?: t.MutationOptions<void, { id: string }>,
): UseMutationResult<void, unknown, { id: string }, unknown> => {
  const queryClient = useQueryClient();
  return useMutation(({ id }: { id: string }) => dataService.deleteLibraryView(id), {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.libraryViews]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const useCreateLibraryFolderMutation = (
  options?: t.MutationOptions<{ folder: t.TLibraryFolder }, string>,
): UseMutationResult<{ folder: t.TLibraryFolder }, unknown, string, unknown> => {
  const queryClient = useQueryClient();
  return useMutation((name: string) => dataService.createLibraryFolder(name), {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.libraryFolders]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const useRenameLibraryFolderMutation = (
  options?: t.MutationOptions<{ folder: t.TLibraryFolder }, { id: string; name: string }>,
): UseMutationResult<
  { folder: t.TLibraryFolder },
  unknown,
  { id: string; name: string },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, name }: { id: string; name: string }) => dataService.renameLibraryFolder(id, name),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.libraryFolders]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

/** Deleting a folder keeps its documents, which are then in no folder. */
export const useDeleteLibraryFolderMutation = (
  options?: t.MutationOptions<void, { id: string }>,
): UseMutationResult<void, unknown, { id: string }, unknown> => {
  const queryClient = useQueryClient();
  return useMutation(({ id }: { id: string }) => dataService.deleteLibraryFolder(id), {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.libraryFolders]);
      queryClient.invalidateQueries([QueryKeys.libraryDocuments]);
      // The server drops the views of a folder that is gone.
      queryClient.invalidateQueries([QueryKeys.libraryViews]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

/** Text read by OCR from one scanned page. The page's text, and the document's, change with it. */
export const useSaveLibraryUnitTextMutation = (
  options?: t.MutationOptions<
    { unit: t.TLibraryUnit; needsOcr: boolean },
    { id: string; index: number; text: string }
  >,
): UseMutationResult<
  { unit: t.TLibraryUnit; needsOcr: boolean },
  unknown,
  { id: string; index: number; text: string },
  unknown
> => {
  const refresh = useRefreshLibraryLists();
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, index, text }: { id: string; index: number; text: string }) =>
      dataService.saveLibraryUnitText(id, index, text),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        refresh();
        queryClient.invalidateQueries([QueryKeys.libraryUnit, variables.id, variables.index]);
        queryClient.invalidateQueries([QueryKeys.libraryDocument, variables.id]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

/** Fetches the export with the person's session and hands it to the browser as a download. */
export const useExportLibraryHighlightsMutation = (
  options?: t.MutationOptions<
    { blob: Blob; filename: string },
    { format: 'markdown' | 'csv'; documentId?: string }
  >,
): UseMutationResult<
  { blob: Blob; filename: string },
  unknown,
  { format: 'markdown' | 'csv'; documentId?: string },
  unknown
> =>
  useMutation(
    ({ format, documentId }: { format: 'markdown' | 'csv'; documentId?: string }) =>
      dataService.exportLibraryHighlights(format, documentId),
    options,
  );
