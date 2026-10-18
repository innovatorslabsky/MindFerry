import { useState } from 'react';
import { Copy, Mail } from 'lucide-react';
import { Button, Input, Spinner, useToastContext } from '@librechat/client';
import {
  useDeleteLibraryInboxMutation,
  useLibraryInboxQuery,
  useRotateLibraryInboxMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

/**
 * The address newsletters can be sent to. The secret in it is shown once, right after it is made,
 * and kept only in this component: the server stores a hash, so it cannot show it again.
 */
export default function InboxPanel() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [secretUrl, setSecretUrl] = useState<string | null>(null);
  const inbox = useLibraryInboxQuery();
  const fail = () =>
    showToast({
      message: localize('com_library_inbox_error'),
      status: NotificationSeverity.ERROR,
    });
  const rotate = useRotateLibraryInboxMutation({
    onSuccess: ({ token }) => setSecretUrl(`${window.location.origin}/api/library/inbox/${token}`),
    onError: fail,
  });
  const turnOff = useDeleteLibraryInboxMutation({
    onSuccess: () => setSecretUrl(null),
    onError: fail,
  });

  const copy = async () => {
    if (!secretUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(secretUrl);
      showToast({
        message: localize('com_library_inbox_copied'),
        status: NotificationSeverity.SUCCESS,
      });
    } catch {
      // The field is selectable, so the person can still copy it by hand.
    }
  };

  if (inbox.isLoading) {
    return null;
  }
  const made = inbox.data?.inbox ?? null;
  const busy = rotate.isLoading || turnOff.isLoading;

  return (
    <section
      className="border-border-light flex flex-col gap-3 rounded-xl border p-4"
      aria-label={localize('com_library_inbox_title')}
      data-testid="library-inbox"
    >
      <div className="flex items-start gap-3">
        <Mail className="text-text-secondary mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-text-primary text-sm font-medium">
            {localize('com_library_inbox_title')}
          </h2>
          <p className="text-text-secondary text-xs">{localize('com_library_inbox_hint')}</p>
        </div>
      </div>

      {secretUrl && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Input
              readOnly
              value={secretUrl}
              aria-label={localize('com_library_inbox_url')}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={localize('com_library_inbox_copy')}
              onClick={copy}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <p className="text-text-secondary text-xs" role="note">
            {localize('com_library_inbox_shown_once')}
          </p>
        </div>
      )}

      {made && !secretUrl && (
        <p className="text-text-secondary text-xs">
          {localize('com_library_inbox_made', { 0: new Date(made.createdAt).toLocaleDateString() })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => rotate.mutate()}
        >
          {rotate.isLoading && <Spinner className="mr-1.5 h-4 w-4" />}
          {localize(made ? 'com_library_inbox_rotate' : 'com_library_inbox_create')}
        </Button>
        {made && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => turnOff.mutate()}
          >
            {localize('com_library_inbox_off')}
          </Button>
        )}
      </div>
    </section>
  );
}
