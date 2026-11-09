import { useState } from 'react';
import { Button, Label, Spinner, Textarea, useToastContext } from '@librechat/client';
import type { TBridgeAgent, TBridgeCreateRequest, TBridgePriority } from 'librechat-data-provider';
import type { FormEvent } from 'react';
import type { TranslationKeys } from '~/hooks';
import { useCreateBridgeTaskMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { bridgeErrorKey } from './errors';
import { useLocalize } from '~/hooks';

const AGENTS: Array<{ id: TBridgeAgent; name: string }> = [
  { id: 'hermes', name: 'Hermes' },
  { id: 'openclaw', name: 'OpenClaw' },
];

const PRIORITIES: Array<{ id: TBridgePriority; label: TranslationKeys }> = [
  { id: 'low', label: 'com_bridge_priority_low' },
  { id: 'normal', label: 'com_bridge_priority_normal' },
  { id: 'high', label: 'com_bridge_priority_high' },
];

/**
 * Writes one task file into the agents' inbox. Nothing runs now: an agent picks the file up on its
 * next poll. The person can read the exact file first, and the form says what is always forbidden.
 */
export default function NewTaskForm({
  maxTaskChars,
  maxFieldChars,
}: {
  maxTaskChars: number;
  maxFieldChars: number;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [to, setTo] = useState<TBridgeAgent>('hermes');
  const [priority, setPriority] = useState<TBridgePriority>('normal');
  const [task, setTask] = useState('');
  const [output, setOutput] = useState('');
  const [constraints, setConstraints] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<TranslationKeys | null>(null);

  const toast = (message: string, status: NotificationSeverity) => showToast({ message, status });
  const mutation = useCreateBridgeTaskMutation();

  const request = (dryRun: boolean): TBridgeCreateRequest => ({
    to,
    task,
    priority,
    dryRun,
    ...(output.trim() ? { output } : {}),
    ...(constraints.trim() ? { constraints } : {}),
  });

  const left = maxTaskChars - task.length;
  const ready = task.trim().length >= 3 && left >= 0 && !mutation.isLoading;

  const reset = () => {
    setTask('');
    setOutput('');
    setConstraints('');
    setPreview(null);
    setProblem(null);
  };

  const run = (dryRun: boolean) => {
    setProblem(null);
    mutation.mutate(request(dryRun), {
      onSuccess: (data) => {
        if (dryRun) {
          setPreview(data.content);
          return;
        }
        reset();
        toast(localize('com_bridge_created'), NotificationSeverity.SUCCESS);
      },
      onError: (error) => {
        setProblem(bridgeErrorKey(error, 'com_bridge_error_create'));
      },
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) {
      run(false);
    }
  };

  return (
    <section aria-labelledby="bridge-new-heading" className="flex flex-col gap-3">
      <h2 id="bridge-new-heading" className="text-text-primary text-lg font-semibold">
        {localize('com_bridge_new')}
      </h2>
      <form
        onSubmit={submit}
        className="border-border-light bg-surface-primary flex flex-col gap-4 rounded-xl border p-4"
        data-testid="bridge-form"
      >
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div role="group" aria-label={localize('com_bridge_field_to')} className="flex gap-1.5">
            {AGENTS.map((agent) => (
              <Button
                key={agent.id}
                type="button"
                size="sm"
                variant="outline-toggle"
                aria-pressed={to === agent.id}
                onClick={() => setTo(agent.id)}
                data-testid={`bridge-to-${agent.id}`}
              >
                {agent.name}
              </Button>
            ))}
          </div>
          <div
            role="group"
            aria-label={localize('com_bridge_field_priority')}
            className="flex gap-1.5"
          >
            {PRIORITIES.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant="outline-toggle"
                aria-pressed={priority === option.id}
                onClick={() => setPriority(option.id)}
              >
                {localize(option.label)}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bridge-task">{localize('com_bridge_field_task')}</Label>
          <Textarea
            id="bridge-task"
            value={task}
            onChange={(event) => {
              setTask(event.target.value);
              setPreview(null);
            }}
            rows={4}
            aria-describedby="bridge-task-hint"
            data-testid="bridge-task-input"
          />
          <p
            id="bridge-task-hint"
            className={`text-xs ${left < 0 ? 'text-text-primary font-medium' : 'text-text-tertiary'}`}
          >
            {localize('com_bridge_task_hint', { 0: left })}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bridge-output">{localize('com_bridge_field_output')}</Label>
            <Textarea
              id="bridge-output"
              value={output}
              maxLength={maxFieldChars}
              onChange={(event) => {
                setOutput(event.target.value);
                setPreview(null);
              }}
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bridge-constraints">{localize('com_bridge_field_constraints')}</Label>
            <Textarea
              id="bridge-constraints"
              value={constraints}
              maxLength={maxFieldChars}
              onChange={(event) => {
                setConstraints(event.target.value);
                setPreview(null);
              }}
              rows={2}
            />
          </div>
        </div>

        <p className="text-text-secondary bg-surface-secondary rounded-lg px-3 py-2 text-xs">
          {localize('com_bridge_forbidden_note')}
        </p>

        {problem && (
          <p role="alert" className="text-text-primary text-sm" data-testid="bridge-form-error">
            {localize(problem)}
          </p>
        )}

        {preview && (
          <div className="flex flex-col gap-1.5" data-testid="bridge-preview">
            <p className="text-text-secondary text-xs">{localize('com_bridge_preview_title')}</p>
            <pre className="border-border-light bg-surface-secondary text-text-primary overflow-x-auto rounded-lg border p-3 text-xs break-words whitespace-pre-wrap">
              {preview}
            </pre>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!ready}
            onClick={() => run(true)}
            data-testid="bridge-preview-button"
          >
            {localize('com_bridge_preview')}
          </Button>
          <Button type="submit" disabled={!ready} data-testid="bridge-create-button">
            {mutation.isLoading && <Spinner className="mr-1.5 h-4 w-4" />}
            {localize('com_bridge_create')}
          </Button>
        </div>
      </form>
    </section>
  );
}
