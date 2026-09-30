import { useState } from 'react';
import { Search } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import {
  Tabs,
  Input,
  Button,
  Spinner,
  TabsList,
  TabsContent,
  TabsTrigger,
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
import HubNoteList from './HubNoteList';
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

/** Chats come first: they are what "Continue in chat" works from, and notes are long enough to bury them. */
type ArchiveTab = 'chats' | 'notes';

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
 * The archive, for a person who wants to look at what's in it directly,
 * without going through an MCP client — the counterpart to
 * `search_context`/`get_thread`/`read_notes`. Search, a filter by the client
 * a conversation came from, the notes, and one conversation open in full
 * with "Continue in chat". Hosted by the Browse dialog in Settings and by the
 * Archive panel in the sidebar; `onContinued` lets the host tidy up (close
 * itself) once the new chat has been made and opened.
 */
type HubArchiveBrowserProps = {
  onContinued?: () => void;
  /** A search term the host already owns; given, the browser shows no search field of its own. */
  query?: string;
  /** Leave out MindFerry chats that are still in the chat list, for a host that lists those itself. */
  excludeLive?: boolean;
};

export default function HubArchiveBrowser({
  onContinued,
  query: hostQuery,
  excludeLive = false,
}: HubArchiveBrowserProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const continueTarget = continueTargetOf(conversation);
  const [ownQuery, setOwnQuery] = useState('');
  const query = hostQuery ?? ownQuery;
  const [surface, setSurface] = useState<THubSurface | undefined>(undefined);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [tab, setTab] = useState<ArchiveTab>('chats');

  const threadsQuery = useListHubThreadsQuery(
    { q: query || undefined, limit: 50, surface, excludeLive: excludeLive || undefined },
    { keepPreviousData: true },
  );
  const notesQuery = useListHubNotesQuery();

  const notes = (notesQuery.data?.notes ?? [])
    .filter((note) => matchesQuery(note, query) && matchesSurface(note.surface, surface))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const threadCount = threadsQuery.data?.threads.length ?? 0;
  const openChat = (conversationId: string) => {
    onContinued?.();
    navigate(`/c/${conversationId}`);
  };

  if (selectedThreadId != null) {
    return (
      <HubThreadDetail
        threadId={selectedThreadId}
        onBack={() => setSelectedThreadId(null)}
        continueTarget={continueTarget}
        onContinued={openChat}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {hostQuery === undefined && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setOwnQuery(event.target.value)}
            placeholder={localize('com_ui_context_hub_browse_search_placeholder')}
            className="pl-9"
            aria-label={localize('com_ui_search')}
          />
        </div>
      )}
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
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ArchiveTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList
          aria-label={localize('com_ui_context_hub_browse_tabs_label')}
          className="grid w-full grid-cols-2 bg-surface-secondary p-1"
        >
          <TabsTrigger value="chats" className="min-w-0">
            {localize('com_ui_context_hub_browse_tab_chats', { 0: threadCount })}
          </TabsTrigger>
          <TabsTrigger value="notes" className="min-w-0">
            {localize('com_ui_context_hub_browse_tab_notes', { 0: notes.length })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chats" className="mt-3 min-h-0 flex-1 overflow-y-auto p-0">
          <ThreadsSection
            query={query}
            threadsQuery={threadsQuery}
            onSelect={setSelectedThreadId}
          />
        </TabsContent>
        <TabsContent value="notes" className="mt-3 min-h-0 flex-1 overflow-y-auto p-0">
          <HubNoteList
            notes={notes}
            query={query}
            isLoading={notesQuery.isLoading}
            isError={notesQuery.isError}
            continueTarget={continueTarget}
            onContinued={openChat}
            onOpenThread={setSelectedThreadId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
