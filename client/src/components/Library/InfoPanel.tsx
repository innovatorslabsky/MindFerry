import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button, Input, useToastContext } from '@librechat/client';
import type { TLibraryDocumentSummary } from 'librechat-data-provider';
import { useUpdateLibraryDocumentMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import NoteField from './NoteField';

export const MAX_SUMMARY_LENGTH = 2000;
const MAX_TITLE_LENGTH = 300;
const MAX_AUTHOR_LENGTH = 200;

/**
 * A date the page gave us, shown in the reader's own format when it is written as a year-month-day.
 * Anything looser is shown as it was written, since a browser would read "spring 2024" as January.
 */
export function formatDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

/** Only an address a browser may open as a link is made one. */
export function webAddress(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function Detail({ label, children }: { label: string; children?: React.ReactNode }) {
  if (children == null || children === '') {
    return null;
  }
  return (
    <div className="flex gap-3 py-1 text-sm">
      <dt className="text-text-secondary w-20 shrink-0">{label}</dt>
      <dd className="text-text-primary min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

function MetadataForm({
  document,
  onDone,
}: {
  document: TLibraryDocumentSummary;
  onDone: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [title, setTitle] = useState(document.title);
  const [author, setAuthor] = useState(document.byline ?? '');
  const update = useUpdateLibraryDocumentMutation({
    onSuccess: onDone,
    onError: () =>
      showToast({
        message: localize('com_library_edit_error'),
        status: NotificationSeverity.ERROR,
      }),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }
    update.mutate({
      id: document.id,
      patch: { title: nextTitle, byline: author.trim() === '' ? null : author.trim() },
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid="library-metadata-form">
      <label className="text-text-secondary flex flex-col gap-1 text-xs">
        {localize('com_library_meta_title')}
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={MAX_TITLE_LENGTH}
        />
      </label>
      <label className="text-text-secondary flex flex-col gap-1 text-xs">
        {localize('com_library_meta_author')}
        <Input
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          maxLength={MAX_AUTHOR_LENGTH}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={update.isLoading || title.trim() === ''}>
          {localize('com_library_meta_save')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          {localize('com_ui_cancel')}
        </Button>
      </div>
    </form>
  );
}

/** What is known about a document: the summary the person keeps, where it came from, how long it is. */
export default function InfoPanel({ document }: { document: TLibraryDocumentSummary }) {
  const localize = useLocalize();
  const [editing, setEditing] = useState(false);
  const source = webAddress(document.normalizedUrl);
  const kindLabel = {
    article: 'com_library_kind_article_one',
    pdf: 'com_library_kind_pdf',
    epub: 'com_library_kind_epub',
  } as const;
  const length =
    document.kind === 'article'
      ? localize('com_library_length_article', {
          0: Math.max(1, document.readingMinutes),
          1: document.wordCount.toLocaleString(),
        })
      : localize('com_library_length_book', {
          0: document.unitCount,
          1: Math.max(1, document.readingMinutes),
        });

  return (
    <div
      className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-3"
      data-testid="library-info"
    >
      <section className="flex flex-col gap-1.5">
        <h3 className="text-text-primary text-sm font-semibold">
          {localize('com_library_summary')}
        </h3>
        <NoteField
          key={`${document.id}:${document.summary ?? ''}`}
          documentId={document.id}
          field="summary"
          value={document.summary ?? ''}
          maxLength={MAX_SUMMARY_LENGTH}
          label={localize('com_library_summary')}
          placeholder={localize('com_library_summary_placeholder')}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-text-primary text-sm font-semibold">
            {localize('com_library_details')}
          </h3>
          {!editing && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {localize('com_library_edit_metadata')}
            </Button>
          )}
        </div>
        {editing ? (
          <MetadataForm document={document} onDone={() => setEditing(false)} />
        ) : (
          <dl>
            <Detail label={localize('com_library_detail_type')}>
              {localize(kindLabel[document.kind])}
            </Detail>
            <Detail label={localize('com_library_detail_site')}>{document.siteName}</Detail>
            <Detail label={localize('com_library_detail_author')}>{document.byline}</Detail>
            <Detail label={localize('com_library_detail_published')}>
              {formatDate(document.publishedTime)}
            </Detail>
            <Detail label={localize('com_library_detail_length')}>{length}</Detail>
            <Detail label={localize('com_library_detail_saved')}>
              {formatDate(document.createdAt)}
            </Detail>
            {source && (
              <Detail label={localize('com_library_detail_source')}>
                <a
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-text-primary underline"
                >
                  {new URL(source).host}
                </a>
              </Detail>
            )}
          </dl>
        )}
      </section>
    </div>
  );
}
