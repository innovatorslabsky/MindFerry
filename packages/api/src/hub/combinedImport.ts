import fs from 'node:fs/promises';
import { logger } from '@librechat/data-schemas';
import type { HubMethods, HubThreadChatLink } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '../types/http';
import { runHubImportJob, HubImportFileTooLargeError } from './importJob';
import { isConversationImportError } from '../conversations/import';
import { isContentFilterError } from '../middleware/contentFilter';
import { createConfiguredGitArchiveTarget } from './git/config';
import { isContextHubEnabled } from './config';
import { UnknownExportError } from './source';

/** Where one uploaded export goes: the chat list, the MindFerry archive, or both. */
export type ImportTarget = 'chats' | 'archive' | 'both';

const IMPORT_TARGETS: ReadonlySet<string> = new Set(['chats', 'archive', 'both']);

/** `chats` when absent or unrecognized, which is what the route did before it had targets. */
export function parseImportTarget(value: unknown): ImportTarget {
  return typeof value === 'string' && IMPORT_TARGETS.has(value) ? (value as ImportTarget) : 'chats';
}

type ErrorBody = { error: { message: string; type: string; code: string } };

/** How one side of an import went. `blocked` carries the importer's own refusal to pass back. */
export type ImportSideResult =
  | { status: 'imported'; threadCount?: number }
  | { status: 'unsupported' }
  | { status: 'blocked'; statusCode: number; body: unknown }
  | { status: 'failed' };

export interface CreateCombinedImportHandlerDeps {
  methods: Pick<HubMethods, 'upsertHubThread' | 'linkHubThreadChats'>;
  /**
   * Imports the file as ordinary chats through the app's own importer, which
   * lives in the legacy `/api` workspace — supplied by the caller. It deletes
   * the file when done and throws on failure, with `Unsupported import type`
   * for a format it does not read. It may return which archive thread each new
   * chat came from, so an import into both shows each conversation once.
   */
  importChats: (req: ServerRequest, filepath: string) => Promise<HubThreadChatLink[] | void>;
  /**
   * Recognizes an importer's refusal — a content-filter block or an oversized
   * record — whose status and body go back to the client as they are.
   * Defaults to the package's own checks.
   */
  isImportRefusal?: (error: unknown) => error is ImportRefusal;
}

/** A refusal an importer raises with the status and body the client should see. */
export interface ImportRefusal {
  statusCode: number;
  body: unknown;
}

function isPackageImportRefusal(error: unknown): error is ImportRefusal {
  return isContentFilterError(error) || isConversationImportError(error);
}

type ImportRequest = ServerRequest & {
  file?: { path: string };
  body?: { target?: unknown };
};

function errorBody(message: string, code: string, type = 'invalid_request_error'): ErrorBody {
  return { error: { message, type, code } };
}

const UNSUPPORTED = 'Unsupported import type';

function isUnreadable(error: unknown): boolean {
  return (
    error instanceof UnknownExportError ||
    error instanceof SyntaxError ||
    (error instanceof Error && error.message === UNSUPPORTED)
  );
}

async function importSide(
  run: () => Promise<number | undefined>,
  isImportRefusal: (error: unknown) => error is ImportRefusal,
): Promise<ImportSideResult> {
  try {
    const threadCount = await run();
    return threadCount === undefined ? { status: 'imported' } : { status: 'imported', threadCount };
  } catch (error) {
    if (isUnreadable(error)) {
      return { status: 'unsupported' };
    }
    if (isImportRefusal(error)) {
      return { status: 'blocked', statusCode: error.statusCode, body: error.body };
    }
    if (error instanceof HubImportFileTooLargeError) {
      return {
        status: 'blocked',
        statusCode: 413,
        body: errorBody(error.message, 'file_too_large'),
      };
    }
    logger.error('Error processing file', error);
    return { status: 'failed' };
  }
}

async function removeQuietly(filepath: string): Promise<void> {
  try {
    await fs.unlink(filepath);
  } catch {
    /* Already removed by the importer that read it. */
  }
}

function sendFailure(res: Response, results: ImportSideResult[]): void {
  const blocked = results.find(
    (result): result is Extract<ImportSideResult, { status: 'blocked' }> =>
      result.status === 'blocked',
  );
  if (blocked) {
    res.status(blocked.statusCode).json(blocked.body);
    return;
  }
  if (results.every((result) => result.status === 'unsupported')) {
    res.status(400).json(errorBody(UNSUPPORTED, 'unsupported_export'));
    return;
  }
  res.status(500).send('Error processing file');
}

/**
 * One import for both destinations. The uploaded export goes to the chat
 * list, the MindFerry archive, or both (`target` in the form, `chats` when
 * absent). With both, each side reads its own copy of the file, and a side
 * that cannot read the format is skipped rather than failing the other — a
 * Gemini export only reaches the archive, a LibreChat one only the chats.
 * The request fails only when nothing was imported.
 */
export function createCombinedImportHandler(
  deps: CreateCombinedImportHandlerDeps,
): (req: ImportRequest, res: Response) => Promise<void> {
  const { methods, importChats, isImportRefusal = isPackageImportRefusal } = deps;

  return async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json(errorBody('Authentication is required', 'unauthorized'));
      return;
    }
    const filepath = req.file?.path;
    if (!filepath) {
      res.status(400).json(errorBody('No file was uploaded', 'no_file'));
      return;
    }

    const requested = parseImportTarget(req.body?.target);
    const hubEnabled = isContextHubEnabled(req.config);
    if (requested === 'archive' && !hubEnabled) {
      await removeQuietly(filepath);
      res.status(404).json(errorBody('Context hub is not enabled', 'not_found', 'not_found'));
      return;
    }
    const toArchive = hubEnabled && requested !== 'chats';
    const toChats = requested !== 'archive';

    let archiveFile = filepath;
    if (toArchive && toChats) {
      archiveFile = `${filepath}.archive`;
      await fs.copyFile(filepath, archiveFile);
    }

    const archive = toArchive
      ? await importSide(async () => {
          const targets = {
            methods,
            git: createConfiguredGitArchiveTarget(req.config?.contextHub?.git),
          };
          const result = await runHubImportJob({ filepath: archiveFile, userId, targets });
          return result.threadCount;
        }, isImportRefusal)
      : undefined;
    let links: HubThreadChatLink[] = [];
    const chats = toChats
      ? await importSide(async () => {
          links = (await importChats(req, filepath)) ?? [];
          return undefined;
        }, isImportRefusal)
      : undefined;
    if (archive?.status === 'imported' && links.length > 0) {
      try {
        await methods.linkHubThreadChats(userId, links);
      } catch (error) {
        logger.warn('[combinedImport] Could not link imported chats to their threads:', error);
      }
    }
    await Promise.all([removeQuietly(filepath), removeQuietly(archiveFile)]);

    const results = [archive, chats].filter(
      (result): result is ImportSideResult => result !== undefined,
    );
    if (!results.some((result) => result.status === 'imported')) {
      sendFailure(res, results);
      return;
    }

    res.status(201).json({
      message: 'Conversation(s) imported successfully',
      ...(chats ? { chats: summarize(chats) } : {}),
      ...(archive ? { archive: summarize(archive) } : {}),
    });
  };
}

/** What the client is told about one side: its status, and the count the archive reports. */
function summarize(result: ImportSideResult): { status: string; threadCount?: number } {
  if (result.status === 'imported') {
    return result.threadCount === undefined
      ? { status: 'imported' }
      : { status: 'imported', threadCount: result.threadCount };
  }
  return { status: result.status === 'blocked' ? 'failed' : result.status };
}
