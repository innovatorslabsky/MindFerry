import { ArrowLeft } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { useGetHubThreadQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

type HubThreadDetailProps = {
  threadId: string;
  onBack: () => void;
};

/** Full content of one archived thread — the same data `get_thread` returns
 *  over MCP, rendered for a person browsing the archive directly. */
export default function HubThreadDetail({ threadId, onBack }: HubThreadDetailProps) {
  const localize = useLocalize();
  const { data, isLoading, isError } = useGetHubThreadQuery(threadId);
  const thread = data?.thread;

  return (
    <div className="flex h-full flex-col gap-3">
      <Button variant="ghost" size="sm" className="w-fit gap-1.5" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {localize('com_ui_back')}
      </Button>
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
              {thread.provider} · {new Date(thread.updatedAt).toLocaleString()}
            </p>
          </div>
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
