import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, OGDialog, OGDialogTemplate, Spinner, useToastContext } from '@librechat/client';
import {
  useDeleteLibraryShareMutation,
  useLibraryShareQuery,
  useSetLibraryShareMutation,
} from '~/data-provider';
import { buildLibraryShareUrl } from '~/utils/share';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

/**
 * The public link to a document: make it, choose whether the highlights go with it, copy it, and
 * withdraw it. The link shows the whole text to anyone who has it, which the dialog says plainly.
 */
export default function ShareDialog({
  documentId,
  open,
  onOpenChange,
}: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [copied, setCopied] = useState(false);
  const { data } = useLibraryShareQuery(documentId, { enabled: open });
  const fail = () =>
    showToast({
      message: localize('com_library_share_error'),
      status: NotificationSeverity.ERROR,
    });
  const save = useSetLibraryShareMutation({ onError: fail });
  const withdraw = useDeleteLibraryShareMutation({ onError: fail });

  const share = data?.share ?? null;
  const busy = save.isLoading || withdraw.isLoading;
  const url = share ? buildLibraryShareUrl(share.token) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast({ message: localize('com_ui_copy_failed'), status: NotificationSeverity.ERROR });
    }
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        showCloseButton={true}
        title={localize('com_library_share')}
        className="w-11/12 max-w-lg"
        main={
          <div className="flex flex-col gap-3 text-left text-sm" data-testid="library-share-dialog">
            <p className="text-text-secondary">{localize('com_library_share_hint')}</p>
            {data?.notice && (
              <p className="text-text-secondary bg-surface-secondary rounded-lg px-3 py-2 text-xs">
                {data.notice}
              </p>
            )}
            {share ? (
              <>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={url}
                    onFocus={(event) => event.currentTarget.select()}
                    aria-label={localize('com_library_share_link')}
                    className="border-border-medium bg-surface-primary text-text-primary min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs"
                    data-testid="library-share-url"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copy()}
                    data-testid="library-share-copy"
                  >
                    {copied ? (
                      <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    )}
                    {localize(copied ? 'com_ui_copied' : 'com_ui_copy_link')}
                  </Button>
                </div>
                <label className="text-text-primary flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={share.includeHighlights}
                    disabled={busy}
                    onChange={(event) =>
                      save.mutate({ id: documentId, includeHighlights: event.target.checked })
                    }
                    data-testid="library-share-highlights"
                  />
                  {localize('com_library_share_highlights')}
                </label>
                <div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => withdraw.mutate(documentId)}
                    data-testid="library-share-stop"
                  >
                    {withdraw.isLoading && <Spinner className="mr-1.5 h-4 w-4" />}
                    {localize('com_library_share_stop')}
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button
                  disabled={busy || data == null}
                  onClick={() => save.mutate({ id: documentId, includeHighlights: false })}
                  data-testid="library-share-create"
                >
                  {save.isLoading && <Spinner className="mr-1.5 h-4 w-4" />}
                  {localize('com_library_share_create')}
                </Button>
              </div>
            )}
          </div>
        }
      />
    </OGDialog>
  );
}
