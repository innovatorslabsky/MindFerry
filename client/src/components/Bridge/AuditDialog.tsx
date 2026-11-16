import { OGDialog, OGDialogTemplate, Spinner } from '@librechat/client';
import type { TranslationKeys } from '~/hooks';
import { useBridgeAuditQuery } from '~/data-provider';
import { bridgeErrorKey } from './errors';
import { useLocalize } from '~/hooks';
import { whenLabel } from './format';

const ACTION_LABEL: Record<string, TranslationKeys> = {
  proposal_created: 'com_bridge_audit_proposal_created',
  proposal_approved: 'com_bridge_audit_proposal_approved',
  proposal_denied: 'com_bridge_audit_proposal_denied',
  proposal_expired: 'com_bridge_audit_proposal_expired',
  handed_over: 'com_bridge_audit_handed_over',
  handover_failed: 'com_bridge_audit_handover_failed',
};

/** The ledger: what was proposed, decided and handed over, newest first. Read-only. */
export default function AuditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const localize = useLocalize();
  const { data, isLoading, isError, error } = useBridgeAuditQuery({ enabled: open });

  return (
    <OGDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <OGDialogTemplate
        showCloseButton={true}
        title={localize('com_bridge_approvals_ledger_title')}
        className="w-11/12 max-w-2xl"
        main={
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-left text-sm">
            <p className="text-text-tertiary text-xs">
              {localize('com_bridge_approvals_ledger_note')}
            </p>
            {isLoading && (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            )}
            {isError && (
              <p role="alert" className="text-text-secondary" data-testid="bridge-audit-error">
                {localize(bridgeErrorKey(error, 'com_bridge_approvals_error_load'))}
              </p>
            )}
            {data && data.lines.length === 0 && (
              <p className="text-text-secondary" data-testid="bridge-audit-empty">
                {localize('com_bridge_approvals_ledger_empty')}
              </p>
            )}
            {data && data.lines.length > 0 && (
              <ul data-testid="bridge-audit-lines">
                {data.lines.map((line) => (
                  <li
                    key={line.id}
                    className="border-border-light flex flex-wrap items-center gap-x-3 border-b py-2 last:border-b-0"
                    data-testid="bridge-audit-line"
                  >
                    <span className="text-text-primary">
                      {ACTION_LABEL[line.action]
                        ? localize(ACTION_LABEL[line.action])
                        : line.action}
                    </span>
                    {line.roleSlug && (
                      <span className="text-text-secondary text-xs">{line.roleSlug}</span>
                    )}
                    {line.detail && (
                      <span className="text-text-tertiary text-xs">{line.detail}</span>
                    )}
                    {line.hash && (
                      <span className="text-text-tertiary font-mono text-xs">
                        {line.hash.slice(0, 8)}
                      </span>
                    )}
                    <span className="text-text-tertiary text-xs">{whenLabel(line.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
      />
    </OGDialog>
  );
}
