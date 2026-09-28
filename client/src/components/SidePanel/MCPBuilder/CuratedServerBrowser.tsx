import { useMemo, useState } from 'react';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
} from '@librechat/client';
import type { MCPServerFormData } from './MCPServerDialog/hooks/useMCPServerForm';
import type { CuratedServer } from './curatedServers';
import { curatedServers } from './curatedServers';
import MCPServerDialog from './MCPServerDialog';
import { useLocalize } from '~/hooks';

interface CuratedServerBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Browse curated servers" — a short, hand-picked list (see curatedServers.ts)
 * a user can prefill straight into `MCPServerDialog`'s create form, instead of
 * starting from a blank one. Never talks to the create API itself: picking an
 * entry only opens the same dialog and mutation every custom "Add MCP" already
 * uses, with `template` seeding the form's defaults.
 */
export default function CuratedServerBrowser({ open, onOpenChange }: CuratedServerBrowserProps) {
  const localize = useLocalize();
  const [selected, setSelected] = useState<CuratedServer | null>(null);

  // `template` must be stable across renders while the create dialog is open
  // (see the warning on useMCPServerForm's `template` param). Depending
  // directly on `selected?.template` is enough — `curatedServers` is a
  // module-level constant, so each entry's `template` object keeps the same
  // identity across renders and only changes when a different entry is picked.
  const template = useMemo<Partial<MCPServerFormData> | undefined>(
    () => selected?.template,
    [selected?.template],
  );

  return (
    <>
      <OGDialog open={open} onOpenChange={onOpenChange}>
        <OGDialogContent className="w-11/12 md:max-w-2xl">
          <OGDialogHeader>
            <OGDialogTitle>{localize('com_ui_browse_curated_mcp_servers')}</OGDialogTitle>
          </OGDialogHeader>
          <p className="text-sm text-text-secondary">
            {localize('com_ui_browse_curated_mcp_servers_description')}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {curatedServers.map((server) => (
              <li
                key={server.id}
                className="flex items-start gap-3 rounded-lg border border-border-light p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{server.title}</span>
                    <span className="text-xs text-text-tertiary">
                      {server.selfHosted
                        ? localize('com_ui_mcp_self_hosted')
                        : localize('com_ui_mcp_cloud_hosted')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">{server.description}</p>
                  <a
                    href={server.learnMoreUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-text-secondary underline"
                  >
                    {localize('com_ui_learn_more')}
                  </a>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setSelected(server);
                    onOpenChange(false);
                  }}
                >
                  {localize('com_ui_use_this')}
                </Button>
              </li>
            ))}
          </ul>
        </OGDialogContent>
      </OGDialog>

      {selected && (
        <MCPServerDialog
          open={selected != null}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setSelected(null);
            }
          }}
          template={template}
        />
      )}
    </>
  );
}
