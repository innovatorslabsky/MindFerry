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

type RoleMutationOptions<TData, TVars> = t.MutationOptions<TData, TVars>;

/** Runs a roles mutation, then refreshes the roles list whether it worked or was refused. */
function useRolesMutation<TData, TVars>(
  key: MutationKeys,
  run: (vars: TVars) => Promise<TData>,
  options?: RoleMutationOptions<TData, TVars>,
): UseMutationResult<TData, unknown, TVars, unknown> {
  const queryClient = useQueryClient();
  return useMutation(run, {
    mutationKey: [key],
    ...options,
    onSettled: (data, error, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.bridgeRoles]);
      options?.onSettled?.(data, error, variables, context);
    },
  });
}

export const useCreateBridgeRoleMutation = (
  options?: RoleMutationOptions<t.TBridgeRole, t.TBridgeRoleInput>,
) =>
  useRolesMutation(
    MutationKeys.createBridgeRole,
    (body: t.TBridgeRoleInput) => dataService.createBridgeRole(body),
    options,
  );

export const useUpdateBridgeRoleMutation = (
  options?: RoleMutationOptions<t.TBridgeRole, { id: string; patch: t.TBridgeRolePatch }>,
) =>
  useRolesMutation(
    MutationKeys.updateBridgeRole,
    ({ id, patch }: { id: string; patch: t.TBridgeRolePatch }) =>
      dataService.updateBridgeRole(id, patch),
    options,
  );

export const useDeleteBridgeRoleMutation = (options?: RoleMutationOptions<void, string>) =>
  useRolesMutation(
    MutationKeys.deleteBridgeRole,
    (id: string) => dataService.deleteBridgeRole(id),
    options,
  );

export const useAssignBridgeRoleMutation = (
  options?: RoleMutationOptions<
    t.TBridgeAssignResponse,
    { id: string; body: t.TBridgeAssignRequest }
  >,
) =>
  useRolesMutation(
    MutationKeys.assignBridgeRole,
    ({ id, body }: { id: string; body: t.TBridgeAssignRequest }) =>
      dataService.assignBridgeRole(id, body),
    options,
  );
