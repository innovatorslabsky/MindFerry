import { memo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, useToastContext } from '@librechat/client';
import type { TLibraryHighlight } from 'librechat-data-provider';
import {
  useDeleteLibraryHighlightMutation,
  useUpdateLibraryHighlightMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import ExportButtons from './ExportButtons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type HighlightRowProps = {
  highlight: TLibraryHighlight;
  onFocus: (highlight: TLibraryHighlight) => void;
};

const HighlightRow = memo(({ highlight, onFocus }: HighlightRowProps) => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(highlight.note ?? '');
  const onError = () =>
    showToast({
      message: localize('com_library_highlight_error'),
      status: NotificationSeverity.ERROR,
    });
  const update = useUpdateLibraryHighlightMutation({
    onSuccess: () => setEditing(false),
    onError,
  });
  const remove = useDeleteLibraryHighlightMutation({ onError });

  return (
    <li
      className="border-border-light flex flex-col gap-2 border-b px-3 py-3 last:border-b-0"
      data-testid="library-highlight-row"
    >
      <div className="flex items-start gap-2">
        <span
          className={cn('library-swatch-' + highlight.color, 'mt-1 h-3 w-3 shrink-0 rounded-full')}
          aria-hidden="true"
        />
        <button
          type="button"
          className="text-text-primary min-w-0 flex-1 text-left text-sm"
          onClick={() => onFocus(highlight)}
          disabled={highlight.orphaned}
        >
          <span className="line-clamp-4">“{highlight.anchor.exact}”</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={localize('com_library_delete_highlight')}
          disabled={remove.isLoading}
          onClick={() => remove.mutate({ id: highlight.id, documentId: highlight.documentId })}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {highlight.orphaned && (
        <p className="text-text-secondary text-xs" data-testid="library-orphaned">
          {localize('com_library_orphaned')}
        </p>
      )}
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={10_000}
            rows={3}
            aria-label={localize('com_library_note')}
            className="border-border-medium bg-surface-primary text-text-primary w-full rounded-md border p-2 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={update.isLoading}
              onClick={() =>
                update.mutate({
                  id: highlight.id,
                  documentId: highlight.documentId,
                  patch: { note: note.trim() === '' ? null : note.trim() },
                })
              }
            >
              {localize('com_library_save_note')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNote(highlight.note ?? '');
                setEditing(false);
              }}
            >
              {localize('com_ui_cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="text-text-secondary hover:text-text-primary text-left text-xs"
          onClick={() => setEditing(true)}
        >
          {highlight.note ? highlight.note : localize('com_library_add_note')}
        </button>
      )}
    </li>
  );
});
HighlightRow.displayName = 'HighlightRow';

type HighlightsPanelProps = {
  /** The open document, so its highlights can be exported whole, not just those in view. */
  documentId: string;
  highlights: readonly TLibraryHighlight[];
  onFocus: (highlight: TLibraryHighlight) => void;
};

/** What the person has highlighted in the open text, with a note beside each if they wrote one. */
function HighlightsPanel({ documentId, highlights, onFocus }: HighlightsPanelProps) {
  const localize = useLocalize();
  return (
    <section aria-label={localize('com_library_highlights')} className="flex h-full flex-col">
      <h2 className="text-text-primary border-border-light border-b px-3 py-3 text-sm font-semibold">
        {localize('com_library_highlights')} ({highlights.length})
      </h2>
      {highlights.length === 0 ? (
        <p className="text-text-secondary p-3 text-sm">{localize('com_library_no_highlights')}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {highlights.map((highlight) => (
            <HighlightRow key={highlight.id} highlight={highlight} onFocus={onFocus} />
          ))}
        </ul>
      )}
      <div className="border-border-light border-t px-2 py-1.5">
        <ExportButtons documentId={documentId} />
      </div>
    </section>
  );
}

export default memo(HighlightsPanel);
