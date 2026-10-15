import type {
  LibraryDocumentPatch,
  LibraryDocumentRecord,
  LibraryDocumentSummary,
  LibraryHighlightInput,
  LibraryHighlightPatch,
  LibraryHighlightRecord,
  LibraryListQuery,
  LibraryLocationValue,
  LibraryMethods,
  LibraryProgressRecord,
  LibraryReanchor,
} from '@librechat/data-schemas';
import type { DocumentDraft } from './ingest/saveDocument';
import { createAnchor, resolveAnchor } from './anchor/textQuote';
import { saveHtml, saveUrl } from './ingest/saveDocument';

type Methods = Pick<
  LibraryMethods,
  | 'saveLibraryDocument'
  | 'getLibraryDocument'
  | 'listLibraryDocuments'
  | 'searchLibraryDocuments'
  | 'updateLibraryDocument'
  | 'deleteLibraryDocument'
  | 'createLibraryHighlight'
  | 'listLibraryHighlights'
  | 'updateLibraryHighlight'
  | 'deleteLibraryHighlight'
  | 'reanchorLibraryHighlights'
  | 'getLibraryProgress'
  | 'setLibraryProgress'
>;

export interface LibraryServiceDeps {
  methods: Methods;
  /** Injected so tests (and a future isolated worker) can replace the network path. */
  saveUrl?: typeof saveUrl;
  saveHtml?: typeof saveHtml;
}

export interface SaveResult {
  document: LibraryDocumentSummary;
  created: boolean;
  /** Only meaningful when the page was saved before and its text changed. */
  reanchored: { kept: number; orphaned: number };
}

export type CreateHighlightOutcome =
  | { status: 'created'; highlight: LibraryHighlightRecord }
  | { status: 'not_found' }
  /** The client selected text in a version of the page the server no longer holds. */
  | { status: 'stale' }
  /** `anchor.exact` is not what the stored text says is at [start, end). */
  | { status: 'mismatch' };

function toSummary(doc: LibraryDocumentRecord): LibraryDocumentSummary {
  const { contentHtml: _html, text: _text, ...summary } = doc;
  return summary;
}

export function createLibraryService({ methods, ...injected }: LibraryServiceDeps) {
  const fetchUrl = injected.saveUrl ?? saveUrl;
  const fromHtml = injected.saveHtml ?? saveHtml;

  async function persist(
    userId: string,
    draft: DocumentDraft,
    location?: LibraryLocationValue,
  ): Promise<SaveResult> {
    const saved = await methods.saveLibraryDocument(userId, {
      urlKey: draft.urlKey,
      normalizedUrl: draft.normalizedUrl,
      title: draft.title,
      byline: draft.byline ?? undefined,
      siteName: draft.siteName ?? undefined,
      lang: draft.lang ?? undefined,
      publishedTime: draft.publishedTime ?? undefined,
      contentHtml: draft.contentHtml,
      text: draft.text,
      contentHash: draft.contentHash,
      wordCount: draft.wordCount,
      readingMinutes: draft.readingMinutes,
      fetchedAt: new Date(draft.fetchedAt),
      location,
    });
    const reanchored = saved.contentChanged
      ? await reanchor(userId, saved.document)
      : { kept: 0, orphaned: 0 };
    return { document: toSummary(saved.document), created: saved.created, reanchored };
  }

  /**
   * A page whose text changed keeps its highlights: each is re-resolved against the new text and
   * either moved or flagged as orphaned. Nothing is deleted. Highlights with a `unit` belong to
   * a chapter or page of a book, not this single text, and are left alone.
   */
  async function reanchor(
    userId: string,
    document: LibraryDocumentRecord,
  ): Promise<{ kept: number; orphaned: number }> {
    const highlights = await methods.listLibraryHighlights(userId, document.id);
    const results: LibraryReanchor[] = [];
    for (const highlight of highlights) {
      if (highlight.unit) continue;
      // Already anchored in exactly this text. An orphan is always retried: its stored hash is
      // that of the text it was last placed in, which can be the very text that just came back.
      if (!highlight.orphaned && highlight.contentHash === document.contentHash) continue;
      const match = resolveAnchor(document.text, highlight.anchor);
      results.push({
        id: highlight.id,
        anchor: match ? createAnchor(document.text, match.start, match.end) : null,
        contentHash: document.contentHash,
      });
    }
    await methods.reanchorLibraryHighlights(userId, document.id, results);
    const orphaned = results.filter((result) => result.anchor === null).length;
    return { kept: results.length - orphaned, orphaned };
  }

  return {
    async saveFromUrl(userId: string, url: string, location?: LibraryLocationValue) {
      return persist(userId, await fetchUrl(url), location);
    },

    /** For a client that already holds the rendered page: no server-side fetch happens. */
    async saveFromHtml(userId: string, url: string, html: string, location?: LibraryLocationValue) {
      return persist(userId, fromHtml(url, html), location);
    },

    list(userId: string, query: LibraryListQuery) {
      return methods.listLibraryDocuments(userId, query);
    },

    search(userId: string, query: string, limit: number) {
      return methods.searchLibraryDocuments(userId, query, limit);
    },

    get(userId: string, id: string) {
      return methods.getLibraryDocument(userId, id);
    },

    update(userId: string, id: string, patch: LibraryDocumentPatch) {
      return methods.updateLibraryDocument(userId, id, patch);
    },

    remove(userId: string, id: string) {
      return methods.deleteLibraryDocument(userId, id);
    },

    async createHighlight(
      userId: string,
      input: LibraryHighlightInput,
    ): Promise<CreateHighlightOutcome> {
      const document = await methods.getLibraryDocument(userId, input.documentId);
      if (!document) return { status: 'not_found' };
      if (input.unit) return { status: 'mismatch' };
      if (input.contentHash !== document.contentHash) return { status: 'stale' };
      const { start, end, exact } = input.anchor;
      if (end > document.text.length || document.text.slice(start, end) !== exact) {
        return { status: 'mismatch' };
      }
      const highlight = await methods.createLibraryHighlight(userId, input);
      return highlight ? { status: 'created', highlight } : { status: 'not_found' };
    },

    listHighlights(userId: string, documentId?: string, limit?: number) {
      return methods.listLibraryHighlights(userId, documentId, limit);
    },

    updateHighlight(userId: string, id: string, patch: LibraryHighlightPatch) {
      return methods.updateLibraryHighlight(userId, id, patch);
    },

    removeHighlight(userId: string, id: string) {
      return methods.deleteLibraryHighlight(userId, id);
    },

    getProgress(userId: string, documentId: string): Promise<LibraryProgressRecord | null> {
      return methods.getLibraryProgress(userId, documentId);
    },

    async setProgress(userId: string, documentId: string, textOffset: number) {
      const document = await methods.getLibraryDocument(userId, documentId);
      if (!document) return null;
      const offset = Math.min(Math.max(0, Math.trunc(textOffset)), document.text.length);
      return methods.setLibraryProgress(userId, documentId, offset, document.contentHash);
    },
  };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
