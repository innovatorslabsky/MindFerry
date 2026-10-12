import { useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import { Button, FilterInput, Spinner } from '@librechat/client';
import type { MCPDirectoryEntry } from 'librechat-data-provider';
import { useMCPDirectoryQuery } from '~/data-provider';
import { useDebounce, useLocalize } from '~/hooks';

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 30;

function DirectoryEntry({ entry }: { entry: MCPDirectoryEntry }) {
  const localize = useLocalize();
  return (
    <li className="border-border-light rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-primary text-sm font-medium">{entry.name}</span>
        <span className="text-text-tertiary text-xs">{entry.categoryName}</span>
        {entry.official && (
          <span className="text-text-tertiary text-xs">{localize('com_ui_mcp_official')}</span>
        )}
        {entry.scopes.includes('cloud') && (
          <span className="text-text-tertiary text-xs">{localize('com_ui_mcp_cloud_hosted')}</span>
        )}
        {entry.scopes.includes('local') && (
          <span className="text-text-tertiary text-xs">{localize('com_ui_mcp_self_hosted')}</span>
        )}
      </div>
      {entry.description && <p className="text-text-secondary mt-1 text-xs">{entry.description}</p>}
      <a
        href={entry.repoUrl}
        target="_blank"
        rel="noreferrer"
        className="text-text-secondary mt-1 inline-block text-xs underline"
      >
        {localize('com_ui_learn_more')}
      </a>
    </li>
  );
}

/**
 * The full awesome-mcp-servers listing, searchable and paged, shown under the
 * hand-picked servers. Entries link out to their repository only: the listing
 * carries no endpoint URL, and the user-managed create path accepts URL-based
 * servers alone, so a one-click prefill stays limited to the curated list above.
 * Renders nothing when the operator has not enabled the directory.
 */
export default function MCPDirectoryList() {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const query = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS);
  const params = useMemo(() => ({ q: query, limit: PAGE_SIZE }), [query]);
  const { data, error, isLoading, isError, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useMCPDirectoryQuery(params);

  const disabled = isError && isAxiosError(error) && error.response?.status === 404;
  if (disabled) {
    return null;
  }

  const entries = data?.pages.flatMap((page) => page.entries) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const sourceUrl = data?.pages[0]?.sourceUrl;

  return (
    <section aria-label={localize('com_ui_mcp_directory')} className="mt-4 flex flex-col gap-2">
      <h3 className="text-text-primary text-sm font-medium">{localize('com_ui_mcp_directory')}</h3>
      <p className="text-text-secondary text-xs">{localize('com_ui_mcp_directory_description')}</p>
      <FilterInput
        inputId="mcp-directory-filter"
        label={localize('com_ui_mcp_directory_search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {isLoading && (
        <div role="status" className="text-text-secondary flex items-center gap-2 text-xs">
          <Spinner className="size-4" aria-hidden="true" />
          {localize('com_ui_loading')}
        </div>
      )}
      {isError && (
        <p role="alert" className="text-text-secondary text-xs">
          {localize('com_ui_mcp_directory_error')}
        </p>
      )}
      {!isLoading && !isError && entries.length === 0 && (
        <p className="text-text-secondary text-xs">{localize('com_ui_mcp_directory_empty')}</p>
      )}
      {entries.length > 0 && (
        <>
          <p aria-live="polite" className="text-text-tertiary text-xs">
            {localize('com_ui_mcp_directory_count', { 0: entries.length, 1: total })}
          </p>
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {entries.map((entry) => (
              <DirectoryEntry key={entry.id} entry={entry} />
            ))}
          </ul>
        </>
      )}
      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {localize('com_ui_load_more')}
        </Button>
      )}
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-text-tertiary text-xs underline"
        >
          {localize('com_ui_mcp_directory_source')}
        </a>
      )}
    </section>
  );
}
