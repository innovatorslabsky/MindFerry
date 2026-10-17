import { FetchError, TooLargeError, UnsafeUrlError } from '../net/safeFetch';
import { PdfEncryptedError, PdfError } from '../pdf/parsePdf';
import { EpubDrmError, EpubError } from '../epub/parseEpub';
import { UnsupportedUploadError } from '../ingest/upload';
import { NotReadableError } from '../ingest/extract';
import { FeedParseError } from '../feed/parseFeed';

/** Base for failures of the isolation machinery itself, as opposed to a bad input. */
export class WorkerError extends Error {
  override name = 'WorkerError';
}

/** The parser did not finish in time and was killed. */
export class ParseTimeoutError extends WorkerError {
  override name = 'ParseTimeoutError';
}

/** Every parser slot is busy and the waiting line is full. Try again shortly. */
export class WorkerBusyError extends WorkerError {
  override name = 'WorkerBusyError';
}

/**
 * The parser process died without answering: it ran out of memory, was killed, or crashed. For an
 * untrusted file that is a property of the file, so it is reported as unreadable, not as a server fault.
 */
export class WorkerCrashedError extends WorkerError {
  override name = 'WorkerCrashedError';
}

/** The parser program is missing. In `process` mode this is a deployment fault and fails closed. */
export class WorkerUnavailableError extends WorkerError {
  override name = 'WorkerUnavailableError';
}

/** The parser's answer was larger than the configured ceiling. */
export class WorkerResultTooLargeError extends WorkerError {
  override name = 'WorkerResultTooLargeError';
}

type ErrorClass = new (message: string) => Error;

/** Errors a parser may raise about its input; these cross the boundary by name and keep their type. */
const REVIVABLE: Record<string, ErrorClass> = {
  UnsafeUrlError,
  FetchError,
  TooLargeError,
  NotReadableError,
  UnsupportedUploadError,
  PdfError,
  PdfEncryptedError,
  EpubError,
  EpubDrmError,
  FeedParseError,
  WorkerResultTooLargeError,
};

/**
 * Rebuilds a typed error from the child's `{ name, message }`. A name the parent does not know
 * becomes a generic `WorkerError`; the child cannot cause the parent to construct arbitrary classes.
 */
export function reviveError(name: string, message: string): Error {
  const Revived = Object.prototype.hasOwnProperty.call(REVIVABLE, name)
    ? REVIVABLE[name]
    : undefined;
  return Revived ? new Revived(message) : new WorkerError('The parser failed');
}
