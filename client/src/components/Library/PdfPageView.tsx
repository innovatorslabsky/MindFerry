import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@librechat/client';
import { useLibrarySourceQuery } from '~/data-provider';
import { openPdfPages } from '~/utils/pdfPages';
import type { PdfPages } from '~/utils/pdfPages';
import { useLocalize } from '~/hooks';

const MAX_WIDTH = 900;

/** One page of the stored original, drawn as the page itself. Highlights are made in the text view. */
export default function PdfPageView({
  documentId,
  pageIndex,
}: {
  documentId: string;
  pageIndex: number;
}) {
  const localize = useLocalize();
  const source = useLibrarySourceQuery(documentId);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PdfPages | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const blob = source.data;
    if (!blob) {
      return;
    }
    let opened: PdfPages | undefined;
    let stale = false;
    setFailed(false);
    blob
      .arrayBuffer()
      .then((buffer) => openPdfPages(buffer))
      .then((pages) => {
        if (stale) {
          pages.destroy();
          return;
        }
        opened = pages;
        setPdf(pages);
      })
      .catch(() => !stale && setFailed(true));
    return () => {
      stale = true;
      setPdf(null);
      opened?.destroy();
    };
  }, [source.data]);

  useEffect(() => {
    const element = frame.current;
    if (!element) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => setWidth(Math.min(MAX_WIDTH, Math.floor(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 150);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!pdf || !canvas.current || width <= 0 || pageIndex >= pdf.numPages) {
      return;
    }
    const job = pdf.render(pageIndex + 1, canvas.current, width);
    job.promise.catch(() => setFailed(true));
    return () => job.cancel();
  }, [pdf, pageIndex, width]);

  const loading = !failed && (source.isLoading || (source.data != null && !pdf));
  const unavailable = failed || source.isError;
  return (
    <div
      ref={frame}
      className="flex h-full min-h-0 w-full flex-col items-center overflow-y-auto px-4"
      data-testid="library-page-view"
    >
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      )}
      {unavailable && (
        <p className="text-text-secondary py-10 text-sm">{localize('com_library_page_error')}</p>
      )}
      {!unavailable && (
        <canvas
          ref={canvas}
          aria-label={localize('com_library_page_label', { 0: pageIndex + 1 })}
          role="img"
          className="border-border-light max-w-full rounded border bg-white shadow-sm"
          hidden={loading}
        />
      )}
    </div>
  );
}
