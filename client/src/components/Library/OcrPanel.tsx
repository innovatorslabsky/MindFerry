import { useEffect, useRef, useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { useLibrarySourceQuery, useSaveLibraryUnitTextMutation } from '~/data-provider';
import {
  createOcrEngine,
  isOcrLanguage,
  OCR_LANGUAGES,
  OCR_PAGE_WIDTH,
  ocrLanguageFor,
} from '~/utils/ocr';
import type { OcrLanguage } from '~/utils/ocr';
import { libraryErrorCode } from './errors';
import { openPdfPages } from '~/utils/pdfPages';
import { useLocalize } from '~/hooks';

const LANGUAGE_KEY = 'libraryOcrLanguage';

/** The language last chosen on this device, else the document's own. Storage may be unavailable. */
function initialLanguage(documentLang?: string): OcrLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (isOcrLanguage(stored)) {
      return stored;
    }
  } catch {
    // Private windows and blocked storage fall through to the document's language.
  }
  return ocrLanguageFor(documentLang);
}

type Run =
  | { state: 'idle' }
  | { state: 'running'; page: number; done: number; total: number }
  | { state: 'finished'; found: number; empty: number }
  | { state: 'failed' };

/**
 * Offers to read the text of scanned pages, one page or all of them, in the browser. A page is drawn
 * from the stored original, read by tesseract.js, and its text is saved to the server only when the
 * page has none of its own. Nothing is uploaded for reading, and a page that already has text is
 * never replaced.
 */
export default function OcrPanel({
  documentId,
  blankPages,
  currentPage,
  documentLang,
}: {
  documentId: string;
  /** The document's own language, if it declares one; the starting choice for OCR. */
  documentLang?: string;
  /** Indexes of the pages with no text. */
  blankPages: number[];
  currentPage: number;
}) {
  const localize = useLocalize();
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const [wanted, setWanted] = useState(false);
  const [language, setLanguage] = useState<OcrLanguage>(() => initialLanguage(documentLang));
  const chosen = useRef(language);
  chosen.current = language;
  const cancelled = useRef(false);
  const source = useLibrarySourceQuery(documentId, { enabled: wanted });
  const save = useSaveLibraryUnitTextMutation();
  const queue = useRef<number[]>([]);

  useEffect(() => () => void (cancelled.current = true), []);

  // The file is fetched only once someone asks, then the queued pages are read from it.
  useEffect(() => {
    const blob = source.data;
    if (!wanted || !blob || queue.current.length === 0) {
      return;
    }
    const pages = queue.current;
    queue.current = [];
    cancelled.current = false;
    void (async () => {
      let engine: Awaited<ReturnType<typeof createOcrEngine>> | undefined;
      let pdf: Awaited<ReturnType<typeof openPdfPages>> | undefined;
      let found = 0;
      let empty = 0;
      try {
        pdf = await openPdfPages(await blob.arrayBuffer());
        engine = await createOcrEngine(chosen.current);
        for (let step = 0; step < pages.length && !cancelled.current; step++) {
          const index = pages[step];
          setRun({ state: 'running', page: index + 1, done: step, total: pages.length });
          const canvas = document.createElement('canvas');
          await pdf.render(index + 1, canvas, OCR_PAGE_WIDTH, 1).promise;
          const text = await engine.recognize(canvas);
          try {
            await save.mutateAsync({ id: documentId, index, text });
            found++;
          } catch (error) {
            const code = libraryErrorCode(error);
            // A page with nothing readable, or one that gained text meanwhile, is not a failed run.
            if (code !== 'empty_text' && code !== 'has_text') {
              throw error;
            }
            empty++;
          }
        }
        setRun({ state: 'finished', found, empty });
      } catch {
        setRun({ state: 'failed' });
      } finally {
        setWanted(false);
        await engine?.terminate().catch(() => undefined);
        await pdf?.destroy().catch(() => undefined);
      }
    })();
  }, [source.data, wanted, documentId, save]);

  const start = (pages: number[]) => {
    queue.current = pages;
    setRun({ state: 'running', page: pages[0] + 1, done: 0, total: pages.length });
    setWanted(true);
  };

  const running = run.state === 'running';
  const currentBlank = blankPages.includes(currentPage);
  // After a run the page list may not have refreshed yet, so its count is not shown beside the result.
  const offering = blankPages.length > 0 && run.state !== 'finished';
  if (blankPages.length === 0 && run.state !== 'finished') {
    return null;
  }
  return (
    <div
      className="bg-surface-secondary text-text-secondary mx-auto mb-3 flex w-full max-w-2xl flex-col gap-2 rounded-lg px-3 py-2 text-sm"
      data-testid="library-ocr"
    >
      {offering && <p>{localize('com_library_ocr_blank', { 0: blankPages.length })}</p>}
      {offering && (
        <label className="flex items-center gap-2">
          <span>{localize('com_library_ocr_language')}</span>
          <select
            value={language}
            onChange={(event) => {
              const next = event.target.value;
              if (isOcrLanguage(next)) {
                setLanguage(next);
                try {
                  localStorage.setItem(LANGUAGE_KEY, next);
                } catch {
                  // Remembering the choice is a convenience only.
                }
              }
            }}
            disabled={running}
            className="border-border-medium bg-surface-primary text-text-primary rounded-md border px-2 py-1 text-sm"
          >
            {OCR_LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {run.state === 'running' && (
        <p className="flex items-center gap-2" role="status">
          <Spinner className="h-4 w-4" />
          {localize('com_library_ocr_progress', {
            0: run.page,
            1: run.done + 1,
            2: run.total,
          })}
        </p>
      )}
      {run.state === 'finished' && (
        <p role="status">{localize('com_library_ocr_done', { 0: run.found, 1: run.empty })}</p>
      )}
      {run.state === 'failed' && <p role="alert">{localize('com_library_ocr_error')}</p>}
      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void (cancelled.current = true)}
          >
            {localize('com_library_ocr_cancel')}
          </Button>
        ) : (
          offering && (
            <>
              {currentBlank && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => start([currentPage])}
                >
                  {localize('com_library_ocr_this')}
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => start(blankPages)}>
                {localize('com_library_ocr_all', { 0: blankPages.length })}
              </Button>
            </>
          )
        )}
      </div>
    </div>
  );
}
