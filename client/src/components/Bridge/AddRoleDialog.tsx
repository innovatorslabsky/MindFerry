import { useEffect, useMemo, useState } from 'react';
import { PermissionBits } from 'librechat-data-provider';
import { Button, Label, OGDialog, OGDialogTemplate, Spinner, Textarea } from '@librechat/client';
import type { TBridgeRoleRuntime, TBridgeRoleTemplate } from 'librechat-data-provider';
import type { FormEvent } from 'react';
import { useCreateBridgeRoleMutation, useListAgentsQuery } from '~/data-provider';
import { bridgeErrorKey } from './errors';
import { useLocalize } from '~/hooks';

/** Matches what the server accepts: the name of a file in the roles folder, without `.md`. */
const ROLE_FILE = /^[a-z0-9][a-z0-9-]{0,79}$/;

const inputClass =
  'border-border-light bg-surface-primary text-text-primary w-full rounded-lg border px-3 py-2 text-sm';

/**
 * Adds a role. It runs as an agent the person already has in MindFerry, or, when the operator has
 * opened host roles, on Hermes or OpenClaw from a role file kept in the tasks folder.
 */
export default function AddRoleDialog({
  open,
  onClose,
  templates,
  maxBriefChars,
  fileRolesEnabled,
}: {
  open: boolean;
  onClose: () => void;
  templates: TBridgeRoleTemplate[];
  maxBriefChars: number;
  fileRolesEnabled: boolean;
}) {
  const localize = useLocalize();
  const [runtime, setRuntime] = useState<TBridgeRoleRuntime>('app');
  const [roleFile, setRoleFile] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [brief, setBrief] = useState('');
  const [problem, setProblem] = useState<ReturnType<typeof bridgeErrorKey>>();

  const { data: agents } = useListAgentsQuery(
    { requiredPermission: PermissionBits.VIEW },
    { select: (res) => res.data },
  );
  const agentList = useMemo(() => agents ?? [], [agents]);

  useEffect(() => {
    if (open) {
      setRuntime('app');
      setRoleFile('');
      setTemplateId('');
      setName('');
      setAgentId('');
      setBrief('');
      setProblem(undefined);
    }
  }, [open]);

  const mutation = useCreateBridgeRoleMutation({
    onSuccess: onClose,
    onError: (error) => setProblem(bridgeErrorKey(error, 'com_bridge_roles_error_save')),
  });

  const pick = (id: string) => {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (template) {
      setName(template.name);
      setBrief(template.brief);
    }
  };

  const onHost = runtime !== 'app';
  const roleFileOk = ROLE_FILE.test(roleFile);
  const ready =
    name.trim().length > 0 &&
    (onHost ? roleFileOk : agentId !== '' && brief.length <= maxBriefChars) &&
    !mutation.isLoading;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) {
      return;
    }
    setProblem(undefined);
    mutation.mutate(
      onHost
        ? { name, runtime, roleFile }
        : {
            name,
            agentId,
            brief,
            runtime: 'app',
            ...(templateId ? { templateId } : {}),
          },
    );
  };

  return (
    <OGDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <OGDialogTemplate
        showCloseButton={true}
        title={localize('com_bridge_roles_add')}
        className="w-11/12 max-w-xl"
        main={
          <form
            onSubmit={submit}
            className="flex flex-col gap-3 text-left"
            data-testid="add-role-form"
          >
            {fileRolesEnabled && (
              <>
                <Label htmlFor="bridge-role-runtime">{localize('com_bridge_roles_runtime')}</Label>
                <select
                  id="bridge-role-runtime"
                  className={inputClass}
                  value={runtime}
                  onChange={(e) => setRuntime(e.target.value as TBridgeRoleRuntime)}
                >
                  <option value="app">{localize('com_bridge_roles_runtime_app')}</option>
                  <option value="hermes">{localize('com_bridge_roles_runtime_hermes')}</option>
                  <option value="openclaw">{localize('com_bridge_roles_runtime_openclaw')}</option>
                </select>
              </>
            )}

            {!onHost && (
              <>
                <Label htmlFor="bridge-role-template">
                  {localize('com_bridge_roles_template')}
                </Label>
                <select
                  id="bridge-role-template"
                  className={inputClass}
                  value={templateId}
                  onChange={(e) => pick(e.target.value)}
                >
                  <option value="">{localize('com_bridge_roles_template_none')}</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <Label htmlFor="bridge-role-name">{localize('com_bridge_roles_name')}</Label>
            <input
              id="bridge-role-name"
              className={inputClass}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />

            {onHost ? (
              <>
                <Label htmlFor="bridge-role-file">{localize('com_bridge_roles_role_file')}</Label>
                <input
                  id="bridge-role-file"
                  className={inputClass}
                  value={roleFile}
                  maxLength={80}
                  aria-invalid={roleFile !== '' && !roleFileOk}
                  onChange={(e) => setRoleFile(e.target.value.trim())}
                />
                <p className="text-text-tertiary text-xs">
                  {localize('com_bridge_roles_role_file_note')}
                </p>
              </>
            ) : (
              <>
                <Label htmlFor="bridge-role-agent">{localize('com_bridge_roles_agent')}</Label>
                <select
                  id="bridge-role-agent"
                  className={inputClass}
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  <option value="">{localize('com_bridge_roles_agent_pick')}</option>
                  {agentList.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name || agent.id}
                    </option>
                  ))}
                </select>
                <p className="text-text-tertiary text-xs">
                  {localize('com_bridge_roles_agent_note')}
                </p>

                <Label htmlFor="bridge-role-brief">{localize('com_bridge_roles_brief')}</Label>
                <Textarea
                  id="bridge-role-brief"
                  value={brief}
                  rows={6}
                  onChange={(e) => setBrief(e.target.value)}
                />
                <p className="text-text-tertiary text-xs">
                  {localize('com_bridge_roles_chars_left', { 0: maxBriefChars - brief.length })}
                </p>
              </>
            )}

            {problem && (
              <p role="alert" className="text-text-primary text-sm" data-testid="add-role-error">
                {localize(problem)}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={!ready}>
                {mutation.isLoading && <Spinner className="mr-1.5 h-4 w-4" />}
                {localize('com_bridge_roles_create')}
              </Button>
            </div>
          </form>
        }
      />
    </OGDialog>
  );
}
