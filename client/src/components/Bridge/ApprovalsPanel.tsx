import { useState } from 'react';
import { Button } from '@librechat/client';
import type { TBridgeProposal } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { approvalErrorKey, bridgeCauseKey, bridgeErrorCause, bridgeErrorCode } from './errors';
import { useBridgeApprovalsQuery, useDecideBridgeProposalMutation } from '~/data-provider';
import AuditDialog from './AuditDialog';
import { useLocalize } from '~/hooks';
import { whenLabel } from './format';

const RECENT_SHOWN = 8;

/** Approved, but the hand-over did not happen: the person can try again. */
const needsStart = (proposal: TBridgeProposal): boolean =>
  proposal.status === 'approved' && !proposal.runId;

function ProposalCard({
  proposal,
  onOpenResult,
}: {
  proposal: TBridgeProposal;
  onOpenResult?: (taskId: string) => void;
}) {
  const localize = useLocalize();
  const [problem, setProblem] = useState<string>();
  const decide = useDecideBridgeProposalMutation({
    onMutate: () => setProblem(undefined),
    onError: (error) => {
      const key = approvalErrorKey(error, 'com_bridge_approvals_error_decide');
      const cause =
        bridgeErrorCode(error) === 'APPROVAL_HANDOVER_FAILED' ? bridgeErrorCause(error) : undefined;
      const causeKey = cause ? bridgeCauseKey(cause) : undefined;
      setProblem(causeKey ? `${localize(key)} ${localize(causeKey)}` : localize(key));
    },
  });
  const retry = needsStart(proposal);

  return (
    <li
      className="border-border-light bg-surface-primary flex flex-col gap-3 rounded-xl border p-4"
      data-testid="bridge-proposal"
      data-status={proposal.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-text-primary text-sm font-semibold">
          {localize('com_bridge_approvals_for', { 0: proposal.roleSlug })}
        </span>
        <span className="text-text-secondary text-xs" data-testid="bridge-proposal-source">
          {proposal.source === 'result'
            ? localize('com_bridge_approvals_source_result')
            : localize('com_bridge_approvals_source_person')}
        </span>
      </div>
      <pre
        className="border-border-light bg-surface-secondary text-text-primary max-h-60 overflow-y-auto rounded-lg border p-3 font-sans text-sm break-words whitespace-pre-wrap"
        data-testid="bridge-proposal-content"
      >
        {proposal.content}
      </pre>
      <div className="text-text-tertiary flex flex-wrap items-center gap-x-3 text-xs">
        <span>
          {localize('com_bridge_approvals_expires', { 0: whenLabel(proposal.expiresAt) })}
        </span>
        <span className="font-mono" data-testid="bridge-proposal-check">
          {localize('com_bridge_approvals_check', { 0: proposal.hash.slice(0, 8) })}
        </span>
        {proposal.originTaskId && onOpenResult && (
          <button
            type="button"
            className="text-text-primary underline"
            onClick={() => onOpenResult(proposal.originTaskId as string)}
            data-testid="bridge-proposal-source-link"
          >
            {localize('com_bridge_approvals_open_source')}
          </button>
        )}
      </div>
      {retry && (
        <p className="text-text-primary text-sm" data-testid="bridge-proposal-waiting">
          {localize('com_bridge_approvals_approved_waiting')}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-text-primary text-sm" data-testid="bridge-proposal-error">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={decide.isLoading}
          aria-label={localize(
            retry ? 'com_bridge_approvals_retry_for' : 'com_bridge_approvals_approve_for',
            { 0: proposal.title },
          )}
          onClick={() =>
            decide.mutate({ id: proposal.id, body: { decision: 'approve', hash: proposal.hash } })
          }
        >
          {retry
            ? localize('com_bridge_approvals_retry')
            : localize('com_bridge_approvals_approve')}
        </Button>
        {!retry && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={decide.isLoading}
            aria-label={localize('com_bridge_approvals_deny_for', { 0: proposal.title })}
            onClick={() => decide.mutate({ id: proposal.id, body: { decision: 'deny' } })}
          >
            {localize('com_bridge_approvals_deny')}
          </Button>
        )}
      </div>
    </li>
  );
}

const DECIDED_LABEL: Record<string, TranslationKeys> = {
  approved: 'com_bridge_approvals_started',
  denied: 'com_bridge_approvals_denied',
  expired: 'com_bridge_approvals_expired',
};

/**
 * Work that waits for a decision. Nothing here starts by itself: each item shows the exact text and
 * the role it is for, and an approval starts it exactly as shown. The section stays out of sight when
 * the operator has not turned approvals on; any other failure is said, with a way to try again.
 */
export default function ApprovalsPanel({
  onOpenResult,
}: {
  onOpenResult?: (taskId: string) => void;
}) {
  const localize = useLocalize();
  const [ledger, setLedger] = useState(false);
  const { data, isError, error, refetch } = useBridgeApprovalsQuery();

  if (isError && bridgeErrorCode(error) === 'BRIDGE_DISABLED') {
    return null;
  }
  const waiting = data?.proposals.filter((p) => p.status === 'pending' || needsStart(p)) ?? [];
  const recent =
    data?.proposals
      .filter((p) => p.status !== 'pending' && !needsStart(p))
      .slice(0, RECENT_SHOWN) ?? [];

  return (
    <section className="flex flex-col gap-4" data-testid="bridge-approvals">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-text-primary text-base font-semibold">
            {localize('com_bridge_approvals_title')}
          </h2>
          <p className="text-text-secondary text-sm">{localize('com_bridge_approvals_hint')}</p>
          {data && (
            <p className="text-text-secondary text-sm" data-testid="bridge-approvals-count">
              {localize('com_bridge_approvals_waiting', { 0: data.pending, 1: data.maxPending })}
            </p>
          )}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setLedger(true)}>
          {localize('com_bridge_approvals_ledger')}
        </Button>
      </div>

      {isError && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-text-primary text-sm">
            {localize(approvalErrorKey(error, 'com_bridge_approvals_error_load'))}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            {localize('com_ui_retry')}
          </Button>
        </div>
      )}

      {data && waiting.length === 0 && (
        <p className="text-text-secondary text-sm" data-testid="bridge-approvals-empty">
          {localize('com_bridge_approvals_empty')}
        </p>
      )}
      {waiting.length > 0 && (
        <ul className="flex flex-col gap-3" data-testid="bridge-approvals-waiting">
          {waiting.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} onOpenResult={onOpenResult} />
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-text-primary text-sm font-semibold">
            {localize('com_bridge_approvals_recent')}
          </h3>
          <ul>
            {recent.map((proposal) => (
              <li
                key={proposal.id}
                className="border-border-light flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-b-0"
                data-testid="bridge-proposal-recent"
                data-status={proposal.status}
              >
                <span className="text-text-primary">{proposal.title}</span>
                <span className="text-text-secondary text-xs">
                  {localize(DECIDED_LABEL[proposal.status] ?? 'com_bridge_approvals_denied')} ·{' '}
                  {proposal.roleSlug} · {whenLabel(proposal.decidedAt ?? proposal.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AuditDialog open={ledger} onClose={() => setLedger(false)} />
    </section>
  );
}
