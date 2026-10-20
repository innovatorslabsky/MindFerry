import { useRecoilValue } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { MessageSquarePlus } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import type { TLibraryKind } from 'librechat-data-provider';
import { useStartLibraryChatMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { libraryErrorKey } from './errors';
import { targetOf } from './chatTarget';
import { useLocalize } from '~/hooks';
import store from '~/store';

/** "Ask about this": a new chat that starts from the page, or from a book's current page or chapter. */
export default function AskButtons({
  documentId,
  kind,
  unitIndex,
}: {
  documentId: string;
  kind: TLibraryKind;
  unitIndex: number;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const start = useStartLibraryChatMutation({
    onSuccess: ({ conversationId }) => navigate(`/c/${conversationId}`),
    onError: (error) =>
      showToast({
        message: localize(libraryErrorKey(error, 'com_library_ask_error')),
        status: NotificationSeverity.ERROR,
      }),
  });
  const ask = (scope: { unitIndex?: number }) =>
    start.mutate({ id: documentId, ...targetOf(conversation), ...scope });

  const icon = start.isLoading ? (
    <Spinner className="mr-1.5 h-4 w-4" />
  ) : (
    <MessageSquarePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
  );

  const unitKey = kind === 'pdf' ? 'com_library_ask_page' : 'com_library_ask_chapter';

  if (kind === 'article') {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={start.isLoading}
        aria-label={localize('com_library_ask')}
        onClick={() => ask({})}
      >
        {icon}
        <span className="hidden sm:inline">{localize('com_library_ask')}</span>
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={start.isLoading}
        aria-label={localize(unitKey)}
        onClick={() => ask({ unitIndex })}
      >
        {icon}
        <span className="hidden sm:inline">{localize(unitKey)}</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="hidden sm:inline-flex"
        disabled={start.isLoading}
        onClick={() => ask({})}
      >
        {localize('com_library_ask_book')}
      </Button>
    </>
  );
}
