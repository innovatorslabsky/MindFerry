import { useRef, useState } from 'react';
import { BookPlus, Upload } from 'lucide-react';
import {
  Button,
  Input,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TLibraryReadingStatus } from 'librechat-data-provider';
import { useAddLibraryBookMutation, useImportLibraryGoodreadsMutation } from '~/data-provider';
import { READING_STATUS_LABEL, READING_STATUSES } from './readingStatus';
import { NotificationSeverity } from '~/common';
import { libraryErrorKey } from './errors';
import { useLocalize } from '~/hooks';

const MAX_PAGES = 20_000;

function AddBookForm({ onDone }: { onDone: () => void }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [status, setStatus] = useState<TLibraryReadingStatus>('reading');
  const add = useAddLibraryBookMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_library_add_book_done'),
        status: NotificationSeverity.SUCCESS,
      });
      onDone();
    },
    onError: () =>
      showToast({
        message: localize('com_library_add_book_error'),
        status: NotificationSeverity.ERROR,
      }),
  });

  const count = pages.trim() === '' ? undefined : Number(pages);
  const pagesOk =
    count === undefined || (Number.isInteger(count) && count >= 1 && count <= MAX_PAGES);
  const valid = title.trim() !== '' && pagesOk;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    add.mutate({
      title: title.trim(),
      ...(author.trim() ? { byline: author.trim() } : {}),
      ...(count ? { pages: count } : {}),
      readingStatus: status,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 text-left"
      data-testid="library-add-book"
    >
      <label className="text-text-secondary flex flex-col gap-1 text-xs">
        {localize('com_library_add_book_title')}
        <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} />
      </label>
      <label className="text-text-secondary flex flex-col gap-1 text-xs">
        {localize('com_library_add_book_author')}
        <Input value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={200} />
      </label>
      <label className="text-text-secondary flex flex-col gap-1 text-xs">
        {localize('com_library_add_book_pages')}
        <Input
          type="number"
          min={1}
          max={MAX_PAGES}
          value={pages}
          onChange={(event) => setPages(event.target.value)}
        />
      </label>
      <label className="text-text-secondary flex flex-col gap-1 text-xs">
        {localize('com_library_status')}
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as TLibraryReadingStatus)}
          className="border-border-medium bg-surface-primary text-text-primary rounded-lg border px-2 py-1.5 text-sm"
        >
          {READING_STATUSES.map((value) => (
            <option key={value} value={value}>
              {localize(READING_STATUS_LABEL[value])}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!valid || add.isLoading}>
          {add.isLoading && <Spinner className="mr-1.5 h-4 w-4" />}
          {localize('com_library_add_book_save')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          {localize('com_ui_cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Ways to bring in books that are not files: add one by hand, or import a Goodreads export. */
export default function BooksTools() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const file = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const importer = useImportLibraryGoodreadsMutation({
    onSuccess: ({ created, existing }) =>
      showToast({
        message: localize('com_library_goodreads_done', { 0: created, 1: existing }),
        status: NotificationSeverity.SUCCESS,
      }),
    onError: (error) =>
      showToast({
        message: localize(libraryErrorKey(error, 'com_library_goodreads_error')),
        status: NotificationSeverity.ERROR,
      }),
  });

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) {
      return;
    }
    const form = new FormData();
    form.append('file', chosen);
    importer.mutate(form);
  };

  return (
    <div className="flex flex-wrap gap-2" data-testid="library-books-tools">
      <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
        <BookPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {localize('com_library_add_book')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={importer.isLoading}
        title={localize('com_library_goodreads_hint')}
        onClick={() => file.current?.click()}
      >
        {importer.isLoading ? (
          <Spinner className="mr-1.5 h-4 w-4" />
        ) : (
          <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
        )}
        {localize('com_library_goodreads_import')}
      </Button>
      <input
        ref={file}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onFile}
        data-testid="library-goodreads-file"
      />
      <OGDialog open={adding} onOpenChange={setAdding}>
        <OGDialogTemplate
          showCloseButton={true}
          title={localize('com_library_add_book')}
          className="w-11/12 max-w-md"
          main={<AddBookForm onDone={() => setAdding(false)} />}
        />
      </OGDialog>
    </div>
  );
}
