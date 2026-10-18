import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner, useToastContext } from '@librechat/client';
import type { TLibraryHighlight, TLibraryHighlightColor } from 'librechat-data-provider';
import type { ReaderBodyHandle } from './ReaderBody';
import type { PdfPages } from '~/utils/pdfPages';
import {
  buildAnchor,
  offsetsFromRange,
  paintHighlights,
  rangeFromOffsets,
  releaseHighlights,
} from '~/utils/libraryAnchors';
import { useCreateLibraryHighlightMutation, useLibrarySourceQuery } from '~/data-provider';
import { anchorToLayer, layerToAnchor } from '~/utils/pdfTextMap';
import HighlightToolbar from './HighlightToolbar';
import { NotificationSeverity } from '~/common';
import { openPdfPages } from '~/utils/pdfPages';
import { libraryErrorKey } from './errors';
import { useLocalize } from '~/hooks';

const MAX_WIDTH = 900;

type Pending = { start: number; end: number; top: number; left: number };

/**
 * One page of the stored original, drawn as the page itself with its words laid over it invisibly so
 * they can be selected. A selection is matched to the same words in the stored page text, which is
 * where highlights live, and highlights are drawn back over the words of the image.
 */
export default function PdfPageView({
  documentId,
  pageIndex,
  anchorText,
  contentHash,
  highlights = [],
  registerHandle,
}: {
  documentId: string;
  pageIndex: number;
  /** The stored text of this page, which highlights are anchored in. Without it nothing can be highlighted. */
  anchorText?: string;
  /** `contentHash` of `anchorText`, sent with each new highlight. */
  contentHash?: string;
  highlights?: readonly TLibraryHighlight[];
  /** Gives the parent a way to highlight the selection and to scroll to a highlight. */
  registerHandle?: (handle: ReaderBodyHandle | null) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const source = useLibrarySourceQuery(documentId);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfPages | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  /** Counts finished text layers, so highlights are drawn again each time the words are laid down. */
  const [layerReady, setLayerReady] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);

  const createHighlight = useCreateLibraryHighlightMutation({
    onError: (error) =>
      showToast({
        message: localize(libraryErrorKey(error, 'com_library_highlight_error')),
        status: NotificationSeverity.ERROR,
      }),
  });
  const canHighlight = anchorText != null && contentHash != null && layerReady > 0;

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

  useEffect(() => {
    const container = layer.current;
    if (!pdf || !container || width <= 0 || pageIndex >= pdf.numPages) {
      return;
    }
    setLayerReady(0);
    setPending(null);
    const job = pdf.renderTextLayer(pageIndex + 1, container, width);
    // Without a text layer the page is still readable; it just cannot be highlighted here.
    job.promise.then(() => setLayerReady((count) => count + 1)).catch(() => undefined);
    return () => job.cancel();
  }, [pdf, pageIndex, width]);

  useEffect(() => {
    const container = layer.current;
    if (!container || !canHighlight || anchorText == null) {
      return;
    }
    const layerText = container.textContent ?? '';
    paintHighlights(container, highlights, (highlight) =>
      anchorToLayer(layerText, anchorText, highlight.anchor.start, highlight.anchor.end),
    );
  }, [canHighlight, anchorText, highlights, layerReady]);

  useEffect(() => releaseHighlights, []);

  /** The selection as offsets into the stored page text, or null when it cannot be placed there. */
  const selectionInAnchor = useCallback((): Pending | null => {
    const container = layer.current;
    const selection = window.getSelection();
    if (
      !container ||
      !canHighlight ||
      anchorText == null ||
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    ) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const inLayer = offsetsFromRange(container, range);
    const placed =
      inLayer && layerToAnchor(container.textContent ?? '', anchorText, inLayer.start, inLayer.end);
    if (!placed) {
      return null;
    }
    const rect = range.getBoundingClientRect();
    return { ...placed, top: rect.top, left: rect.left + rect.width / 2 };
  }, [canHighlight, anchorText]);

  const create = useCallback(
    (start: number, end: number, color: TLibraryHighlightColor) => {
      const anchor = anchorText == null ? null : buildAnchor(anchorText, start, end);
      if (!anchor || contentHash == null) {
        return false;
      }
      createHighlight.mutate({
        documentId,
        anchor,
        contentHash,
        color,
        unit: { kind: 'page', index: pageIndex },
      });
      window.getSelection()?.removeAllRanges();
      setPending(null);
      return true;
    },
    // `createHighlight.mutate` is stable; the rest is what a highlight is made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anchorText, contentHash, documentId, pageIndex],
  );

  const onSelectionEnd = () => {
    const found = selectionInAnchor();
    if (found) {
      setPending(found);
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && canHighlight) {
      showToast({
        message: localize('com_library_page_select_error'),
        status: NotificationSeverity.ERROR,
      });
    }
    setPending(null);
  };

  useEffect(() => {
    registerHandle?.({
      focusHighlight: (highlight) => {
        const container = layer.current;
        if (!container || anchorText == null) {
          return;
        }
        const where = anchorToLayer(
          container.textContent ?? '',
          anchorText,
          highlight.anchor.start,
          highlight.anchor.end,
        );
        const range = where && rangeFromOffsets(container, where.start, where.end);
        range?.startContainer.parentElement?.scrollIntoView?.({
          block: 'center',
          behavior: 'smooth',
        });
      },
      highlightSelection: (color = 'yellow') => {
        const found = selectionInAnchor();
        return found ? create(found.start, found.end, color) : false;
      },
    });
    return () => registerHandle?.(null);
  }, [registerHandle, anchorText, selectionInAnchor, create]);

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
        <div className="relative max-w-full" hidden={loading}>
          <canvas
            ref={canvas}
            aria-label={localize('com_library_page_label', { 0: pageIndex + 1 })}
            role="img"
            className="border-border-light block max-w-full rounded border bg-white shadow-sm"
          />
          <div
            ref={layer}
            className="library-pdf-layer"
            data-testid="library-page-text"
            onMouseUp={onSelectionEnd}
            onKeyUp={onSelectionEnd}
            onScroll={() => setPending(null)}
          />
        </div>
      )}
      {pending && (
        <HighlightToolbar
          top={pending.top}
          left={pending.left}
          onPick={(color) => create(pending.start, pending.end, color)}
        />
      )}
    </div>
  );
}
