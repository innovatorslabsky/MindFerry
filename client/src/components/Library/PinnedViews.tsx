import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Pin, X } from 'lucide-react';
import { Button, Input, useToastContext } from '@librechat/client';
import type { TLibraryView, TLibraryViewFilter } from 'librechat-data-provider';
import {
  useCreateLibraryViewMutation,
  useDeleteLibraryViewMutation,
  useLibraryViewsQuery,
  useRenameLibraryViewMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { libraryErrorKey } from './errors';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const SORT_DEFAULT = 'updated';

/** Whether the list is showing exactly what a pinned view keeps. */
export function matchesView(current: TLibraryViewFilter, view: TLibraryView): boolean {
  const same = (a?: string, b?: string) => (a ?? '') === (b ?? '');
  const sort = (value?: string) => value ?? SORT_DEFAULT;
  return (
    same(current.location ?? 'inbox', view.filter.location ?? 'inbox') &&
    same(current.kind, view.filter.kind) &&
    same(current.tag, view.filter.tag) &&
    same(current.folder, view.filter.folder) &&
    sort(current.sort) === sort(view.filter.sort)
  );
}

/**
 * Named sets of list filters, kept on the server so they follow the person to another device. A view
 * is opened with one click; the current filters can be pinned under a name.
 */
export default function PinnedViews({
  current,
  canPin,
  onOpen,
}: {
  /** What the list is showing now. */
  current: TLibraryViewFilter;
  /** Off while searching, since a search is not one of the filters a view keeps. */
  canPin: boolean;
  onOpen: (filter: TLibraryViewFilter) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const views = useLibraryViewsQuery().data?.views ?? [];
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (naming) {
      nameInput.current?.focus();
    }
  }, [naming]);
  /** The view being renamed, and what its name is being changed to. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const renameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [renaming]);

  const fail = (error: unknown) =>
    showToast({
      message: localize(libraryErrorKey(error, 'com_library_view_error')),
      status: NotificationSeverity.ERROR,
    });
  const create = useCreateLibraryViewMutation({
    onSuccess: () => {
      setNaming(false);
      setName('');
    },
    onError: fail,
  });
  const remove = useDeleteLibraryViewMutation({ onError: fail });
  const rename = useRenameLibraryViewMutation({
    onSuccess: () => setRenaming(null),
    onError: fail,
  });
  const submitRename = (event: React.FormEvent, view: TLibraryView) => {
    event.preventDefault();
    const clean = renameTo.trim();
    if (clean === '' || clean === view.name) {
      setRenaming(null);
      return;
    }
    rename.mutate({ id: view.id, name: clean });
  };

  const alreadyPinned = views.some((view) => matchesView(current, view));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (clean) {
      create.mutate({ name: clean, filter: current });
    }
  };

  if (views.length === 0 && !canPin) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="library-pinned">
      {views.length > 0 && (
        <div
          role="group"
          aria-label={localize('com_library_pinned')}
          className="flex flex-wrap gap-1.5 md:flex-col md:gap-1"
        >
          {views.map((view) => {
            const active = matchesView(current, view);
            if (renaming === view.id) {
              return (
                <form
                  key={view.id}
                  className="flex min-w-0 items-center gap-1"
                  onSubmit={(event) => submitRename(event, view)}
                >
                  <Input
                    ref={renameInput}
                    value={renameTo}
                    onChange={(event) => setRenameTo(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setRenaming(null);
                      }
                    }}
                    aria-label={localize('com_library_view_rename_field', { 0: view.name })}
                    maxLength={64}
                    className="h-8 min-w-0 flex-1"
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={localize('com_library_view_rename_save')}
                    disabled={rename.isLoading || renameTo.trim() === ''}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </form>
              );
            }
            return (
              <div key={view.id} className="flex min-w-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline-toggle"
                  aria-pressed={active}
                  className={cn('min-w-0 flex-1 md:justify-start')}
                  onClick={() => onOpen(view.filter)}
                >
                  <Pin className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{view.name}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={localize('com_library_view_rename', { 0: view.name })}
                  onClick={() => {
                    setRenaming(view.id);
                    setRenameTo(view.name);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={localize('com_library_view_unpin', { 0: view.name })}
                  disabled={remove.isLoading}
                  onClick={() => remove.mutate({ id: view.id })}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {canPin && !alreadyPinned && !naming && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="md:justify-start"
          onClick={() => setNaming(true)}
        >
          <Pin className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {localize('com_library_view_pin')}
        </Button>
      )}

      {canPin && naming && (
        <form onSubmit={submit} className="flex flex-col gap-1.5">
          <Input
            ref={nameInput}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={localize('com_library_view_name')}
            aria-label={localize('com_library_view_name')}
            maxLength={64}
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" disabled={create.isLoading || name.trim() === ''}>
              {localize('com_library_view_save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setNaming(false);
                setName('');
              }}
            >
              {localize('com_ui_cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
