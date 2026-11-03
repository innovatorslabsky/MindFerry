import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useSaveLibrarySessionMutation } from '~/data-provider';
import { offsetAtTop } from '~/utils/libraryAnchors';
import { SessionTracker } from './readingSession';

const ACTIVITY_EVENTS = [
  'scroll',
  'wheel',
  'keydown',
  'pointerdown',
  'pointermove',
  'touchstart',
] as const;
const TICK_MS = 1_000;
const REPORT_MS = 15_000;

type Options = {
  documentId: string;
  /** The element holding the text, and the one that scrolls it. */
  content: RefObject<HTMLElement>;
  scroller: RefObject<HTMLElement>;
  /** The text the offsets are in, and which chapter or page it is. */
  anchorText: string;
  unitKey: string;
  /** Whether the text on screen is the text the offsets mean; until then no words are counted. */
  aligned: boolean;
};

/**
 * Times how long the document is really read and how many words go by, and reports it to the server a few
 * times a minute and when the reader looks away. It counts only while the page is in front of the reader
 * and they have done something in the last minute and a half. A report lost on a closed tab costs seconds.
 */
export function useReadingSession({
  documentId,
  content,
  scroller,
  anchorText,
  unitKey,
  aligned,
}: Options): void {
  const save = useSaveLibrarySessionMutation();
  // A different document is a different session.
  const tracker = useMemo(() => new SessionTracker(), [documentId]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef({ anchorText, unitKey, aligned });
  latest.current = { anchorText, unitKey, aligned };
  const mutate = useRef(save.mutate);
  mutate.current = save.mutate;

  useEffect(() => {
    const flush = () => {
      const report = tracker.report();
      if (report) {
        mutate.current({
          id: documentId,
          sid: report.sid,
          report: {
            startedAt: report.startedAt,
            activeSeconds: report.activeSeconds,
            words: report.words,
          },
        });
      }
    };
    const touch = () => tracker.touch(Date.now());
    const attending = () => document.visibilityState === 'visible' && document.hasFocus();
    const sample = () => {
      const { anchorText: text, unitKey: key, aligned: ready } = latest.current;
      const root = content.current;
      const box = scroller.current;
      if (!ready || !root || !box) {
        return null;
      }
      return { offset: offsetAtTop(root, box.getBoundingClientRect().top), text, unitKey: key };
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, touch, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    const tick = setInterval(() => tracker.tick(Date.now(), attending(), sample()), TICK_MS);
    const report = setInterval(flush, REPORT_MS);
    return () => {
      clearInterval(tick);
      clearInterval(report);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, touch, { capture: true });
      }
      flush();
    };
  }, [documentId, tracker, content, scroller]);
}
