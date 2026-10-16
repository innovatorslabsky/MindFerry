/**
 * Draws pages of a PDF onto a canvas with pdf.js, which is only loaded the first time a page is
 * shown. Only pixels are drawn: pdf.js's scripting is off unless asked for (it is not), no forms are
 * filled, and the file never leaves the person's own browser once downloaded.
 */

export interface PdfPageRender {
  promise: Promise<void>;
  cancel: () => void;
}

export interface PdfPages {
  numPages: number;
  /** Draws one page (1-based) at `cssWidth` CSS pixels wide, sharp on high-density screens. */
  render: (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    cssWidth: number,
    /** Pixels per CSS pixel; the screen's by default. OCR passes 1 and asks for a large width. */
    pixelRatio?: number,
  ) => PdfPageRender;
  destroy: () => Promise<void>;
}

type PdfJs = typeof import('pdfjs-dist');

/**
 * The legacy build is used because it carries the polyfills the current one leaves out (newer
 * pdf.js needs `Map.prototype.getOrInsertComputed`, which many browsers in use do not have yet).
 * The worker is a separate file the bundler serves; it is only requested when a page is shown.
 */
async function loadPdfjs(): Promise<PdfJs> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJs>,
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** Opens a PDF held in memory. The buffer is handed to the worker, so pass a copy you can lose. */
export async function openPdfPages(data: ArrayBuffer): Promise<PdfPages> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data, enableXfa: false });
  const pdf = await task.promise;
  return {
    numPages: pdf.numPages,
    render(pageNumber, canvas, cssWidth, pixelRatio) {
      let cancelled = false;
      let current: { cancel: () => void } | undefined;
      const promise = (async () => {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) {
          return;
        }
        const base = page.getViewport({ scale: 1 });
        const ratio = pixelRatio ?? (window.devicePixelRatio || 1);
        const scale = cssWidth / base.width;
        const viewport = page.getViewport({ scale: scale * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Canvas is not available');
        }
        const task = page.render({ canvasContext: context, canvas, viewport });
        current = task;
        try {
          await task.promise;
        } catch (error) {
          // A render that was cancelled because another page was asked for is not a failure.
          if ((error as { name?: string })?.name !== 'RenderingCancelledException') {
            throw error;
          }
        }
      })();
      return {
        promise,
        cancel: () => {
          cancelled = true;
          current?.cancel();
        },
      };
    },
    destroy: () => task.destroy(),
  };
}
