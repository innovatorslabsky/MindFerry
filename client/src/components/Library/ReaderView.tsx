import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Highlighter, List, X } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type {
  TLibraryDocumentSummary,
  TLibraryHighlight,
  TLibraryProgress,
  TLibraryUnitSummary,
} from 'librechat-data-provider';
import type { CSSProperties } from 'react';
import {
  useDeleteLibrarySourceMutation,
  useUpdateLibraryDocumentMutation,
  useLibraryDocumentQuery,
  useLibraryUnitQuery,
} from '~/data-provider';
import ReaderBody, { type ReaderBodyHandle } from './ReaderBody';
import { NotificationSeverity } from '~/common';
import HighlightsPanel from './HighlightsPanel';
import { useShortcuts } from './useShortcuts';
import PdfPageView from './PdfPageView';
import AskButtons from './AskButtons';
import { useLocalize } from '~/hooks';
import TagEditor from './TagEditor';
import OcrPanel from './OcrPanel';
import { cn } from '~/utils';

const EMPTY: readonly TLibraryHighlight[] = [];

/** Only a position recorded against exactly this text still means anything. */
function resumeOffset(progress: TLibraryProgress | null, hash: string, unit?: number): number {
  if (!progress || progress.contentHash !== hash || progress.unitIndex !== unit) {
    return 0;
  }
  return progress.textOffset;
}

function Contents({
  document,
  units,
  current,
  onSelect,
}: {
  document: TLibraryDocumentSummary;
  units: TLibraryUnitSummary[];
  current: number;
  onSelect: (index: number) => void;
}) {
  const localize = useLocalize();
  const unitLabel = (unit: TLibraryUnitSummary) =>
    localize(unit.kind === 'page' ? 'com_library_unit_page' : 'com_library_unit_chapter', {
      0: unit.index + 1,
    });
  const entries =
    document.toc.length > 0
      ? document.toc.map((entry) => ({
          key: `${entry.depth}-${entry.title}-${entry.unitIndex ?? 'x'}-${entry.fragment ?? ''}`,
          title: entry.title,
          depth: entry.depth,
          index: entry.unitIndex,
        }))
      : units.map((unit) => ({
          key: String(unit.index),
          title: unit.title || unitLabel(unit),
          depth: 0,
          index: unit.index,
        }));
  return (
    <nav aria-label={localize('com_library_contents')} className="flex h-full flex-col">
      <h2 className="text-text-primary border-border-light border-b px-3 py-3 text-sm font-semibold">
        {localize('com_library_contents')}
      </h2>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {entries.map((entry) => (
          <li key={entry.key}>
            <button
              type="button"
              disabled={entry.index == null}
              onClick={() => entry.index != null && onSelect(entry.index)}
              aria-current={entry.index === current ? 'true' : undefined}
              className={cn(
                'hover:bg-surface-hover w-full truncate py-1.5 pr-3 pl-(--indent) text-left text-sm disabled:opacity-50',
                entry.index === current ? 'text-text-primary font-medium' : 'text-text-secondary',
              )}
              style={{ '--indent': `${0.75 + entry.depth * 0.75}rem` } as CSSProperties}
            >
              {entry.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One document: an article, or a book read a chapter or page at a time. */
export default function ReaderView() {
  const localize = useLocalize();
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const handle = useRef<ReaderBodyHandle | null>(null);
  /** On a narrow screen the contents and highlights are a sheet over the text instead of side columns. */
  const [sheet, setSheet] = useState<'contents' | 'highlights' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { showToast } = useToastContext();
  const removeSource = useDeleteLibrarySourceMutation({
    onSuccess: () => setConfirmRemove(false),
    onError: () =>
      showToast({
        message: localize('com_library_source_remove_error'),
        status: NotificationSeverity.ERROR,
      }),
  });
  const registerHandle = useCallback((next: ReaderBodyHandle | null) => {
    handle.current = next;
  }, []);
  const navigate = useNavigate();
  const update = useUpdateLibraryDocumentMutation({
    onSuccess: () => navigate('/library'),
    onError: () =>
      showToast({
        message: localize('com_library_update_error'),
        status: NotificationSeverity.ERROR,
      }),
  });

  const documentQuery = useLibraryDocumentQuery(id);
  const data = documentQuery.data;
  const document = data?.document;
  const isBook = document != null && document.kind !== 'article';
  const units = data?.units;

  const requested = Number.parseInt(params.get('unit') ?? '', 10);
  const lastUnit = Math.max(0, (document?.unitCount ?? 1) - 1);
  const savedUnit = data?.progress?.unitIndex;
  const unitIndex = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 0), lastUnit)
    : Math.min(savedUnit ?? 0, lastUnit);
  const unitQuery = useLibraryUnitQuery(id, isBook ? unitIndex : undefined);
  /** A PDF whose original is stored can be read as the page itself instead of as text. */
  const pageView = params.get('view') === 'page' && document?.hasSource === true;
  const selectUnit = (index: number) => {
    setParams(pageView ? { unit: String(index), view: 'page' } : { unit: String(index) }, {
      replace: true,
    });
    setSheet(null);
  };

  const highlights = useMemo(() => {
    if (!data) {
      return EMPTY;
    }
    return isBook ? (unitQuery.data?.highlights ?? EMPTY) : data.highlights;
  }, [data, isBook, unitQuery.data]);

  useShortcuts({
    h: () => handle.current?.highlightSelection(),
    e: () => id && update.mutate({ id, patch: { location: 'archive' } }),
    l: () => id && update.mutate({ id, patch: { location: 'later' } }),
    u: () => navigate('/library'),
    n: () => isBook && unitIndex < lastUnit && selectUnit(unitIndex + 1),
    p: () => isBook && unitIndex > 0 && selectUnit(unitIndex - 1),
  });

  const onFocus = useCallback((highlight: TLibraryHighlight) => {
    handle.current?.focusHighlight(highlight);
    setSheet(null);
  }, []);

  if (documentQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (documentQuery.isError || !document || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-text-secondary text-sm">{localize('com_library_not_found')}</p>
        <Button asChild variant="outline">
          <Link to="/library">{localize('com_library_back')}</Link>
        </Button>
      </div>
    );
  }

  const unit = isBook ? unitQuery.data?.unit : undefined;
  const isPdf = document.kind === 'pdf';
  const isOriginalLink = /^https?:\/\//i.test(document.normalizedUrl);

  let body: JSX.Element;
  if (isPdf && pageView) {
    body = <PdfPageView documentId={document.id} pageIndex={unitIndex} />;
  } else if (!isBook && 'contentHtml' in document) {
    body = (
      <ReaderBody
        documentId={document.id}
        html={document.contentHtml}
        anchorText={document.text}
        contentHash={document.contentHash}
        highlights={highlights}
        resumeAt={resumeOffset(data.progress, document.contentHash)}
        registerHandle={registerHandle}
      />
    );
  } else if (!unit) {
    body = (
      <div className="flex h-full items-center justify-center">
        {unitQuery.isError ? (
          <p className="text-text-secondary text-sm">{localize('com_library_load_error')}</p>
        ) : (
          <Spinner className="h-6 w-6" />
        )}
      </div>
    );
  } else if (isPdf) {
    body = (
      <ReaderBody
        key={`${document.id}:${unit.index}`}
        documentId={document.id}
        plainText={unit.text}
        anchorText={unit.text}
        contentHash={unit.contentHash}
        highlights={highlights}
        unit={{ kind: 'page', index: unit.index }}
        resumeAt={resumeOffset(data.progress, unit.contentHash, unit.index)}
        registerHandle={registerHandle}
      />
    );
  } else {
    body = (
      <ReaderBody
        key={`${document.id}:${unit.index}`}
        documentId={document.id}
        html={unit.contentHtml}
        anchorText={unit.text}
        contentHash={unit.contentHash}
        highlights={highlights}
        unit={{ kind: 'chapter', index: unit.index }}
        resumeAt={resumeOffset(data.progress, unit.contentHash, unit.index)}
        registerHandle={registerHandle}
      />
    );
  }

  return (
    <div
      className="bg-surface-primary flex h-full min-h-0 w-full flex-col"
      data-testid="library-reader"
    >
      <header className="border-border-light flex items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          <Link to="/library" aria-label={localize('com_library_back')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-text-primary truncate text-sm font-semibold">{document.title}</h1>
          <p className="text-text-secondary truncate text-xs">
            {[document.siteName, document.byline].filter(Boolean).join(' · ')}
          </p>
        </div>
        {isBook && units && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 md:hidden"
            aria-label={localize('com_library_contents')}
            aria-expanded={sheet === 'contents'}
            onClick={() => setSheet(sheet === 'contents' ? null : 'contents')}
          >
            <List className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 lg:hidden"
          aria-label={localize('com_library_highlights')}
          aria-expanded={sheet === 'highlights'}
          onClick={() => setSheet(sheet === 'highlights' ? null : 'highlights')}
        >
          <Highlighter className="h-4 w-4" aria-hidden="true" />
        </Button>
        <AskButtons documentId={document.id} kind={document.kind} unitIndex={unitIndex} />
        {isOriginalLink && (
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <a href={document.normalizedUrl} target="_blank" rel="noopener noreferrer nofollow">
              <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {localize('com_library_open_original')}
            </a>
          </Button>
        )}
      </header>
      <TagEditor documentId={document.id} tags={document.tags} />
      <div className="flex min-h-0 flex-1">
        {isBook && units && (
          <aside className="border-border-light hidden w-60 shrink-0 border-r md:block">
            <Contents document={document} units={units} current={unitIndex} onSelect={selectUnit} />
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col py-6">
          {isBook && document.needsOcr && (
            <p className="text-text-secondary bg-surface-secondary mx-auto mb-4 max-w-2xl rounded-lg px-3 py-2 text-sm">
              {localize('com_library_needs_ocr')}
            </p>
          )}
          {isPdf && document.hasSource && units && (
            <OcrPanel
              documentId={document.id}
              blankPages={units.filter((page) => page.wordCount === 0).map((page) => page.index)}
              currentPage={unitIndex}
              documentLang={document.lang}
            />
          )}
          {isPdf && document.hasSource && (
            <div
              role="group"
              aria-label={localize('com_library_view')}
              className="mx-auto mb-3 flex w-full max-w-2xl items-center gap-2 px-4"
            >
              {(['text', 'page'] as const).map((view) => (
                <Button
                  key={view}
                  type="button"
                  variant="outline-toggle"
                  size="sm"
                  aria-pressed={(view === 'page') === pageView}
                  onClick={() =>
                    setParams(
                      view === 'page'
                        ? { unit: String(unitIndex), view: 'page' }
                        : { unit: String(unitIndex) },
                      { replace: true },
                    )
                  }
                >
                  {localize(view === 'page' ? 'com_library_view_page' : 'com_library_view_text')}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setConfirmRemove(true)}
              >
                {localize('com_library_source_remove')}
              </Button>
            </div>
          )}
          {isPdf && pageView && (
            <p className="text-text-secondary mx-auto mb-2 w-full max-w-2xl px-4 text-xs">
              {localize('com_library_page_view_note')}
            </p>
          )}
          <div className="min-h-0 flex-1">{body}</div>
          {isBook && (
            <div className="border-border-light mx-auto mt-2 flex w-full max-w-2xl items-center justify-between border-t px-4 pt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={unitIndex <= 0}
                onClick={() => selectUnit(unitIndex - 1)}
              >
                {localize('com_library_previous')}
              </Button>
              <span className="text-text-secondary text-xs">
                {localize(isPdf ? 'com_library_unit_page' : 'com_library_unit_chapter', {
                  0: unitIndex + 1,
                })}{' '}
                / {document.unitCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={unitIndex >= lastUnit}
                onClick={() => selectUnit(unitIndex + 1)}
              >
                {localize('com_library_next')}
              </Button>
            </div>
          )}
        </main>
        <aside className="border-border-light hidden w-72 shrink-0 border-l lg:block">
          <HighlightsPanel documentId={document.id} highlights={highlights} onFocus={onFocus} />
        </aside>
      </div>
      <OGDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_library_source_remove')}
          className="w-11/12 max-w-lg"
          main={
            <p className="text-text-primary text-left text-sm">
              {localize('com_library_source_remove_confirm')}
            </p>
          }
          selection={{
            selectHandler: () => removeSource.mutate({ id: document.id }),
            selectClasses:
              'bg-surface-destructive hover:bg-surface-destructive-hover text-text-on-status',
            selectText: localize('com_library_source_remove'),
          }}
        />
      </OGDialog>
      {sheet != null && (
        <div
          role="dialog"
          aria-label={localize(
            sheet === 'contents' ? 'com_library_contents' : 'com_library_highlights',
          )}
          className={cn(
            'border-border-medium bg-surface-primary fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] min-h-[40vh] flex-col rounded-t-xl border-t shadow-xl',
            // The side columns take over at these widths, so the sheet must not be a second copy.
            sheet === 'contents' ? 'md:hidden' : 'lg:hidden',
          )}
          data-testid="library-sheet"
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1 right-1 h-8 w-8"
            aria-label={localize('com_ui_close')}
            onClick={() => setSheet(null)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
          {sheet === 'contents' && isBook && units ? (
            <Contents document={document} units={units} current={unitIndex} onSelect={selectUnit} />
          ) : (
            <HighlightsPanel documentId={document.id} highlights={highlights} onFocus={onFocus} />
          )}
        </div>
      )}
    </div>
  );
}
