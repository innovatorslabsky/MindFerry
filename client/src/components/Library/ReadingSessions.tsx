import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Input, useToastContext } from '@librechat/client';
import {
  useAddLibrarySessionMutation,
  useDeleteLibrarySessionMutation,
  useLibrarySessionsQuery,
} from '~/data-provider';
import { durationLabel, sessionCountLabel } from './readingTime';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

const SHOWN = 5;

/** The day a session was in, in the reader's own format. */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString();

/** How long a document has been read, the latest sessions, and a way to add reading done elsewhere. */
export default function ReadingSessions({ documentId }: { documentId: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [minutes, setMinutes] = useState('');
  const { data } = useLibrarySessionsQuery(documentId);
  const fail = () =>
    showToast({
      message: localize('com_library_sessions_error'),
      status: NotificationSeverity.ERROR,
    });
  const add = useAddLibrarySessionMutation({ onSuccess: () => setMinutes(''), onError: fail });
  const remove = useDeleteLibrarySessionMutation({ onError: fail });

  const amount = Number(minutes);
  const valid =
    minutes.trim() !== '' && Number.isInteger(amount) && amount >= 1 && amount <= 24 * 60;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (valid) {
      add.mutate({ id: documentId, session: { minutes: amount } });
    }
  };
  const total = data?.totals;

  return (
    <section className="flex flex-col gap-2" data-testid="library-sessions">
      <h3 className="text-text-primary text-sm font-semibold">
        {localize('com_library_sessions')}
      </h3>
      <p className="text-text-secondary text-sm" data-testid="library-sessions-total">
        {total && total.sessions > 0
          ? `${durationLabel(total.seconds, localize)} · ${sessionCountLabel(total.sessions, localize)}`
          : localize('com_library_sessions_none')}
      </p>
      {data && data.sessions.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm">
          {data.sessions.slice(0, SHOWN).map((session) => (
            <li key={session.id} className="flex items-center gap-2" data-testid="library-session">
              <span className="text-text-secondary">{dayOf(session.startedAt)}</span>
              <span className="text-text-primary">
                {durationLabel(session.activeSeconds, localize)}
              </span>
              {session.kind === 'manual' && (
                <>
                  <span className="text-text-secondary text-xs">
                    {localize('com_library_session_manual')}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-6 w-6"
                    aria-label={localize('com_library_session_delete')}
                    disabled={remove.isLoading}
                    onClick={() => remove.mutate({ id: documentId, sid: session.id })}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={submit}
        className="flex items-center gap-2"
        data-testid="library-session-form"
      >
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={24 * 60}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          placeholder={localize('com_library_session_minutes')}
          aria-label={localize('com_library_session_minutes')}
          className="w-44"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!valid || add.isLoading}>
          {localize('com_library_session_log')}
        </Button>
      </form>
    </section>
  );
}
