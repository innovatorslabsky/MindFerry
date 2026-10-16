import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, BookOpen, Clock, FileText, Inbox, Trash2, Upload } from 'lucide-react';
import {
  Input,
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TLibraryDocumentSummary, TLibraryLocation } from 'librechat-data-provider';
import {
  useDeleteLibraryDocumentMutation,
  useLibraryDocumentsQuery,
  useSaveLibraryDocumentMutation,
  useUpdateLibraryDocumentMutation,
  useUploadLibraryFileMutation,
} from '~/data-provider';
import { libraryErrorKey } from './errors';
import { NotificationSeverity } from '~/common';
import { useDebounce } from '~/hooks/Input';
import { useLocalize } from '~/hooks';

const LOCATIONS: readonly TLibraryLocation[] = ['inbox', 'later', 'archive'] as const;
const PAGE_SIZE = 50;

const LOCATION_LABEL = {
  inbox: 'com_library_tab_inbox',
  later: 'com_library_tab_later',
  archive: 'com_library_tab_archive',
  feed: 'com_library_tab_feed',
} as const;

function DocumentRow({
  document,
  onDelete,
}: {
  document: TLibraryDocumentSummary;
  onDelete: (document: TLibraryDocumentSummary) => void;
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
    <li className="flex items-start gap-3 px-4 py-3" data-testid="library-row">
      <div className="text-text-secondary mt-0.5 shrink-0">
        {isBook ? (
          <BookOpen className="h-5 w-5" aria-hidden="true" />
        ) : (
          <FileText className="h-5 w-5" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          to={`/library/${document.id}`}
          className="text-text-primary block truncate text-sm font-medium hover:underline"
        >
          {document.title}
        </Link>
        <p className="text-text-secondary truncate text-xs">{meta.join(' · ')}</p>
        {document.needsOcr && (
          <p className="text-text-secondary text-xs">{localize('com_library_needs_ocr')}</p>
        )}
        {document.truncated && (
          <p className="text-text-secondary text-xs">{localize('com_library_truncated')}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
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
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [toDelete, setToDelete] = useState<TLibraryDocumentSummary | null>(null);
  const query = useDebounce(search.trim(), 300);

  const documents = useLibraryDocumentsQuery(query ? { q: query, limit } : { location, limit }, {
    keepPreviousData: true,
  });

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

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const url = address.trim();
    if (url) {
      save.mutate({ url, location });
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
    form.append('location', location);
    upload.mutate(form);
  };

  const rows = documents.data?.documents ?? [];
  const busy = save.isLoading || upload.isLoading;

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
            <DocumentRow key={document.id} document={document} onDelete={setToDelete} />
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
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className="text-text-primary text-xl font-semibold">{localize('com_library_title')}</h1>

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
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={localize('com_library_search_placeholder')}
          aria-label={localize('com_library_search_placeholder')}
        />

        {!query && (
          <div role="group" aria-label={localize('com_library_title')} className="flex gap-2">
            {LOCATIONS.map((value) => (
              <Button
                key={value}
                type="button"
                variant="outline-toggle"
                aria-pressed={location === value}
                className="min-w-0 flex-1"
                onClick={() => setLocation(value)}
              >
                {localize(LOCATION_LABEL[value])}
              </Button>
            ))}
          </div>
        )}

        {list}
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
    </div>
  );
}
