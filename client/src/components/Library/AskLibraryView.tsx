import { useState } from 'react';
import { useRecoilValue } from 'recoil';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input, Spinner, useToastContext } from '@librechat/client';
import type { TLibraryAskMode } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useLibraryCountQuery, useStartLibraryAskMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { libraryErrorKey } from './errors';
import { targetOf } from './chatTarget';
import { useLocalize } from '~/hooks';
import store from '~/store';

const MODES: {
  mode: TLibraryAskMode;
  label: TranslationKeys;
  hint: TranslationKeys;
  needsTopic: boolean;
}[] = [
  {
    mode: 'find',
    label: 'com_library_ask_mode_find',
    hint: 'com_library_ask_mode_find_hint',
    needsTopic: true,
  },
  {
    mode: 'learn',
    label: 'com_library_ask_mode_learn',
    hint: 'com_library_ask_mode_learn_hint',
    needsTopic: true,
  },
  {
    mode: 'research',
    label: 'com_library_ask_mode_research',
    hint: 'com_library_ask_mode_research_hint',
    needsTopic: true,
  },
  {
    mode: 'catchup',
    label: 'com_library_ask_mode_catchup',
    hint: 'com_library_ask_mode_catchup_hint',
    needsTopic: false,
  },
  {
    mode: 'recommend',
    label: 'com_library_ask_mode_recommend',
    hint: 'com_library_ask_mode_recommend_hint',
    needsTopic: false,
  },
];

/**
 * "Ask your library": pick what to do (find, learn, research, catch up, recommend), say what about
 * if it needs a topic, and a new chat opens with the best-matching saved documents in front of it.
 */
export default function AskLibraryView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const count = useLibraryCountQuery();
  const [mode, setMode] = useState<TLibraryAskMode>('find');
  const [topic, setTopic] = useState('');

  const start = useStartLibraryAskMutation({
    onSuccess: ({ conversationId }) => navigate(`/c/${conversationId}`),
    onError: (error) =>
      showToast({
        message: localize(libraryErrorKey(error, 'com_library_ask_library_error')),
        status: NotificationSeverity.ERROR,
      }),
  });

  const current = MODES.find((entry) => entry.mode === mode) ?? MODES[0];
  const trimmed = topic.trim();
  const ready = !current.needsTopic || trimmed.length > 0;

  const submit = () => {
    if (!ready || start.isLoading) {
      return;
    }
    start.mutate({
      mode,
      ...(current.needsTopic ? { topic: trimmed } : {}),
      ...targetOf(conversation),
    });
  };

  return (
    <div className="bg-surface-primary h-full w-full overflow-y-auto" data-testid="library-ask">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link to="/library" aria-label={localize('com_library_back')}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <h1 className="text-text-primary text-xl font-semibold">
            {localize('com_library_ask_library_title')}
          </h1>
        </div>

        <p className="text-text-secondary text-sm" data-testid="library-ask-count">
          {count.data
            ? localize('com_library_ask_library_count', { 0: count.data.count })
            : localize('com_library_ask_library_intro')}
        </p>

        <div
          role="group"
          aria-label={localize('com_library_ask_library_modes')}
          className="flex flex-wrap gap-2"
        >
          {MODES.map((entry) => (
            <Button
              key={entry.mode}
              type="button"
              size="sm"
              variant="outline-toggle"
              aria-pressed={mode === entry.mode}
              onClick={() => setMode(entry.mode)}
            >
              {localize(entry.label)}
            </Button>
          ))}
        </div>

        <p className="text-text-secondary text-sm">{localize(current.hint)}</p>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {current.needsTopic && (
            <Input
              value={topic}
              maxLength={300}
              onChange={(event) => setTopic(event.target.value)}
              aria-label={localize('com_library_ask_library_topic')}
              placeholder={localize('com_library_ask_library_topic')}
            />
          )}
          <div>
            <Button type="submit" disabled={!ready || start.isLoading}>
              {start.isLoading && <Spinner className="mr-1.5 h-4 w-4" />}
              {localize('com_library_ask_library_start')}
            </Button>
          </div>
        </form>

        <p className="text-text-secondary text-xs">{localize('com_library_ask_library_note')}</p>
      </div>
    </div>
  );
}
