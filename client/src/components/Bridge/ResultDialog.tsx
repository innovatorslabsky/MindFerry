import { Button, OGDialog, OGDialogTemplate, Spinner } from '@librechat/client';
import type { TBridgeImportResponse } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useBridgeApprovalsQuery,
  useBridgeResultQuery,
  useImportBridgeFollowUpsMutation,
} from '~/data-provider';
import { approvalErrorKey, bridgeErrorKey } from './errors';
import ResultMarkdown from './ResultMarkdown';
import ResultWarnings from './ResultWarnings';
import { useLocalize } from '~/hooks';

const SKIP_REASON: Record<string, TranslationKeys> = {
  role_unknown: 'com_bridge_import_reason_role_unknown',
  role_unavailable: 'com_bridge_import_reason_role_unavailable',
  too_long: 'com_bridge_import_reason_too_long',
  secret: 'com_bridge_import_reason_secret',
  hidden: 'com_bridge_import_reason_hidden',
  limit: 'com_bridge_import_reason_limit',
};

/** True when a finished result carries the section an agent uses to suggest follow-up tasks. */
const hasFollowUps = (text: string): boolean => /^\s{0,3}#{1,6}\s*proposed follow-ups/im.test(text);

function ImportOutcome({ outcome }: { outcome: TBridgeImportResponse }) {
  const localize = useLocalize();
  return (
    <div className="flex flex-col gap-1 text-xs" role="status" data-testid="bridge-import-outcome">
      <p className="text-text-primary">
        {outcome.added > 0
          ? localize('com_bridge_import_added', { 0: outcome.added })
          : localize('com_bridge_import_none')}
      </p>
      {outcome.skipped.length > 0 && (
        <p className="text-text-secondary">
          {localize('com_bridge_import_skipped', {
            0: outcome.skipped
              .map(
                (item) =>
                  `${item.role}: ${localize(SKIP_REASON[item.reason] ?? 'com_bridge_import_reason_role_unknown')}`,
              )
              .join('; '),
          })}
        </p>
      )}
      {outcome.ignored > 0 && (
        <p className="text-text-secondary">
          {localize('com_bridge_import_ignored', { 0: outcome.ignored })}
        </p>
      )}
    </div>
  );
}

/** One agent result. The text is the agent's, so it is drawn as untrusted Markdown and said to be. */
export default function ResultDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const localize = useLocalize();
  const { data, isLoading, isError, error } = useBridgeResultQuery(id ?? undefined);
  const approvals = useBridgeApprovalsQuery();
  const importer = useImportBridgeFollowUpsMutation();
  const canImport =
    id != null && approvals.data != null && data?.status === 'DONE' && hasFollowUps(data.text);

  return (
    <OGDialog open={id != null} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        showCloseButton={true}
        title={localize('com_bridge_result')}
        className="w-11/12 max-w-2xl"
        main={
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-left text-sm">
            {isLoading && (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            )}
            {isError && (
              <p role="alert" className="text-text-secondary" data-testid="bridge-result-error">
                {localize(bridgeErrorKey(error, 'com_bridge_error_result'))}
              </p>
            )}
            {data && (
              <>
                <p className="text-text-secondary text-xs" data-testid="bridge-result-status">
                  {data.status === 'DONE' && localize('com_bridge_result_done')}
                  {data.status === 'FAILED' && localize('com_bridge_result_failed')}
                  {data.status === 'UNKNOWN' && localize('com_bridge_result_unknown')}
                </p>
                {data.warnings && (
                  <ResultWarnings warnings={data.warnings} omitted={data.warningsOmitted} />
                )}
                {canImport && (
                  <div
                    className="border-border-light bg-surface-secondary flex flex-col gap-2 rounded-lg border p-3"
                    data-testid="bridge-import"
                  >
                    <p className="text-text-secondary text-xs">
                      {localize('com_bridge_import_hint')}
                    </p>
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={importer.isLoading}
                        onClick={() => id && importer.mutate(id)}
                      >
                        {importer.isLoading && <Spinner className="mr-1.5 h-4 w-4" />}
                        {localize('com_bridge_import_button')}
                      </Button>
                    </div>
                    {importer.isError && (
                      <p
                        role="alert"
                        className="text-text-primary text-xs"
                        data-testid="bridge-import-error"
                      >
                        {localize(approvalErrorKey(importer.error, 'com_bridge_import_error'))}
                      </p>
                    )}
                    {importer.data && <ImportOutcome outcome={importer.data} />}
                  </div>
                )}
                <ResultMarkdown text={data.text} />
                {data.truncated && (
                  <p className="text-text-tertiary text-xs">{localize('com_bridge_result_cut')}</p>
                )}
                <p className="text-text-tertiary text-xs">
                  {localize('com_bridge_result_untrusted')}
                </p>
              </>
            )}
          </div>
        }
      />
    </OGDialog>
  );
}
