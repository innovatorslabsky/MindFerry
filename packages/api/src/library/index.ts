/**
 * Public surface of the reading library. The ingestion internals (`core.ts`) stay private: names
 * like `similarity` or `FetchError` are too generic to export from the package root.
 */
export { isLibraryEnabled, getLibraryIsolation } from './config';
export { createLibraryService } from './service';
export type {
  LibraryService,
  LibraryServiceDeps,
  SaveResult,
  CreateHighlightOutcome,
} from './service';
export {
  createLibraryIngest,
  createIsolatedIngest,
  createProcessRunner,
  resolveWorkerEntry,
} from './worker';
export type { LibraryIsolationConfig, LibraryIngest, ProcessRunner } from './worker';
export {
  createLibraryHandlers,
  libraryBrowseLimiter,
  librarySaveLimiter,
  LIBRARY_MAX_HTML_CHARS,
  LIBRARY_MAX_UPLOAD_BYTES,
} from './routes';
export type { LibraryHandlers } from './routes';
