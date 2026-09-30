import { useId, useState } from 'react';
import { ChevronDown, MessageSquarePlus, MessagesSquare } from 'lucide-react';
import {
  Button,
  Spinner,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  useToastContext,
} from '@librechat/client';
import type { THubNote, THubContinueRequest } from 'librechat-data-provider';
import { useContinueHubNoteMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { SURFACE_LABEL_KEYS } from './surface';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type NoteRowProps = {
  note: THubNote;
  continueTarget?: THubContinueRequest;
  onContinued: (conversationId: string) => void;
  onOpenThread: (threadId: string) => void;
};

/**
 * One note, collapsed to its title and a short preview until opened, so a long
 * note doesn't bury the rest. Opened, its actions come before the text so they
 * stay in reach however long the note is.
 */
function NoteRow({ note, continueTarget, onContinued, onOpenThread }: NoteRowProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const detailsId = useId();
  const continueMutation = useContinueHubNoteMutation({
    onSuccess: ({ conversationId }) => {
      showToast({
        message: localize('com_ui_context_hub_continue_success'),
        status: NotificationSeverity.SUCCESS,
      });
      onContinued(conversationId);
    },
    onError: () => {
      showToast({
        message: localize('com_ui_context_hub_continue_note_error'),
        status: NotificationSeverity.ERROR,
      });
    },
  });

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          aria-labelledby={titleId}
          aria-describedby={detailsId}
          className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-surface-secondary"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span id={titleId} className="text-sm font-medium text-text-primary">
              {note.title}
            </span>
            <span id={detailsId} className="flex flex-col gap-0.5">
              <span className="text-xs text-text-secondary">
                {new Date(note.createdAt).toLocaleString()}
                {note.surface != null ? ` · ${localize(SURFACE_LABEL_KEYS[note.surface])}` : ''}
              </span>
              {!open && (
                <span className="line-clamp-2 break-words text-xs text-text-tertiary">
                  {note.text}
                </span>
              )}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0 text-text-secondary transition-transform motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 px-4 pb-3">
          {note.sessionTag != null && (
            <p className="break-words text-xs text-text-secondary">{note.sessionTag}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={continueMutation.isLoading}
              onClick={() => continueMutation.mutate({ id: note.id, target: continueTarget })}
            >
              {continueMutation.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              )}
              {localize('com_ui_context_hub_continue')}
            </Button>
            {note.threadId != null && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => onOpenThread(note.threadId as string)}
              >
                <MessagesSquare className="h-4 w-4" aria-hidden="true" />
                {localize('com_ui_context_hub_browse_note_open_thread')}
              </Button>
            )}
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{note.text}</p>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

type HubNoteListProps = {
  notes: THubNote[];
  query: string;
  isLoading: boolean;
  isError: boolean;
  continueTarget?: THubContinueRequest;
  onContinued: (conversationId: string) => void;
  onOpenThread: (threadId: string) => void;
};

/** The archive's notes, newest first as given, with their loading, error and empty states. */
export default function HubNoteList({
  notes,
  query,
  isLoading,
  isError,
  continueTarget,
  onContinued,
  onOpenThread,
}: HubNoteListProps) {
  const localize = useLocalize();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="h-6 w-6 text-text-secondary" />
      </div>
    );
  }
  if (isError) {
    return (
      <p className="py-6 text-center text-sm text-text-secondary">
        {localize('com_ui_context_hub_browse_notes_load_error')}
      </p>
    );
  }
  if (notes.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-secondary">
        {localize(
          query
            ? 'com_ui_context_hub_browse_empty_search'
            : 'com_ui_context_hub_browse_empty_notes',
        )}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border-light overflow-hidden rounded-xl border border-border-light">
      {notes.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          continueTarget={continueTarget}
          onContinued={onContinued}
          onOpenThread={onOpenThread}
        />
      ))}
    </ul>
  );
}
