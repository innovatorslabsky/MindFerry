import { ArrowLeft, MessageSquarePlus } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import type { THubContinueRequest } from 'librechat-data-provider';
import {
  useGetHubThreadQuery,
  useListHubNotesQuery,
  useContinueHubThreadMutation,
} from '~/data-provider';
import { SURFACE_LABEL_KEYS, surfaceOf } from './surface';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

type HubThreadDetailProps = {
  threadId: string;
  onBack: () => void;
  /** Where a continued chat should run — the endpoint and model the person is using now. */
  continueTarget?: THubContinueRequest;
  /** Called with the new conversation's id once "Continue in chat" has made it. */
  onContinued?: (conversationId: string) => void;
};

/** Full content of one archived thread — the same data `get_thread` returns
 *  over MCP, rendered for a person browsing the archive directly. */
export default function HubThreadDetail({
  threadId,
  onBack,
  continueTarget,
  onContinued,
}: HubThreadDetailProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data, isLoading, isError } = useGetHubThreadQuery(threadId);
  const thread = data?.thread;
  const notesQuery = useListHubNotesQuery(threadId);
  const notes = notesQuery.data?.notes ?? [];
  const continueMutation = useContinueHubThreadMutation({
    onSuccess: ({ conversationId }) => {
      showToast({
        message: localize('com_ui_context_hub_continue_success'),
        status: NotificationSeverity.SUCCESS,
      });
      onContinued?.(conversationId);
    },
    onError: () => {
      showToast({
        message: localize('com_ui_context_hub_continue_error'),
        status: NotificationSeverity.ERROR,
      });
    },
  });

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="w-fit gap-1.5" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {localize('com_ui_back')}
        </Button>
        {thread != null && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={continueMutation.isLoading}
            onClick={() => continueMutation.mutate({ id: threadId, target: continueTarget })}
          >
            {continueMutation.isLoading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
            )}
            {localize('com_ui_context_hub_continue')}
          </Button>
        )}
      </div>
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-6 w-6 text-text-secondary" />
        </div>
      )}
      {isError && (
        <p className="py-6 text-center text-sm text-text-secondary">
          {localize('com_ui_context_hub_browse_thread_load_error')}
        </p>
      )}
      {thread != null && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border-light">
          <div className="border-b border-border-light px-4 py-3">
            <h3 className="text-sm font-medium text-text-primary">{thread.title}</h3>
            <p className="text-xs text-text-secondary">
              {localize(SURFACE_LABEL_KEYS[surfaceOf(thread.surface)])} · {thread.provider} ·{' '}
              {new Date(thread.updatedAt).toLocaleString()}
            </p>
          </div>
          {notes.length > 0 && (
            <div className="border-b border-border-light px-4 py-3">
              <h4 className="mb-1 text-xs font-medium uppercase text-text-secondary">
                {localize('com_ui_context_hub_browse_thread_notes_heading')}
              </h4>
              <ul className="space-y-2">
                {notes.map((note) => (
                  <li key={note.id}>
                    <p className="text-sm font-medium text-text-primary">{note.title}</p>
                    <p className="whitespace-pre-wrap text-sm text-text-primary">{note.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="divide-y divide-border-light">
            {thread.messages.map((message) => (
              <div key={message.id} className="px-4 py-3">
                <p className="mb-1 text-xs font-medium uppercase text-text-secondary">
                  {message.role}
                </p>
                {message.segments.map((segment, index) => (
                  <p key={index} className="whitespace-pre-wrap text-sm text-text-primary">
                    {segment.text}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
