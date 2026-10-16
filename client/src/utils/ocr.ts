/**
 * Reads the text of a page image in the browser with tesseract.js, which is only loaded when someone
 * starts OCR. The page never leaves the person's computer: the worker, its WebAssembly core and the
 * English language data are all served by this app (`assets/ocr/`), not fetched from a CDN. Running
 * it needs `'wasm-unsafe-eval'` in the page's script policy (`CSP_ALLOW_WASM=true`).
 */

export interface OcrEngine {
  /** The text of the page drawn on the canvas. */
  recognize: (canvas: HTMLCanvasElement) => Promise<string>;
  terminate: () => Promise<void>;
}

/** Wide enough for small print to be legible to the engine; the page is drawn at this many pixels. */
export const OCR_PAGE_WIDTH = 1700;

export async function createOcrEngine(): Promise<OcrEngine> {
  const { createWorker } = await import('tesseract.js');
  const base = new URL('assets/ocr/', document.baseURI).toString();
  const worker = await createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: `${base}lang`,
    gzip: true,
    workerBlobURL: false,
  });
  return {
    async recognize(canvas) {
      const { data } = await worker.recognize(canvas);
      return data.text;
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
