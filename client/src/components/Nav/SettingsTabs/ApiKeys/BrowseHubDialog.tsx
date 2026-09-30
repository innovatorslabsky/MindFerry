import { useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { Search, FolderOpen } from 'lucide-react';
import { isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import {
  Input,
  Button,
  Spinner,
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogTrigger,
  OGDialogContent,
} from '@librechat/client';
import type {
  THubNote,
  THubContinueRequest,
  THubSurface,
  THubThreadSummary,
  TListHubThreadsResponse,
} from 'librechat-data-provider';
import type { UseQueryResult } from '@tanstack/react-query';
import { HUB_SURFACES, SURFACE_LABEL_KEYS, matchesSurface, surfaceOf } from './surface';
import { useListHubThreadsQuery, useListHubNotesQuery } from '~/data-provider';
import HubThreadDetail from './HubThreadDetail';
import { useLocalize } from '~/hooks';
import store from '~/store';

function ThreadRow({ thread, onSelect }: { thread: THubThreadSummary; onSelect: () => void }) {
  const localize = useLocalize();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-surface-secondary"
      >
        <span className="text-sm font-medium text-text-primary">{thread.title}</span>
        <span className="text-xs text-text-secondary">
          {localize(SURFACE_LABEL_KEYS[surfaceOf(thread.surface)])} · {thread.provider} ·{' '}
          {new Date(thread.updatedAt).toLocaleString()} ·{' '}
          {localize('com_ui_context_hub_browse_message_count', { 0: thread.messageCount })}
        </span>
        {thread.snippet != null && (
          <span className="line-clamp-2 text-xs text-text-tertiary">{thread.snippet}</span>
        )}
      </button>
    </li>
  );
}

type ThreadsSectionProps = {
  query: string;
  threadsQuery: UseQueryResult<TListHubThreadsResponse>;
  onSelect: (id: string) => void;
};

/** Early-returns instead of a nested ternary for the loading/error/empty/list states. */
function ThreadsSection({ query, threadsQuery, onSelect }: ThreadsSectionProps) {
  const localize = useLocalize();

  if (threadsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="h-6 w-6 text-text-secondary" />
      </div>
    );
  }
  if (threadsQuery.isError) {
    return (
      <p className="py-6 text-center text-sm text-text-secondary">
        {localize('com_ui_context_hub_browse_load_error')}
      </p>
    );
  }

  const threads = threadsQuery.data?.threads ?? [];
  if (threads.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-secondary">
        {localize(
          query
            ? 'com_ui_context_hub_browse_empty_search'
            : 'com_ui_context_hub_browse_empty_threads',
        )}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border-light overflow-hidden rounded-xl border border-border-light">
      {threads.map((thread) => (
        <ThreadRow key={thread.id} thread={thread} onSelect={() => onSelect(thread.id)} />
      ))}
    </ul>
  );
}

function NoteRow({ note }: { note: THubNote }) {
  const localize = useLocalize();
  return (
    <li className="px-4 py-3">
      <p className="text-sm font-medium text-text-primary">{note.title}</p>
      <p className="text-xs text-text-secondary">
        {new Date(note.createdAt).toLocaleString()}
        {note.surface != null ? ` · ${localize(SURFACE_LABEL_KEYS[note.surface])}` : ''}
        {note.sessionTag != null ? ` · ${note.sessionTag}` : ''}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{note.text}</p>
    </li>
  );
}

function matchesQuery(note: THubNote, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return note.title.toLowerCase().includes(needle) || note.text.toLowerCase().includes(needle);
}

/**
 * The endpoint and model to run a continued chat on: the ones in use in the
 * chat the person has open. Agent and assistant chats are left out — they
 * need an agent or assistant id a plain conversation doesn't have — so the
 * server picks the deployment's default instead.
 */
function continueTargetOf(
  conversation: { endpoint?: string | null; model?: string | null } | null,
): THubContinueRequest | undefined {
  const endpoint = conversation?.endpoint;
  const model = conversation?.model;
  if (!endpoint || !model || isAgentsEndpoint(endpoint) || isAssistantsEndpoint(endpoint)) {
    return undefined;
  }
  return { endpoint, model };
}

/**
 * Browsing of the MindFerry archive for a person who wants to look
 * at what's in it directly, without going through an MCP client — the
 * counterpart to `search_context`/`get_thread`/`read_notes`.
 */
export default function BrowseHubDialog() {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const continueTarget = continueTargetOf(conversation);
  const [surface, setSurface] = useState<THubSurface | undefined>(undefined);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const threadsQuery = useListHubThreadsQuery(
    { q: query || undefined, limit: 50, surface },
    { enabled: open },
  );
  const notesQuery = useListHubNotesQuery(undefined, { enabled: open });

  const notes = (notesQuery.data?.notes ?? [])
    .filter((note) => matchesQuery(note, query) && matchesSurface(note.surface, surface))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setSurface(undefined);
      setSelectedThreadId(null);
    }
  };

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <OGDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          {localize('com_ui_context_hub_browse')}
        </Button>
      </OGDialogTrigger>
      <OGDialogContent
        className="flex h-[80vh] w-11/12 max-w-2xl flex-col"
        aria-describedby={undefined}
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_context_hub_browse_title')}</OGDialogTitle>
        </OGDialogHeader>
        {selectedThreadId != null ? (
          <HubThreadDetail
            threadId={selectedThreadId}
            onBack={() => setSelectedThreadId(null)}
            continueTarget={continueTarget}
            onContinued={(conversationId) => {
              handleOpenChange(false);
              navigate(`/c/${conversationId}`);
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={localize('com_ui_context_hub_browse_search_placeholder')}
                className="pl-9"
                aria-label={localize('com_ui_search')}
              />
            </div>
            <div
              role="group"
              aria-label={localize('com_ui_context_hub_browse_filter_label')}
              className="flex flex-wrap gap-2"
            >
              <Button
                variant="outline"
                size="sm"
                aria-pressed={surface === undefined}
                className={surface === undefined ? 'bg-surface-active' : undefined}
                onClick={() => setSurface(undefined)}
              >
                {localize('com_ui_context_hub_browse_filter_all')}
              </Button>
              {HUB_SURFACES.map((option) => (
                <Button
                  key={option}
                  variant="outline"
                  size="sm"
                  aria-pressed={surface === option}
                  className={surface === option ? 'bg-surface-active' : undefined}
                  onClick={() => setSurface(option)}
                >
                  {localize(SURFACE_LABEL_KEYS[option])}
                </Button>
              ))}
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
              {notes.length > 0 && (
                <div>
                  <h3 className="mb-1 px-1 text-xs font-medium uppercase text-text-secondary">
                    {localize('com_ui_context_hub_browse_notes_heading')}
                  </h3>
                  <ul className="divide-y divide-border-light overflow-hidden rounded-xl border border-border-light">
                    {notes.map((note) => (
                      <NoteRow key={note.id} note={note} />
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="mb-1 px-1 text-xs font-medium uppercase text-text-secondary">
                  {localize('com_ui_context_hub_browse_threads_heading')}
                </h3>
                <ThreadsSection
                  query={query}
                  threadsQuery={threadsQuery}
                  onSelect={setSelectedThreadId}
                />
              </div>
            </div>
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
