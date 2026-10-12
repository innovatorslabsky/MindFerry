export type MCPDirectoryScope = 'cloud' | 'local' | 'embedded';

export interface MCPDirectoryEntry {
  /** `owner/repo` as listed upstream; stable across refreshes. */
  id: string;
  name: string;
  repoUrl: string;
  description: string;
  categoryId: string;
  categoryName: string;
  scopes: MCPDirectoryScope[];
  official: boolean;
}

export interface MCPDirectoryCategory {
  id: string;
  name: string;
  count: number;
}

export interface MCPDirectoryParams {
  q?: string;
  category?: string;
  scope?: MCPDirectoryScope;
  cursor?: string;
  limit?: number;
}

export interface MCPDirectoryResponse {
  entries: MCPDirectoryEntry[];
  total: number;
  /** Opaque; pass back as `cursor` for the next page. Absent on the last page. */
  nextCursor?: string;
  categories: MCPDirectoryCategory[];
  /** Where the listing comes from, shown as attribution. */
  sourceUrl: string;
  fetchedAt: string;
}
