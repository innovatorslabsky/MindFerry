import { OGDialog, OGDialogTemplate, Spinner } from '@librechat/client';
import { useBridgeResultQuery } from '~/data-provider';
import ResultMarkdown from './ResultMarkdown';
import { bridgeErrorKey } from './errors';
import { useLocalize } from '~/hooks';

/** One agent result. The text is the agent's, so it is drawn as untrusted Markdown and said to be. */
export default function ResultDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const localize = useLocalize();
  const { data, isLoading, isError, error } = useBridgeResultQuery(id ?? undefined);

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
