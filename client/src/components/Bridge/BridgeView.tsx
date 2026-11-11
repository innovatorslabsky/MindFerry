import { useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { useBridgeOverviewQuery } from '~/data-provider';
import DashboardsPanel from './DashboardsPanel';
import ResultDialog from './ResultDialog';
import RolesPanel from './RolesPanel';
import { bridgeErrorKey } from './errors';
import NewTaskForm from './NewTaskForm';
import AgentCards from './AgentCards';
import { useLocalize } from '~/hooks';
import TaskList from './TaskList';

/** The agents that share a task folder with this server: how they are, what is queued, what came back. */
export default function BridgeView() {
  const localize = useLocalize();
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch, isFetching } = useBridgeOverviewQuery();

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6"
      data-testid="bridge-view"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-text-primary text-xl font-semibold">{localize('com_bridge_title')}</h1>
        <p className="text-text-secondary text-sm">{localize('com_bridge_subtitle')}</p>
      </header>

      {isLoading && (
        <div
          className="flex justify-center py-10"
          role="status"
          aria-label={localize('com_ui_loading')}
        >
          <Spinner />
        </div>
      )}

      {isError && (
        <div
          role="alert"
          className="border-border-light bg-surface-primary flex flex-col items-start gap-3 rounded-xl border p-4"
          data-testid="bridge-error"
        >
          <p className="text-text-primary text-sm">
            {localize(bridgeErrorKey(error, 'com_bridge_error_load'))}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            {isFetching && <Spinner className="mr-1.5 h-4 w-4" />}
            {localize('com_ui_retry')}
          </Button>
        </div>
      )}

      {data && (
        <>
          <AgentCards status={data.status} />
          <RolesPanel maxTaskChars={data.limits.maxTaskChars} />
          <NewTaskForm
            maxTaskChars={data.limits.maxTaskChars}
            maxFieldChars={data.limits.maxFieldChars}
          />
          <TaskList tasks={data.tasks} truncated={data.truncated} onOpen={setOpenId} />
          <DashboardsPanel dashboards={data.dashboards} tunnelCommand={data.tunnelCommand} />
        </>
      )}

      <ResultDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
