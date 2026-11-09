import { Button, EmptyState } from '@librechat/client';
import { CheckCircle2, CircleAlert, Clock, Inbox, Loader2, Archive } from 'lucide-react';
import type { TBridgeTask, TBridgeTaskState } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';
import { whenLabel } from './format';

const STATE: Record<TBridgeTaskState, { key: TranslationKeys; icon: LucideIcon }> = {
  queued: { key: 'com_bridge_state_queued', icon: Clock },
  running: { key: 'com_bridge_state_running', icon: Loader2 },
  done: { key: 'com_bridge_state_done', icon: CheckCircle2 },
  failed: { key: 'com_bridge_state_failed', icon: CircleAlert },
  archived: { key: 'com_bridge_state_archived', icon: Archive },
};

const PRIORITY: Record<NonNullable<TBridgeTask['priority']>, TranslationKeys> = {
  low: 'com_bridge_priority_low',
  normal: 'com_bridge_priority_normal',
  high: 'com_bridge_priority_high',
};

const AGENT_NAMES: Record<TBridgeTask['to'], string> = { hermes: 'Hermes', openclaw: 'OpenClaw' };

function TaskRow({ task, onOpen }: { task: TBridgeTask; onOpen: (id: string) => void }) {
  const localize = useLocalize();
  const state = STATE[task.state];
  const StateIcon = state.icon;
  const created = whenLabel(task.created);

  return (
    <li
      className="border-border-light bg-surface-primary flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`bridge-task-${task.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-sm break-words">
          {task.summary || localize('com_bridge_no_summary')}
        </p>
        <p className="text-text-secondary mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="flex items-center gap-1" data-testid="bridge-task-state">
            <StateIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {localize(state.key)}
          </span>
          <span>{localize('com_bridge_for', { 0: AGENT_NAMES[task.to] })}</span>
          {task.priority && <span>{localize(PRIORITY[task.priority])}</span>}
          {created && <span>{created}</span>}
        </p>
      </div>
      {task.hasResult ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpen(task.id)}
          aria-label={localize('com_bridge_view_result_for', { 0: task.summary || task.id })}
          data-testid={`bridge-open-${task.id}`}
        >
          {localize('com_bridge_view_result')}
        </Button>
      ) : (
        <span className="text-text-tertiary text-xs">{localize('com_bridge_no_result')}</span>
      )}
    </li>
  );
}

/** The newest tasks across inbox, processing and archive, with a way into each result. */
export default function TaskList({
  tasks,
  truncated,
  onOpen,
}: {
  tasks: TBridgeTask[];
  truncated: boolean;
  onOpen: (id: string) => void;
}) {
  const localize = useLocalize();
  return (
    <section aria-labelledby="bridge-tasks-heading" className="flex flex-col gap-3">
      <h2 id="bridge-tasks-heading" className="text-text-primary text-lg font-semibold">
        {localize('com_bridge_tasks')}
      </h2>
      {tasks.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={localize('com_bridge_tasks_empty')}
          description={localize('com_bridge_tasks_empty_hint')}
        />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="bridge-task-list">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {truncated && (
        <p className="text-text-tertiary text-xs" data-testid="bridge-truncated">
          {localize('com_bridge_tasks_truncated')}
        </p>
      )}
    </section>
  );
}
