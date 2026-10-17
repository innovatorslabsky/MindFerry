import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useToastContext } from '@librechat/client';
import { dataService } from 'librechat-data-provider';
import type { TLibraryHighlight, TLibraryHighlightColor } from 'librechat-data-provider';
import {
  HIGHLIGHT_COLORS,
  buildAnchor,
  offsetAtTop,
  offsetsFromRange,
  paintHighlights,
  releaseHighlights,
  rendersServerText,
  scrollToHighlight,
  scrollToOffset,
} from '~/utils/libraryAnchors';
import { useCreateLibraryHighlightMutation, useSetLibraryProgressMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { libraryErrorKey } from './errors';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Written out so each label key is visible to the unused-key check. */
const COLOR_LABEL = {
  yellow: 'com_library_color_yellow',
  blue: 'com_library_color_blue',
  green: 'com_library_color_green',
  red: 'com_library_color_red',
  purple: 'com_library_color_purple',
} as const;

const PROGRESS_DELAY_MS = 1500;

export type ReaderBodyHandle = { focusHighlight: (highlight: TLibraryHighlight) => void };

type ReaderBodyProps = {
  documentId: string;
  /** Sanitized HTML from the server. Rendered as it is: offsets only mean something against it. */
  html?: string;
  /** For text with no markup of its own, such as a PDF page: shown as one block, line breaks kept. */
  plainText?: string;
  /** The text highlights are anchored in, which the rendered text must equal. */
  anchorText: string;
  /** `contentHash` of `anchorText`, sent with each new highlight. */
  contentHash: string;
  highlights: readonly TLibraryHighlight[];
  /** Set for a chapter or page, so highlights and progress carry which one. */
  unit?: { kind: 'chapter' | 'page'; index: number };
  /** Off for text that cannot be highlighted, with the reason shown to the reader. */
  highlightingDisabledReason?: string;
  /** Where the reader was last time, if it is still meaningful. */
  resumeAt?: number;
  /** Gives the parent a way to scroll to a highlight. */
  registerHandle?: (handle: ReaderBodyHandle | null) => void;
  className?: string;
};

type Pending = { start: number; end: number; top: number; left: number };

/**
 * The text of a document with its highlights drawn over it. It renders the server's HTML as it is and
 * checks that the text it ended up with is the text highlights are anchored in; if that ever differs,
 * selecting is turned off rather than saving highlights in the wrong place.
 */
function ReaderBody({
  documentId,
  html,
  plainText,
  anchorText,
  contentHash,
  highlights,
  unit,
  highlightingDisabledReason,
  resumeAt,
  registerHandle,
  className,
}: ReaderBodyProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [aligned, setAligned] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const createHighlight = useCreateLibraryHighlightMutation({
    onError: (error) =>
      showToast({
        message: localize(libraryErrorKey(error, 'com_library_highlight_error')),
        status: NotificationSeverity.ERROR,
      }),
  });
  const setProgress = useSetLibraryProgressMutation();

  const canHighlight = highlightingDisabledReason == null && aligned;

  /** Whether what the browser built is the text the server anchors in. */
  useEffect(() => {
    const root = content.current;
    setAligned(root != null && rendersServerText(root, anchorText));
  }, [html, anchorText, plainText]);

  useEffect(() => {
    const root = content.current;
    if (!root || !aligned) {
      return;
    }
    paintHighlights(root, highlights);
  }, [aligned, highlights, html]);

  useEffect(() => releaseHighlights, []);

  /**
   * A book's pictures are fetched with the session's credentials, which an `<img src>` cannot send, and
   * shown from object URLs. Only an attribute changes, so the text, and with it every highlight offset,
   * stays as it was. A picture that cannot be fetched is simply left out.
   */
  useEffect(() => {
    const root = content.current;
    if (!root || unit?.kind !== 'chapter') {
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    for (const image of Array.from(root.querySelectorAll('img[data-epub-resource]'))) {
      const path = image.getAttribute('data-epub-resource');
      if (!path || image.getAttribute('src')) {
        continue;
      }
      dataService
        .getLibraryResource(documentId, path)
        .then((blob) => {
          if (cancelled) {
            return;
          }
          const url = URL.createObjectURL(blob);
          urls.push(url);
          image.setAttribute('src', url);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [documentId, html, unit?.kind]);

  useEffect(() => {
    const root = content.current;
    if (root && resumeAt && resumeAt > 0) {
      scrollToOffset(root, resumeAt);
    }
    // Only when a different document or chapter opens, never on every highlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, unit?.index, html, plainText]);

  useEffect(() => {
    registerHandle?.({
      focusHighlight: (highlight) => {
        if (content.current) {
          scrollToHighlight(content.current, highlight);
        }
      },
    });
    return () => registerHandle?.(null);
  }, [registerHandle]);

  /** Saves where the reader is, a moment after they stop scrolling. */
  const progressTimer = useRef<ReturnType<typeof setTimeout>>();
  const onScroll = useCallback(() => {
    clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      const root = content.current;
      const box = scroller.current;
      if (!root || !box || !aligned) {
        return;
      }
      setProgress.mutate({
        id: documentId,
        textOffset: offsetAtTop(root, box.getBoundingClientRect().top),
        unitIndex: unit?.index,
      });
    }, PROGRESS_DELAY_MS);
    setPending(null);
    // `setProgress.mutate` is stable; the rest is what a save depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aligned, documentId, unit?.index]);
  useEffect(() => () => clearTimeout(progressTimer.current), []);

  const onSelectionEnd = useCallback(() => {
    const root = content.current;
    const selection = window.getSelection();
    if (
      !root ||
      !canHighlight ||
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    ) {
      setPending(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const offsets = offsetsFromRange(root, range);
    if (!offsets) {
      setPending(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setPending({ ...offsets, top: rect.top, left: rect.left + rect.width / 2 });
  }, [canHighlight]);

  const onPick = (color: TLibraryHighlightColor) => {
    if (!pending) {
      return;
    }
    const anchor = buildAnchor(anchorText, pending.start, pending.end);
    if (!anchor) {
      setPending(null);
      return;
    }
    createHighlight.mutate({ documentId, anchor, contentHash, color, unit });
    window.getSelection()?.removeAllRanges();
    setPending(null);
  };

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className={cn('relative h-full overflow-y-auto', className)}
      data-testid="library-reader-scroll"
    >
      {highlightingDisabledReason != null && (
        <p
          className="text-text-secondary bg-surface-secondary mx-auto mb-4 max-w-2xl rounded-lg px-3 py-2 text-sm"
          role="note"
        >
          {highlightingDisabledReason}
        </p>
      )}
      {highlightingDisabledReason == null && !aligned && (html != null || plainText != null) && (
        <p
          className="text-text-secondary bg-surface-secondary mx-auto mb-4 max-w-2xl rounded-lg px-3 py-2 text-sm"
          role="note"
          data-testid="library-highlighting-off"
        >
          {localize('com_library_highlighting_off')}
        </p>
      )}
      {html != null ? (
        <div
          ref={content}
          className="library-prose mx-auto max-w-2xl px-4 pb-24"
          data-testid="library-reader-content"
          onMouseUp={onSelectionEnd}
          onKeyUp={onSelectionEnd}
          // The server sanitized this with an allow-list; offsets only hold if it is shown unchanged.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div
          ref={content}
          className="library-prose mx-auto max-w-2xl px-4 pb-24 whitespace-pre-wrap"
          data-testid="library-reader-content"
          onMouseUp={onSelectionEnd}
          onKeyUp={onSelectionEnd}
        >
          {/* One text node, so the text on screen is exactly the text highlights are anchored in. */}
          {plainText}
        </div>
      )}
      {pending && (
        <div
          role="toolbar"
          aria-label={localize('com_library_highlight_toolbar')}
          className="border-border-medium bg-surface-primary fixed z-50 flex -translate-x-1/2 -translate-y-full gap-1 rounded-lg border p-1 shadow-lg"
          style={{ top: Math.max(pending.top - 8, 8), left: pending.left }}
          data-testid="library-highlight-toolbar"
        >
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              // Keep the selection alive while the button takes the click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(color)}
              aria-label={localize('com_library_highlight_with', {
                0: localize(COLOR_LABEL[color]),
              })}
              className={cn(
                'library-swatch h-6 w-6 rounded-full border',
                `library-swatch-${color}`,
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(ReaderBody);
