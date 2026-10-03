import { useState } from 'react';
import {
  Label,
  Button,
  Spinner,
  OGDialog,
  TrashIcon,
  OGDialogTrigger,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { THubNote } from 'librechat-data-provider';
import { useDeleteHubNoteMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

/** Deletes one archive note after the person confirms; the note lists refresh on success. */
export default function DeleteNoteButton({ note }: { note: Pick<THubNote, 'id' | 'title'> }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [open, setOpen] = useState(false);
  const deleteMutation = useDeleteHubNoteMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_context_hub_note_delete_success'),
        status: NotificationSeverity.SUCCESS,
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_context_hub_note_delete_error'),
        status: NotificationSeverity.ERROR,
      });
    },
  });

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <OGDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-text-destructive"
          disabled={deleteMutation.isLoading}
        >
          {deleteMutation.isLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <TrashIcon className="h-4 w-4" />
          )}
          {localize('com_ui_context_hub_note_delete')}
        </Button>
      </OGDialogTrigger>
      <OGDialogTemplate
        showCloseButton={false}
        title={localize('com_ui_context_hub_note_delete')}
        className="w-11/12 max-w-lg"
        main={
          <Label className="text-left text-sm font-medium">
            {localize('com_ui_context_hub_note_delete_confirm', { 0: note.title })}
          </Label>
        }
        selection={{
          selectHandler: () => deleteMutation.mutate({ id: note.id }),
          selectClasses:
            'bg-surface-destructive hover:bg-surface-destructive-hover text-text-on-status',
          selectText: localize('com_ui_delete'),
        }}
      />
    </OGDialog>
  );
}
