/**
 * Reads the text of a page image in the browser with tesseract.js, which is only loaded when someone
 * starts OCR. The page never leaves the person's computer: the worker, its WebAssembly core and the
 * language data are all served by this app (`assets/ocr/`), not fetched from a CDN. Running
 * it needs `'wasm-unsafe-eval'` in the page's script policy (`CSP_ALLOW_WASM=true`).
 */

/**
 * The languages OCR can read, by the code tesseract.js uses. Names are shown in their own language,
 * as language pickers do. Each one's data is served from `assets/ocr/lang/` (see `vite.config.ts`),
 * so adding a language means adding its `@tesseract.js-data` package and a code to both lists.
 */
export const OCR_LANGUAGES = [
  { code: 'eng', label: 'English', tags: ['en'] },
  { code: 'vie', label: 'Tiếng Việt', tags: ['vi'] },
  { code: 'chi_sim', label: '简体中文', tags: ['zh'] },
  { code: 'fra', label: 'Français', tags: ['fr'] },
  { code: 'kor', label: '한국어', tags: ['ko'] },
  { code: 'jpn', label: '日本語', tags: ['ja'] },
  { code: 'spa', label: 'Español', tags: ['es'] },
  { code: 'deu', label: 'Deutsch', tags: ['de'] },
] as const;

export type OcrLanguage = (typeof OCR_LANGUAGES)[number]['code'];

export const DEFAULT_OCR_LANGUAGE: OcrLanguage = 'eng';

/** The language to start from: the document's own, if it is one of ours, otherwise English. */
export function ocrLanguageFor(documentLang?: string | null): OcrLanguage {
  const primary = (documentLang ?? '').toLowerCase().split(/[-_]/)[0];
  return (
    OCR_LANGUAGES.find((language) => (language.tags as readonly string[]).includes(primary))
      ?.code ?? DEFAULT_OCR_LANGUAGE
  );
}

export function isOcrLanguage(value: unknown): value is OcrLanguage {
  return OCR_LANGUAGES.some((language) => language.code === value);
}

export interface OcrEngine {
  /** The text of the page drawn on the canvas. */
  recognize: (canvas: HTMLCanvasElement) => Promise<string>;
  terminate: () => Promise<void>;
}

/** Wide enough for small print to be legible to the engine; the page is drawn at this many pixels. */
export const OCR_PAGE_WIDTH = 1700;

export async function createOcrEngine(
  language: OcrLanguage = DEFAULT_OCR_LANGUAGE,
): Promise<OcrEngine> {
  const { createWorker } = await import('tesseract.js');
  const base = new URL('assets/ocr/', document.baseURI).toString();
  const worker = await createWorker(language, 1, {
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
