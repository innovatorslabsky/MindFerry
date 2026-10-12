import type {
  MCPDirectoryConfig,
  MCPDirectoryEntry,
  MCPDirectoryParams,
  MCPDirectoryResponse,
  MCPDirectoryCategory,
} from 'librechat-data-provider';
import { parseMCPDirectory } from './parse';

export const MCP_DIRECTORY_DEFAULT_PAGE_SIZE = 30;
export const MCP_DIRECTORY_MAX_PAGE_SIZE = 100;

type ResolvedDirectoryConfig = NonNullable<MCPDirectoryConfig>;

export interface MCPDirectoryFetchOptions {
  timeoutMs: number;
  maxBytes: number;
}

export type MCPDirectoryFetchText = (
  url: string,
  options: MCPDirectoryFetchOptions,
) => Promise<string>;

export interface MCPDirectoryServiceDeps {
  fetchText: MCPDirectoryFetchText;
  now?: () => number;
}

export interface MCPDirectoryService {
  query: (
    config: ResolvedDirectoryConfig,
    params: MCPDirectoryParams,
  ) => Promise<MCPDirectoryResponse>;
}

interface Snapshot {
  entries: MCPDirectoryEntry[];
  categories: MCPDirectoryCategory[];
  fetchedAt: number;
  expiresAt: number;
}

export class MCPDirectoryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPDirectoryUnavailableError';
  }
}

function summarizeCategories(entries: MCPDirectoryEntry[]): MCPDirectoryCategory[] {
  const byId = new Map<string, MCPDirectoryCategory>();
  for (const entry of entries) {
    const existing = byId.get(entry.categoryId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byId.set(entry.categoryId, { id: entry.categoryId, name: entry.categoryName, count: 1 });
  }
  return [...byId.values()];
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || (limit as number) < 1) {
    return MCP_DIRECTORY_DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(limit as number), MCP_DIRECTORY_MAX_PAGE_SIZE);
}

function parseOffset(cursor: string | undefined): number {
  const offset = cursor ? Number.parseInt(cursor, 10) : 0;
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

function matcher(params: MCPDirectoryParams): (entry: MCPDirectoryEntry) => boolean {
  const terms = (params.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return (entry) => {
    if (params.category && entry.categoryId !== params.category) {
      return false;
    }
    if (params.scope && !entry.scopes.includes(params.scope)) {
      return false;
    }
    if (terms.length === 0) {
      return true;
    }
    const haystack = `${entry.id} ${entry.name} ${entry.description}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };
}

/**
 * A searchable view over a remote awesome-mcp-servers–format listing. The
 * caller supplies the transport (`fetchText`) and the per-request config, so
 * this holds only the parsed snapshot per source URL. A refresh that fails
 * keeps serving the last good snapshot rather than emptying the directory.
 */
export function createMCPDirectoryService(deps: MCPDirectoryServiceDeps): MCPDirectoryService {
  const now = deps.now ?? Date.now;
  const snapshots = new Map<string, Snapshot>();
  const refreshes = new Map<string, Promise<Snapshot>>();

  async function refresh(config: ResolvedDirectoryConfig): Promise<Snapshot> {
    const markdown = await deps.fetchText(config.sourceUrl, {
      timeoutMs: config.fetchTimeoutMs,
      maxBytes: config.maxSourceBytes,
    });
    const entries = parseMCPDirectory(markdown);
    if (entries.length === 0) {
      throw new MCPDirectoryUnavailableError('The directory source contained no server entries');
    }
    const fetchedAt = now();
    const snapshot: Snapshot = {
      entries,
      categories: summarizeCategories(entries),
      fetchedAt,
      expiresAt: fetchedAt + config.cacheTtlMs,
    };
    snapshots.set(config.sourceUrl, snapshot);
    return snapshot;
  }

  async function load(config: ResolvedDirectoryConfig): Promise<Snapshot> {
    const cached = snapshots.get(config.sourceUrl);
    if (cached && cached.expiresAt > now()) {
      return cached;
    }
    const inflight =
      refreshes.get(config.sourceUrl) ??
      refresh(config).finally(() => refreshes.delete(config.sourceUrl));
    refreshes.set(config.sourceUrl, inflight);
    try {
      return await inflight;
    } catch (error) {
      if (cached) {
        return cached;
      }
      throw error instanceof MCPDirectoryUnavailableError
        ? error
        : new MCPDirectoryUnavailableError('The directory source could not be fetched');
    }
  }

  return {
    async query(config, params) {
      const snapshot = await load(config);
      const matches = snapshot.entries.filter(matcher(params));
      const offset = parseOffset(params.cursor);
      const limit = clampLimit(params.limit);
      const end = offset + limit;

      return {
        entries: matches.slice(offset, end),
        total: matches.length,
        nextCursor: end < matches.length ? String(end) : undefined,
        categories: snapshot.categories,
        sourceUrl: config.sourceUrl,
        fetchedAt: new Date(snapshot.fetchedAt).toISOString(),
      };
    },
  };
}
