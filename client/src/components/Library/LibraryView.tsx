import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, Clock, Inbox, Trash2, Upload, X } from 'lucide-react';
import {
  Input,
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type {
  TLibraryDocumentSummary,
  TLibraryFolder,
  TLibraryKind,
  TLibraryLocation,
  TLibrarySort,
  TLibraryViewFilter,
} from 'librechat-data-provider';
import {
  useBulkDeleteLibraryDocumentsMutation,
  useBulkUpdateLibraryDocumentsMutation,
  useDeleteLibraryDocumentMutation,
  useLibraryDocumentsQuery,
  useLibraryFoldersQuery,
  useSaveLibraryDocumentMutation,
  useUpdateLibraryDocumentMutation,
  useUploadLibraryFileMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useShortcuts } from './useShortcuts';
import { useDebounce } from '~/hooks/Input';
import ExportButtons from './ExportButtons';
import { libraryErrorKey } from './errors';
import PinnedViews from './PinnedViews';
import FeedsPanel from './FeedsPanel';
import InboxPanel from './InboxPanel';
import { useLocalize } from '~/hooks';
import Thumbnail from './Thumbnail';
import FolderBar from './FolderBar';
import { cn } from '~/utils';

const LOCATIONS: readonly TLibraryLocation[] = ['inbox', 'later', 'archive', 'feed'] as const;
const PAGE_SIZE = 50;

/** Written out so each label key is visible to the unused-key check. */
const SHORTCUTS = [
  { keys: 'j / k', label: 'com_library_shortcut_move' },
  { keys: 'o', label: 'com_library_shortcut_open' },
  { keys: 'x', label: 'com_library_shortcut_select' },
  { keys: 'e', label: 'com_library_shortcut_archive' },
  { keys: 'l', label: 'com_library_shortcut_later' },
  { keys: 'i', label: 'com_library_shortcut_inbox' },
  { keys: '#', label: 'com_library_shortcut_delete' },
  { keys: '/', label: 'com_library_shortcut_search' },
  { keys: 'Esc', label: 'com_library_shortcut_clear' },
] as const;

const LOCATION_LABEL = {
  inbox: 'com_library_tab_inbox',
  later: 'com_library_tab_later',
  archive: 'com_library_tab_archive',
  feed: 'com_library_tab_feed',
} as const;

const KIND_FILTERS = [
  { value: '', label: 'com_library_kind_all' },
  { value: 'article', label: 'com_library_kind_article' },
  { value: 'pdf', label: 'com_library_kind_pdf' },
  { value: 'epub', label: 'com_library_kind_epub' },
] as const;

const SORT_OPTIONS = [
  { value: 'updated', label: 'com_library_sort_updated' },
  { value: 'created', label: 'com_library_sort_created' },
  { value: 'title', label: 'com_library_sort_title' },
  { value: 'shortest', label: 'com_library_sort_shortest' },
  { value: 'longest', label: 'com_library_sort_longest' },
] as const;

function DocumentRow({
  document,
  folders,
  selected,
  active,
  onSelect,
  onDelete,
  onTag,
}: {
  document: TLibraryDocumentSummary;
  folders: TLibraryFolder[];
  selected: boolean;
  /** The row the keyboard shortcuts act on. */
  active: boolean;
  onSelect: (document: TLibraryDocumentSummary) => void;
  onDelete: (document: TLibraryDocumentSummary) => void;
  onTag: (tag: string) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const update = useUpdateLibraryDocumentMutation({
    onError: () =>
      showToast({
        message: localize('com_library_update_error'),
        status: NotificationSeverity.ERROR,
      }),
  });
  const move = (location: TLibraryLocation) =>
    update.mutate({ id: document.id, patch: { location } });
  const isBook = document.kind !== 'article';
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) {
      row.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [active]);
  const meta = [
    document.kind === 'pdf' ? localize('com_library_kind_pdf') : undefined,
    document.kind === 'epub' ? localize('com_library_kind_epub') : undefined,
    document.siteName ?? document.byline,
    isBook
      ? localize(document.kind === 'pdf' ? 'com_library_pages' : 'com_library_chapters', {
          0: document.unitCount,
        })
      : localize('com_library_minutes', { 0: Math.max(1, document.readingMinutes) }),
  ].filter(Boolean);

  return (
    <li
      ref={row}
      className={cn('flex items-start gap-3 px-4 py-3', active && 'bg-surface-secondary')}
      data-testid="library-row"
      aria-current={active ? 'true' : undefined}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onSelect(document)}
        aria-label={localize('com_library_select_row', { 0: document.title })}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <Thumbnail document={document} />
      <div className="min-w-0 flex-1">
        <Link
          to={`/library/${document.id}`}
          className="text-text-primary block truncate text-sm font-medium hover:underline"
        >
          {document.title}
        </Link>
        <p className="text-text-secondary truncate text-xs">{meta.join(' · ')}</p>
        {document.excerpt && (
          <p
            className="text-text-secondary line-clamp-2 pt-0.5 text-xs"
            data-testid="library-row-excerpt"
          >
            {document.excerpt}
          </p>
        )}
        {document.tags.length > 0 && (
          <p className="flex flex-wrap gap-1 pt-0.5">
            {document.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="bg-surface-secondary text-text-secondary hover:text-text-primary rounded-full px-2 py-0.5 text-xs"
                aria-label={localize('com_library_tag_filter', { 0: tag })}
                onClick={() => onTag(tag)}
              >
                {tag}
              </button>
            ))}
          </p>
        )}
        {document.needsOcr && (
          <p className="text-text-secondary text-xs">{localize('com_library_needs_ocr')}</p>
        )}
        {document.truncated && (
          <p className="text-text-secondary text-xs">{localize('com_library_truncated')}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {folders.length > 0 && (
          <select
            value={document.folderId ?? ''}
            onChange={(event) =>
              update.mutate({ id: document.id, patch: { folderId: event.target.value || null } })
            }
            aria-label={localize('com_library_folder_move', { 0: document.title })}
            className="border-border-medium bg-surface-primary text-text-secondary hidden max-w-32 rounded-md border px-1.5 py-1 text-xs sm:block"
          >
            <option value="">{localize('com_library_folder_none')}</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        )}
        {document.location !== 'inbox' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={localize('com_library_move_inbox')}
            onClick={() => move('inbox')}
          >
            <Inbox className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        {document.location !== 'later' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={localize('com_library_move_later')}
            onClick={() => move('later')}
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        {document.location !== 'archive' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={localize('com_library_move_archive')}
            onClick={() => move('archive')}
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={localize('com_ui_delete')}
          onClick={() => onDelete(document)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

/** Your saved reading: paste an address or upload a PDF or EPUB, then pick something to read. */
export default function LibraryView() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileInput = useRef<HTMLInputElement>(null);
  const [location, setLocation] = useState<TLibraryLocation>('inbox');
  const [search, setSearch] = useState('');
  const [address, setAddress] = useState('');
  const [tag, setTag] = useState('');
  const [folder, setFolder] = useState('');
  const [kind, setKind] = useState<TLibraryKind | ''>('');
  const [sort, setSort] = useState<TLibrarySort>('updated');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [toDelete, setToDelete] = useState<TLibraryDocumentSummary | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const query = useDebounce(search.trim(), 300);

  const documents = useLibraryDocumentsQuery(
    query
      ? { q: query, limit }
      : {
          location,
          tag: tag || undefined,
          folder: folder || undefined,
          kind: kind || undefined,
          sort,
          limit,
        },
    { keepPreviousData: true },
  );

  const folderList = useLibraryFoldersQuery().data?.folders ?? [];

  const fail = (error: unknown) =>
    showToast({
      message: localize(libraryErrorKey(error, 'com_library_save_error')),
      status: NotificationSeverity.ERROR,
    });
  const saved = (created: boolean) =>
    showToast({
      message: localize(created ? 'com_library_save_success' : 'com_library_save_again'),
      status: NotificationSeverity.SUCCESS,
    });

  const save = useSaveLibraryDocumentMutation({
    onSuccess: (data) => {
      setAddress('');
      saved(data.created);
    },
    onError: fail,
  });
  const upload = useUploadLibraryFileMutation({
    onSuccess: (data) => saved(data.created),
    onError: fail,
  });
  const remove = useDeleteLibraryDocumentMutation({
    onSuccess: () => setToDelete(null),
    onError: () =>
      showToast({
        message: localize('com_library_delete_error'),
        status: NotificationSeverity.ERROR,
      }),
  });

  const bulkDone = (result: { done: number; failed: number }) => {
    setSelected(new Set());
    if (result.failed > 0) {
      showToast({
        message: localize('com_library_bulk_error', { 0: result.failed }),
        status: NotificationSeverity.ERROR,
      });
    }
  };
  const bulkUpdate = useBulkUpdateLibraryDocumentsMutation({ onSuccess: bulkDone });
  const bulkRemove = useBulkDeleteLibraryDocumentsMutation({
    onSuccess: (result) => {
      setBulkDelete(false);
      bulkDone(result);
    },
  });
  const quickUpdate = useUpdateLibraryDocumentMutation({
    onError: () =>
      showToast({
        message: localize('com_library_update_error'),
        status: NotificationSeverity.ERROR,
      }),
  });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const url = address.trim();
    if (url) {
      save.mutate({ url, location: location === 'feed' ? 'inbox' : location });
    }
  };

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    const form = new FormData();
    form.append('file', file);
    form.append('location', location === 'feed' ? 'inbox' : location);
    upload.mutate(form);
  };

  /** Shows what a pinned view keeps, leaving any search behind. */
  const openView = (filter: TLibraryViewFilter) => {
    setSearch('');
    setLocation(filter.location ?? 'inbox');
    setKind(filter.kind ?? '');
    setTag(filter.tag ?? '');
    setFolder(filter.folder ?? '');
    setSort(filter.sort ?? 'updated');
    setLimit(PAGE_SIZE);
  };

  const rows = documents.data?.documents ?? [];
  const busy = save.isLoading || upload.isLoading;

  // A selection means nothing once the list it was made in is no longer on screen.
  useEffect(() => {
    setSelected(new Set());
    setActiveId(null);
  }, [location, query, tag, folder, kind, sort]);

  const activeIndex = rows.findIndex((row) => row.id === activeId);
  const active = activeIndex >= 0 ? rows[activeIndex] : undefined;
  const selectedIds = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
  const toggle = (document: TLibraryDocumentSummary) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(document.id)) {
        next.add(document.id);
      }
      return next;
    });
  const step = (by: number) => {
    if (rows.length === 0) {
      return;
    }
    const outside = by > 0 ? -1 : rows.length;
    const from = activeIndex >= 0 ? activeIndex : outside;
    const next = Math.min(Math.max(from + by, 0), rows.length - 1);
    setActiveId(rows[next].id);
  };
  /** After a row leaves the list, the cursor lands on its neighbour rather than vanishing. */
  const moveActive = (location: TLibraryLocation) => {
    if (!active || active.location === location) {
      return;
    }
    const neighbour = rows[activeIndex + 1] ?? rows[activeIndex - 1];
    quickUpdate.mutate({ id: active.id, patch: { location } });
    setActiveId(neighbour?.id ?? null);
  };

  useShortcuts(
    {
      j: () => step(1),
      k: () => step(-1),
      o: () => active && navigate(`/library/${active.id}`),
      x: () => active && toggle(active),
      e: () => moveActive('archive'),
      l: () => moveActive('later'),
      i: () => moveActive('inbox'),
      '#': () => active && setToDelete(active),
      '/': () => searchInput.current?.focus(),
      '?': () => setShowShortcuts((value) => !value),
      Escape: () => {
        setSelected(new Set());
        setActiveId(null);
        setShowShortcuts(false);
      },
    },
    toDelete == null && !bulkDelete,
  );

  let list: JSX.Element;
  if (documents.isLoading) {
    list = (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6" />
      </div>
    );
  } else if (documents.isError) {
    list = (
      <p className="text-text-secondary py-10 text-center text-sm">
        {localize('com_library_load_error')}
      </p>
    );
  } else if (rows.length === 0) {
    let emptyKey = 'com_library_empty_location' as const;
    if (query) {
      emptyKey = 'com_library_empty_search' as never;
    } else if (location === 'inbox') {
      emptyKey = 'com_library_empty' as never;
    }
    list = <p className="text-text-secondary py-10 text-center text-sm">{localize(emptyKey)}</p>;
  } else {
    list = (
      <>
        <ul className="divide-border-light border-border-light divide-y overflow-hidden rounded-xl border">
          {rows.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              folders={folderList}
              selected={selected.has(document.id)}
              active={document.id === activeId}
              onSelect={toggle}
              onDelete={setToDelete}
              onTag={setTag}
            />
          ))}
        </ul>
        {rows.length >= limit && (
          <div className="flex justify-center pt-3">
            <Button variant="outline" size="sm" onClick={() => setLimit(limit + PAGE_SIZE)}>
              {localize('com_library_show_more')}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="bg-surface-primary h-full w-full overflow-y-auto" data-testid="library-view">
      <div className="mx-auto max-w-5xl px-4 py-6 md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8">
        <nav
          aria-label={localize('com_library_title')}
          className="mb-4 flex flex-col gap-3 md:sticky md:top-6 md:mb-0 md:self-start"
        >
          <h1 className="text-text-primary text-xl font-semibold">
            {localize('com_library_title')}
          </h1>

          {!query && (
            <div
              role="group"
              aria-label={localize('com_library_title')}
              className="flex gap-2 md:flex-col md:gap-1"
            >
              {LOCATIONS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline-toggle"
                  aria-pressed={location === value}
                  className="min-w-0 flex-1 md:flex-none md:justify-start"
                  onClick={() => setLocation(value)}
                >
                  {localize(LOCATION_LABEL[value])}
                </Button>
              ))}
            </div>
          )}

          {!query && (
            <div
              role="group"
              aria-label={localize('com_library_kind_filter')}
              className="flex flex-wrap gap-1.5 md:flex-col md:gap-1"
            >
              {KIND_FILTERS.map(({ value, label }) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant="outline-toggle"
                  className="md:justify-start"
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
                >
                  {localize(label)}
                </Button>
              ))}
            </div>
          )}

          <Button asChild variant="outline" size="sm" className="md:justify-start">
            <Link to="/library/review">{localize('com_library_review_link')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="md:justify-start">
            <Link to="/library/ask">{localize('com_library_ask_library_link')}</Link>
          </Button>

          <PinnedViews
            current={{
              location,
              kind: kind || undefined,
              tag: tag || undefined,
              folder: folder || undefined,
              sort,
            }}
            canPin={!query}
            onOpen={openView}
          />
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <form onSubmit={onSubmit} className="flex gap-2">
            <Input
              type="url"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={localize('com_library_add_placeholder')}
              aria-label={localize('com_library_add_placeholder')}
              maxLength={2048}
              disabled={busy}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={busy || address.trim() === ''}>
              {save.isLoading ? <Spinner className="h-4 w-4" /> : localize('com_library_save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {upload.isLoading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{localize('com_library_upload')}</span>
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.epub,application/pdf,application/epub+zip"
              className="hidden"
              onChange={onFile}
              data-testid="library-upload-input"
              aria-label={localize('com_library_upload')}
            />
          </form>

          <Input
            ref={searchInput}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localize('com_library_search_placeholder')}
            aria-label={localize('com_library_search_placeholder')}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <ExportButtons />
            {!query && (
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as TLibrarySort)}
                aria-label={localize('com_library_sort')}
                className="border-border-medium bg-surface-primary text-text-secondary rounded-md border px-2 py-1.5 text-xs"
              >
                {SORT_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {localize(label)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {!query && location !== 'feed' && (
            <FolderBar folders={folderList} value={folder} onChange={setFolder} />
          )}

          {!query && tag && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              aria-label={localize('com_library_tag_filter_clear', { 0: tag })}
              onClick={() => setTag('')}
            >
              {tag}
              <X className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}

          {!query && location === 'feed' && (
            <>
              <FeedsPanel />
              <InboxPanel />
            </>
          )}

          {rows.length > 0 && (
            <div
              role="toolbar"
              aria-label={localize('com_library_bulk_toolbar')}
              className="flex flex-wrap items-center gap-2 text-sm"
              data-testid="library-bulk-toolbar"
            >
              <label className="text-text-secondary flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.length === rows.length}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked ? new Set(rows.map((row) => row.id)) : new Set(),
                    )
                  }
                  aria-label={localize('com_library_select_all')}
                  className="h-4 w-4"
                />
                {selectedIds.length > 0
                  ? localize('com_library_selected_count', { 0: selectedIds.length })
                  : localize('com_library_select_all')}
              </label>
              {selectedIds.length > 0 && (
                <>
                  {(['inbox', 'later', 'archive'] as const).map((target) => (
                    <Button
                      key={target}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={bulkUpdate.isLoading}
                      onClick={() => bulkUpdate.mutate({ ids: selectedIds, location: target })}
                    >
                      {localize(LOCATION_LABEL[target])}
                    </Button>
                  ))}
                  {folderList.length > 0 && (
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value !== '') {
                          bulkUpdate.mutate({
                            ids: selectedIds,
                            folderId: event.target.value === '__none' ? null : event.target.value,
                          });
                        }
                      }}
                      aria-label={localize('com_library_bulk_folder')}
                      className="border-border-medium bg-surface-primary text-text-secondary rounded-md border px-2 py-1 text-xs"
                    >
                      <option value="">{localize('com_library_bulk_folder')}</option>
                      <option value="__none">{localize('com_library_folder_none')}</option>
                      {folderList.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={bulkRemove.isLoading}
                    onClick={() => setBulkDelete(true)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {localize('com_ui_delete')}
                  </Button>
                </>
              )}
              <button
                type="button"
                className="text-text-secondary hover:text-text-primary ml-auto text-xs underline"
                aria-expanded={showShortcuts}
                onClick={() => setShowShortcuts((value) => !value)}
              >
                {localize('com_library_shortcuts')}
              </button>
            </div>
          )}

          {showShortcuts && (
            <dl
              className="bg-surface-secondary grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg px-3 py-2 text-xs"
              data-testid="library-shortcuts"
            >
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut.keys} className="contents">
                  <dt className="text-text-primary font-mono">{shortcut.keys}</dt>
                  <dd className="text-text-secondary">{localize(shortcut.label)}</dd>
                </div>
              ))}
            </dl>
          )}

          {list}
        </div>
      </div>

      <OGDialog open={toDelete != null} onOpenChange={(open) => !open && setToDelete(null)}>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_library_delete_title')}
          className="w-11/12 max-w-lg"
          main={
            <p className="text-text-primary text-left text-sm">
              {localize('com_library_delete_confirm', { 0: toDelete?.title ?? '' })}
            </p>
          }
          selection={{
            selectHandler: () => toDelete && remove.mutate({ id: toDelete.id }),
            selectClasses:
              'bg-surface-destructive hover:bg-surface-destructive-hover text-text-on-status',
            selectText: localize('com_ui_delete'),
          }}
        />
      </OGDialog>

      <OGDialog open={bulkDelete} onOpenChange={setBulkDelete}>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_library_bulk_delete_title')}
          className="w-11/12 max-w-lg"
          main={
            <p className="text-text-primary text-left text-sm">
              {localize('com_library_bulk_delete_confirm', { 0: selectedIds.length })}
            </p>
          }
          selection={{
            selectHandler: () => bulkRemove.mutate({ ids: selectedIds }),
            selectClasses:
              'bg-surface-destructive hover:bg-surface-destructive-hover text-text-on-status',
            selectText: localize('com_ui_delete'),
          }}
        />
      </OGDialog>
    </div>
  );
}
