import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, useToastContext } from '@librechat/client';
import type { TBridgeRole, TBridgeRolesOverview, TBridgeRun } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useBridgeRolesQuery, useUpdateBridgeRoleMutation } from '~/data-provider';
import { bridgeErrorCode, bridgeErrorKey } from './errors';
import { NotificationSeverity } from '~/common';
import AddRoleDialog from './AddRoleDialog';
import AssignDialog from './AssignDialog';
import { useLocalize } from '~/hooks';
import { whenLabel } from './format';

const RUN_LABEL: Record<TBridgeRun['status'], TranslationKeys> = {
  queued: 'com_bridge_run_queued',
  running: 'com_bridge_run_running',
  done: 'com_bridge_run_done',
  failed: 'com_bridge_run_failed',
  paused: 'com_bridge_run_paused',
  unknown: 'com_bridge_run_unknown',
};

function RunRow({ run }: { run: TBridgeRun }) {
  const localize = useLocalize();
  return (
    <li
      className="border-border-light flex flex-col gap-1 border-b py-2 last:border-b-0"
      data-testid="bridge-run"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-text-primary text-sm">{run.summary}</span>
        <span
          className="text-text-secondary text-xs"
          data-testid="bridge-run-status"
          data-status={run.status}
        >
          {localize(RUN_LABEL[run.status])}
        </span>
      </div>
      <div className="text-text-tertiary flex flex-wrap items-center gap-x-3 text-xs">
        <span>{run.roleSlug}</span>
        <span>{whenLabel(run.createdAt)}</span>
        {!run.counted && <span>{localize('com_bridge_run_not_counted')}</span>}
        {run.status === 'paused' && (
          <span className="text-text-primary" data-testid="bridge-run-approval">
            {localize('com_bridge_run_needs_approval')}
          </span>
        )}
        {run.error && <span>{localize('com_bridge_run_error', { 0: run.error })}</span>}
        <Link
          to={`/c/${encodeURIComponent(run.conversationId)}`}
          className="text-text-primary underline"
        >
          {localize('com_bridge_run_open')}
        </Link>
      </div>
    </li>
  );
}

function RoleCard({
  role,
  usage,
  onAssign,
}: {
  role: TBridgeRole;
  usage?: { used: number; cap: number };
  onAssign: (role: TBridgeRole) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const update = useUpdateBridgeRoleMutation({
    onError: (error) =>
      showToast({
        message: localize(bridgeErrorKey(error, 'com_bridge_roles_error_save')),
        status: NotificationSeverity.ERROR,
      }),
  });
  const locked = role.runtime !== 'app';

  return (
    <li
      className="border-border-light bg-surface-primary flex flex-col gap-2 rounded-xl border p-4"
      data-testid="bridge-role"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-text-primary text-sm font-semibold">{role.name}</h3>
        <span className="text-text-secondary text-xs">
          {role.tier === 0
            ? localize('com_bridge_roles_tier0')
            : localize('com_bridge_roles_tier1')}
        </span>
      </div>
      {role.description && <p className="text-text-secondary text-sm">{role.description}</p>}
      <div className="text-text-tertiary flex flex-wrap gap-x-3 text-xs">
        {!role.enabled && <span>{localize('com_bridge_roles_off')}</span>}
        {locked && <span>{localize('com_bridge_roles_locked')}</span>}
        {usage && (
          <span data-testid="bridge-role-usage">
            {localize('com_bridge_roles_used', { 0: usage.used, 1: usage.cap })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!role.enabled || locked}
          onClick={() => onAssign(role)}
        >
          {localize('com_bridge_roles_assign')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={update.isLoading}
          onClick={() => update.mutate({ id: role.id, patch: { enabled: !role.enabled } })}
        >
          {role.enabled
            ? localize('com_bridge_roles_turn_off')
            : localize('com_bridge_roles_turn_on')}
        </Button>
      </div>
    </li>
  );
}

function Loaded({ data, maxTaskChars }: { data: TBridgeRolesOverview; maxTaskChars: number }) {
  const localize = useLocalize();
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState<TBridgeRole | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-text-primary text-base font-semibold">
            {localize('com_bridge_roles_title')}
          </h2>
          <p className="text-text-secondary text-sm" data-testid="bridge-team-usage">
            {localize('com_bridge_roles_team_used', {
              0: data.usage.team.used,
              1: data.usage.team.cap,
            })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={data.roles.length >= data.limits.maxRoles}
          onClick={() => setAdding(true)}
        >
          {localize('com_bridge_roles_add')}
        </Button>
      </div>

      {data.roles.length === 0 ? (
        <p className="text-text-secondary text-sm" data-testid="bridge-roles-empty">
          {localize('com_bridge_roles_empty')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              usage={data.usage.byRole[role.id]}
              onAssign={setAssigning}
            />
          ))}
        </ul>
      )}

      {data.runs.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-text-primary text-sm font-semibold">
            {localize('com_bridge_roles_runs')}
          </h3>
          <ul>
            {data.runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        </div>
      )}

      <AddRoleDialog
        open={adding}
        onClose={() => setAdding(false)}
        templates={data.templates}
        maxBriefChars={data.limits.maxBriefChars}
      />
      <AssignDialog
        role={assigning}
        maxTaskChars={maxTaskChars}
        onClose={() => setAssigning(null)}
      />
    </>
  );
}

/**
 * Named roles that run as in-app agents. The section stays out of sight when the operator has not
 * turned roles on; any other failure is said, with a way to try again.
 */
export default function RolesPanel({ maxTaskChars }: { maxTaskChars: number }) {
  const localize = useLocalize();
  const { data, isError, error, refetch } = useBridgeRolesQuery();

  if (isError && bridgeErrorCode(error) === 'BRIDGE_DISABLED') {
    return null;
  }
  return (
    <section className="flex flex-col gap-4" data-testid="bridge-roles">
      {isError && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-text-primary text-sm">
            {localize(bridgeErrorKey(error, 'com_bridge_roles_error_load'))}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            {localize('com_ui_retry')}
          </Button>
        </div>
      )}
      {data && <Loaded data={data} maxTaskChars={maxTaskChars} />}
    </section>
  );
}
