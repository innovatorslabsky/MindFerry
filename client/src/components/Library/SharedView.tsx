import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@librechat/client';
import { useParams } from 'react-router-dom';
import { librarySharedResource } from 'librechat-data-provider';
import type { TLibraryHighlight, TLibrarySharedHighlight } from 'librechat-data-provider';
import { useLibrarySharedQuery, useLibrarySharedUnitQuery } from '~/data-provider';
import { paintHighlights, releaseHighlights } from '~/utils/libraryAnchors';
import { useLocalize } from '~/hooks';

/** The painter wants a whole highlight; a visitor's has no note, tags or dates, which it never reads. */
const toHighlight = (highlight: TLibrarySharedHighlight): TLibraryHighlight => ({
  ...highlight,
  documentId: '',
  tags: [],
  createdAt: '',
  updatedAt: '',
});

/** Keeps search engines and archives away from a page that was shared by link, not published. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);
}

function Text({
  token,
  html,
  plain,
  highlights,
}: {
  token: string;
  html?: string;
  plain?: string;
  highlights: readonly TLibrarySharedHighlight[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const painted = useMemo(() => highlights.map(toHighlight), [highlights]);

  useEffect(() => {
    const node = root.current;
    if (!node) {
      return;
    }
    // A book's pictures are public with the link, so they load as they are.
    for (const image of Array.from(node.querySelectorAll('img[data-epub-resource]'))) {
      const path = image.getAttribute('data-epub-resource');
      if (path && !image.getAttribute('src')) {
        image.setAttribute('src', librarySharedResource(token, path));
      }
    }
    paintHighlights(node, painted);
    return releaseHighlights;
  }, [token, html, plain, painted]);

  return html != null ? (
    <div
      ref={root}
      className="library-prose mx-auto max-w-2xl px-4 pb-24"
      data-testid="shared-content"
      // The server sanitized this with an allow-list, as it does for the owner.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <div
      ref={root}
      className="library-prose mx-auto max-w-2xl px-4 pb-24 whitespace-pre-wrap"
      data-testid="shared-content"
    >
      {plain}
    </div>
  );
}

/** What a visitor sees at a public link: one document, read-only, with no account and no sidebar. */
export default function SharedView() {
  const localize = useLocalize();
  const { token = '' } = useParams();
  useNoIndex();
  const { data, isLoading, isError } = useLibrarySharedQuery(token);
  const [unitIndex, setUnitIndex] = useState(0);
  const units = data?.units;
  const unitQuery = useLibrarySharedUnitQuery(token, units ? unitIndex : undefined);

  useEffect(() => {
    if (data?.document.title) {
      document.title = data.document.title;
    }
  }, [data?.document.title]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div
        className="text-text-secondary flex min-h-screen items-center justify-center px-4 text-center"
        data-testid="shared-missing"
      >
        {localize('com_library_share_missing')}
      </div>
    );
  }

  const { document: doc, notice, reportEmail } = data;
  const isBook = units != null;
  const unit = unitQuery.data?.unit;
  const shownHighlights = isBook ? (unitQuery.data?.highlights ?? []) : data.highlights;

  return (
    <div className="bg-surface-primary text-text-primary min-h-screen overflow-y-auto">
      {notice && (
        <p
          className="bg-surface-secondary text-text-secondary px-4 py-2 text-center text-xs"
          role="note"
          data-testid="shared-notice"
        >
          {notice}
        </p>
      )}
      <header className="mx-auto max-w-2xl px-4 pt-10 pb-6">
        <h1 className="text-2xl font-semibold">{doc.title}</h1>
        <p className="text-text-secondary mt-2 text-sm">
          {[doc.byline, doc.siteName, localize('com_library_minutes', { 0: doc.readingMinutes })]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {doc.sourceUrl && (
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-text-secondary mt-1 block truncate text-xs underline"
          >
            {localize('com_library_share_original')}
          </a>
        )}
        {isBook && units.length > 1 && (
          <div className="mt-4 flex items-center gap-2">
            <select
              value={unitIndex}
              onChange={(event) => setUnitIndex(Number(event.target.value))}
              aria-label={localize('com_library_share_section')}
              className="border-border-medium bg-surface-primary min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm"
              data-testid="shared-unit-select"
            >
              {units.map((entry) => (
                <option key={entry.index} value={entry.index}>
                  {entry.title ??
                    `${entry.kind === 'page' ? 'Page' : 'Chapter'} ${entry.index + 1}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={unitIndex <= 0}
              onClick={() => setUnitIndex(unitIndex - 1)}
              className="border-border-medium rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
            >
              {localize('com_ui_prev')}
            </button>
            <button
              type="button"
              disabled={unitIndex >= units.length - 1}
              onClick={() => setUnitIndex(unitIndex + 1)}
              className="border-border-medium rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
            >
              {localize('com_ui_next')}
            </button>
          </div>
        )}
      </header>
      {isBook && unit == null && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {isBook && unit != null && (
        <Text
          key={unit.index}
          token={token}
          html={unit.contentHtml || undefined}
          plain={unit.contentHtml ? undefined : unit.text}
          highlights={shownHighlights}
        />
      )}
      {!isBook && (
        <Text
          token={token}
          html={doc.contentHtml}
          plain={doc.contentHtml ? undefined : doc.text}
          highlights={shownHighlights}
        />
      )}
      <footer className="text-text-secondary mx-auto max-w-2xl px-4 pb-10 text-center text-xs">
        {reportEmail && (
          <a href={`mailto:${reportEmail}`} className="underline" data-testid="shared-report">
            {localize('com_library_share_report')}
          </a>
        )}
      </footer>
    </div>
  );
}
