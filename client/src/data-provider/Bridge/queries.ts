import { useRecoilValue } from 'recoil';
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type t from 'librechat-data-provider';
import store from '~/store';

/** How often the page asks again while it is open: an agent picks a task up within minutes. */
export const BRIDGE_REFRESH_MS = 20_000;

/** The agents' status and the task queue. Never kept: a stale queue would mislead. */
export const useBridgeOverviewQuery = (
  config?: UseQueryOptions<t.TBridgeOverview>,
): QueryObserverResult<t.TBridgeOverview> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBridgeOverview>(
    [QueryKeys.bridgeOverview],
    () => dataService.getBridgeOverview(),
    {
      refetchOnWindowFocus: true,
      refetchInterval: BRIDGE_REFRESH_MS,
      refetchIntervalInBackground: false,
      cacheTime: 0,
      retry: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

/** One result file, read when the person opens it. */
export const useBridgeResultQuery = (
  id: string | undefined,
  config?: UseQueryOptions<t.TBridgeResult>,
): QueryObserverResult<t.TBridgeResult> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBridgeResult>(
    [QueryKeys.bridgeResult, id],
    () => dataService.getBridgeResult(id as string),
    {
      refetchOnWindowFocus: false,
      cacheTime: 0,
      retry: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled && id != null,
    },
  );
};

/** The person's roles, their runs and today's usage. Polled while the page is open. */
export const useBridgeRolesQuery = (
  config?: UseQueryOptions<t.TBridgeRolesOverview>,
): QueryObserverResult<t.TBridgeRolesOverview> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBridgeRolesOverview>(
    [QueryKeys.bridgeRoles],
    () => dataService.getBridgeRoles(),
    {
      refetchOnWindowFocus: true,
      refetchInterval: BRIDGE_REFRESH_MS,
      refetchIntervalInBackground: false,
      cacheTime: 0,
      retry: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

/** What waits for a person's decision, and what was decided lately. A 404 means approvals are off. */
export const useBridgeApprovalsQuery = (
  config?: UseQueryOptions<t.TBridgeApprovalsOverview>,
): QueryObserverResult<t.TBridgeApprovalsOverview> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBridgeApprovalsOverview>(
    [QueryKeys.bridgeApprovals],
    () => dataService.getBridgeApprovals(),
    {
      refetchOnWindowFocus: true,
      /** An off feature answers 404 every time: stop asking until the page is focused again. */
      refetchInterval: (_data, query) => (query.state.error ? false : BRIDGE_REFRESH_MS),
      refetchIntervalInBackground: false,
      cacheTime: 0,
      retry: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

/** The ledger of what was proposed, decided and handed over; read when the person opens it. */
export const useBridgeAuditQuery = (
  config?: UseQueryOptions<{ lines: t.TBridgeAuditLine[] }>,
): QueryObserverResult<{ lines: t.TBridgeAuditLine[] }> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<{ lines: t.TBridgeAuditLine[] }>(
    [QueryKeys.bridgeAudit],
    () => dataService.getBridgeAudit(),
    {
      refetchOnWindowFocus: false,
      cacheTime: 0,
      retry: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};
