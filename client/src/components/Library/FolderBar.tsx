import { useEffect, useRef, useState } from 'react';
import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { Button, Input, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TLibraryFolder } from 'librechat-data-provider';
import {
  useCreateLibraryFolderMutation,
  useDeleteLibraryFolderMutation,
  useRenameLibraryFolderMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { libraryErrorKey } from './errors';
import { useLocalize } from '~/hooks';

/** The value of the folder filter for documents that are in no folder. */
export const NO_FOLDER = 'none';

type Editing = { mode: 'create' } | { mode: 'rename'; folder: TLibraryFolder } | null;

/** Pick a folder to look at, and make, rename or delete folders. `''` means all documents. */
export default function FolderBar({
  folders,
  value,
  onChange,
}: {
  folders: TLibraryFolder[];
  value: string;
  onChange: (folder: string) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const current = folders.find((folder) => folder.id === value);

  const fail = (error: unknown) =>
    showToast({
      message: localize(libraryErrorKey(error, 'com_library_folder_error')),
      status: NotificationSeverity.ERROR,
    });
  const create = useCreateLibraryFolderMutation({
    onSuccess: (data) => {
      onChange(data.folder.id);
      setEditing(null);
    },
    onError: fail,
  });
  const rename = useRenameLibraryFolderMutation({
    onSuccess: () => setEditing(null),
    onError: fail,
  });
  const remove = useDeleteLibraryFolderMutation({
    onSuccess: () => {
      setConfirmDelete(false);
      onChange('');
    },
    onError: fail,
  });

  // Moves the cursor into the name box when it appears, so typing can start straight away.
  useEffect(() => {
    if (editing) {
      nameInput.current?.focus();
    }
  }, [editing]);

  const open = (next: Editing) => {
    setName(next?.mode === 'rename' ? next.folder.name : '');
    setEditing(next);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean || !editing) {
      return;
    }
    if (editing.mode === 'create') {
      create.mutate(clean);
    } else {
      rename.mutate({ id: editing.folder.id, name: clean });
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="library-folders">
      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={localize('com_library_folder_filter')}
          className="border-border-medium bg-surface-primary text-text-primary min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">{localize('com_library_folder_all')}</option>
          <option value={NO_FOLDER}>{localize('com_library_folder_none')}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {localize('com_library_folder_count', { 0: folder.name, 1: folder.documentCount })}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label={localize('com_library_folder_new')}
          onClick={() => open({ mode: 'create' })}
        >
          <FolderPlus className="h-4 w-4" aria-hidden="true" />
        </Button>
        {current && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label={localize('com_library_folder_rename')}
              onClick={() => open({ mode: 'rename', folder: current })}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label={localize('com_library_folder_delete')}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
      {editing && (
        <form onSubmit={submit} className="flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={localize('com_library_folder_name')}
            aria-label={localize('com_library_folder_name')}
            maxLength={64}
            ref={nameInput}
            className="min-w-0 flex-1"
          />
          <Button
            type="submit"
            disabled={name.trim() === '' || create.isLoading || rename.isLoading}
          >
            {localize(editing.mode === 'create' ? 'com_library_folder_create' : 'com_ui_save')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setEditing(null)}>
            {localize('com_ui_cancel')}
          </Button>
        </form>
      )}
      <OGDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_library_folder_delete')}
          className="w-11/12 max-w-lg"
          main={
            <p className="text-text-primary text-left text-sm">
              {localize('com_library_folder_delete_confirm', { 0: current?.name ?? '' })}
            </p>
          }
          selection={{
            selectHandler: () => current && remove.mutate({ id: current.id }),
            selectClasses:
              'bg-surface-destructive hover:bg-surface-destructive-hover text-text-on-status',
            selectText: localize('com_ui_delete'),
          }}
        />
      </OGDialog>
    </div>
  );
}
