import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import {
  useSummarizeLibraryDocumentMutation,
  useUpdateLibraryDocumentMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useChatTarget } from './chatTarget';
import { libraryErrorKey } from './errors';
import { useLocalize } from '~/hooks';
import NoteField from './NoteField';

/**
 * The summary a person keeps with a document. They can write it themselves, or ask the model of the
 * chat they have open for a draft: the draft replaces nothing until they keep it.
 */
export default function SummaryField({
  documentId,
  value,
  maxLength,
}: {
  documentId: string;
  value: string;
  maxLength: number;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const chatTarget = useChatTarget();
  const [draft, setDraft] = useState<string | null>(null);
  const fail = (key: Parameters<typeof localize>[0]) =>
    showToast({ message: localize(key), status: NotificationSeverity.ERROR });

  const summarize = useSummarizeLibraryDocumentMutation({
    onSuccess: ({ summary }) => setDraft(summary),
    onError: (error) => fail(libraryErrorKey(error, 'com_library_summary_error')),
  });
  const save = useUpdateLibraryDocumentMutation({
    onSuccess: () => setDraft(null),
    onError: () => fail('com_library_edit_error'),
  });

  const draft_ = draft !== null;
  const write = () => {
    const target = chatTarget;
    if (!target) {
      fail('com_library_summary_no_model');
      return;
    }
    summarize.mutate({ id: documentId, ...target });
  };

  return (
    <div className="flex flex-col gap-2">
      {draft_ ? (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={maxLength}
          rows={6}
          aria-label={localize('com_library_summary_draft')}
          className="border-border-medium bg-surface-primary text-text-primary w-full resize-y rounded-lg border px-3 py-2 text-sm"
          data-testid="library-summary-draft"
        />
      ) : (
        <NoteField
          key={`${documentId}:${value}`}
          documentId={documentId}
          field="summary"
          value={value}
          maxLength={maxLength}
          label={localize('com_library_summary')}
          placeholder={localize('com_library_summary_placeholder')}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {draft_ ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={save.isLoading}
              onClick={() => save.mutate({ id: documentId, patch: { summary: draft.trim() } })}
            >
              {localize('com_library_summary_keep')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setDraft(null)}>
              {localize('com_library_summary_discard')}
            </Button>
            <p className="text-text-secondary text-xs">{localize('com_library_summary_unsaved')}</p>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={summarize.isLoading}
            onClick={write}
          >
            {summarize.isLoading ? (
              <Spinner className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {localize(value ? 'com_library_summary_rewrite' : 'com_library_summary_write')}
          </Button>
        )}
      </div>
    </div>
  );
}
