import { AlertTriangle, CheckCircle2, CircleHelp, CirclePause, CircleStop } from 'lucide-react';
import type {
  TBridgeAgentStatus,
  TBridgeErrorKind,
  TBridgeJobState,
  TBridgeStatus,
} from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';
import { whenLabel } from './format';

const AGENT_NAMES: Record<TBridgeAgentStatus['agent'], string> = {
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
};

const HEALTH: Record<TBridgeAgentStatus['health'], { key: TranslationKeys; icon: LucideIcon }> = {
  up: { key: 'com_bridge_health_up', icon: CheckCircle2 },
  down: { key: 'com_bridge_health_down', icon: CircleStop },
  unknown: { key: 'com_bridge_health_unknown', icon: CircleHelp },
};

const JOB: Record<TBridgeJobState, { key: TranslationKeys; icon: LucideIcon }> = {
  ok: { key: 'com_bridge_job_ok', icon: CheckCircle2 },
  error: { key: 'com_bridge_job_error', icon: AlertTriangle },
  disabled: { key: 'com_bridge_job_disabled', icon: CirclePause },
  unknown: { key: 'com_bridge_job_unknown', icon: CircleHelp },
};

const REASON: Record<TBridgeErrorKind, TranslationKeys> = {
  billing: 'com_bridge_reason_billing',
  auth: 'com_bridge_reason_auth',
  timeout: 'com_bridge_reason_timeout',
  other: 'com_bridge_reason_other',
};

function AgentCard({ agent }: { agent: TBridgeAgentStatus }) {
  const localize = useLocalize();
  const health = HEALTH[agent.health];
  const job = JOB[agent.job.state];
  const HealthIcon = health.icon;
  const JobIcon = job.icon;
  const started = whenLabel(agent.startedAt);
  const lastRun = whenLabel(agent.job.lastRunAt);
  const problem = agent.job.state === 'error' || agent.job.state === 'disabled';

  return (
    <li
      className="border-border-light bg-surface-primary flex flex-col gap-3 rounded-xl border p-4"
      data-testid={`bridge-agent-${agent.agent}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-text-primary text-base font-semibold">{AGENT_NAMES[agent.agent]}</h3>
        <span className="text-text-secondary flex items-center gap-1.5 text-sm">
          <HealthIcon className="h-4 w-4" aria-hidden="true" />
          <span data-testid={`bridge-health-${agent.agent}`}>{localize(health.key)}</span>
        </span>
      </div>

      <div className="text-text-secondary grid gap-1 text-xs">
        {agent.version && <p>{localize('com_bridge_version', { 0: agent.version })}</p>}
        {started && <p>{localize('com_bridge_started', { 0: started })}</p>}
      </div>

      <div
        className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-sm ${
          problem ? 'border-border-medium bg-surface-secondary border' : 'bg-surface-secondary'
        }`}
      >
        <span className="text-text-primary flex items-center gap-1.5 font-medium">
          <JobIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span data-testid={`bridge-job-${agent.agent}`}>{localize(job.key)}</span>
        </span>
        {agent.job.errorKind && problem && (
          <span
            className="text-text-secondary text-xs"
            data-testid={`bridge-reason-${agent.agent}`}
          >
            {localize(REASON[agent.job.errorKind])}
          </span>
        )}
        {agent.job.consecutiveErrors != null && agent.job.consecutiveErrors > 0 && (
          <span className="text-text-secondary text-xs">
            {localize('com_bridge_streak', { 0: agent.job.consecutiveErrors })}
          </span>
        )}
        {lastRun && (
          <span className="text-text-secondary text-xs">
            {localize('com_bridge_last_run', { 0: lastRun })}
          </span>
        )}
      </div>
    </li>
  );
}

/** Whether each agent is running and whether its task poll is actually working. */
export default function AgentCards({ status }: { status: TBridgeStatus }) {
  const localize = useLocalize();
  const updated = whenLabel(status.generatedAt);
  return (
    <section aria-labelledby="bridge-agents-heading" className="flex flex-col gap-3">
      <h2 id="bridge-agents-heading" className="text-text-primary text-lg font-semibold">
        {localize('com_bridge_agents')}
      </h2>
      {status.stale && (
        <p
          role="status"
          className="text-text-secondary bg-surface-secondary rounded-lg px-3 py-2 text-xs"
          data-testid="bridge-stale"
        >
          {localize('com_bridge_stale')}
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {status.agents.map((agent) => (
          <AgentCard key={agent.agent} agent={agent} />
        ))}
      </ul>
      {updated && !status.stale && (
        <p className="text-text-tertiary text-xs">
          {localize('com_bridge_updated', { 0: updated })}
        </p>
      )}
    </section>
  );
}
