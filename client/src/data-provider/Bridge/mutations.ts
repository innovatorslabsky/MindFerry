import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type t from 'librechat-data-provider';

/** Previews a task file or writes it into the agents' inbox. Only a written task changes the queue. */
export const useCreateBridgeTaskMutation = (
  options?: t.MutationOptions<t.TBridgeCreateResponse, t.TBridgeCreateRequest>,
): UseMutationResult<t.TBridgeCreateResponse, unknown, t.TBridgeCreateRequest, unknown> => {
  const queryClient = useQueryClient();
  return useMutation((body: t.TBridgeCreateRequest) => dataService.createBridgeTask(body), {
    mutationKey: [MutationKeys.createBridgeTask],
    ...options,
    onSuccess: (data, variables, context) => {
      if (data.created) {
        queryClient.invalidateQueries([QueryKeys.bridgeOverview]);
      }
      options?.onSuccess?.(data, variables, context);
    },
  });
};
