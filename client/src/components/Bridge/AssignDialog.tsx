import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Label, OGDialog, OGDialogTemplate, Spinner, Textarea } from '@librechat/client';
import type { TBridgeRole } from 'librechat-data-provider';
import type { FormEvent } from 'react';
import type { TranslationKeys } from '~/hooks';
import { bridgeAnswered, bridgeErrorCode, bridgeErrorDetail, bridgeErrorKey } from './errors';
import { useAssignBridgeRoleMutation } from '~/data-provider';
import { newRequestId } from './requestId';
import { useLocalize } from '~/hooks';

/**
 * Hands one task to a role. The id of the hand-over is kept while the answer is unknown, so a retry
 * after a dropped connection never starts a second run; any answer from the server ends it.
 */
export default function AssignDialog({
  role,
  maxTaskChars,
  onClose,
}: {
  role: TBridgeRole | null;
  maxTaskChars: number;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const [task, setTask] = useState('');
  const [problem, setProblem] = useState<{
    key: TranslationKeys;
    values?: Record<string, number>;
  }>();
  const [started, setStarted] = useState<{ chat?: string } | null>(null);
  const requestId = useRef(newRequestId());

  useEffect(() => {
    setTask('');
    setProblem(undefined);
    setStarted(null);
    requestId.current = newRequestId();
  }, [role?.id]);

  const mutation = useAssignBridgeRoleMutation({
    onSuccess: (data) => {
      setStarted(data.run.conversationId ? { chat: data.run.conversationId } : {});
      setTask('');
      requestId.current = newRequestId();
    },
    onError: (error) => {
      const code = bridgeErrorCode(error);
      const { used, cap } = bridgeErrorDetail(error);
      const fallback: TranslationKeys = 'com_bridge_roles_error_assign';
      setProblem({
        key: bridgeErrorKey(error, fallback),
        ...(code?.startsWith('CAP_') && used != null && cap != null
          ? { values: { 0: used, 1: cap } }
          : {}),
      });
      if (bridgeAnswered(error)) {
        requestId.current = newRequestId();
      }
    },
  });

  const left = maxTaskChars - task.length;
  const ready = role != null && task.trim().length >= 3 && left >= 0 && !mutation.isLoading;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !role) {
      return;
    }
    setProblem(undefined);
    setStarted(null);
    mutation.mutate({ id: role.id, body: { requestId: requestId.current, task } });
  };

  return (
    <OGDialog open={role != null} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        showCloseButton={true}
        title={localize('com_bridge_roles_assign_title', { 0: role?.name ?? '' })}
        className="w-11/12 max-w-xl"
        main={
          <form
            onSubmit={submit}
            className="flex flex-col gap-3 text-left"
            data-testid="assign-form"
          >
            <Label htmlFor="bridge-assign-task">{localize('com_bridge_roles_task')}</Label>
            <Textarea
              id="bridge-assign-task"
              value={task}
              rows={5}
              onChange={(e) => setTask(e.target.value)}
              aria-describedby="bridge-assign-count"
            />
            <p
              id="bridge-assign-count"
              className={
                left < 0 ? 'text-status-error-strong text-xs' : 'text-text-tertiary text-xs'
              }
            >
              {localize('com_bridge_roles_chars_left', { 0: left })}
            </p>
            <p className="text-text-tertiary text-xs">
              {localize(
                role != null && role.runtime !== 'app'
                  ? 'com_bridge_roles_assign_note_host'
                  : 'com_bridge_roles_assign_note',
              )}
            </p>
            {problem && (
              <p role="alert" className="text-text-primary text-sm" data-testid="assign-error">
                {localize(problem.key, problem.values)}
              </p>
            )}
            {started && (
              <p role="status" className="text-text-primary text-sm" data-testid="assign-started">
                {localize(
                  started.chat ? 'com_bridge_roles_started' : 'com_bridge_roles_started_host',
                )}
                {started.chat && (
                  <>
                    {' '}
                    <Link to={`/c/${encodeURIComponent(started.chat)}`} className="underline">
                      {localize('com_bridge_run_open')}
                    </Link>
                  </>
                )}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={!ready}>
                {mutation.isLoading && <Spinner className="mr-1.5 h-4 w-4" />}
                {localize('com_bridge_roles_send')}
              </Button>
            </div>
          </form>
        }
      />
    </OGDialog>
  );
}
