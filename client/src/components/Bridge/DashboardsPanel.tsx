import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button, useToastContext } from '@librechat/client';
import type { TBridgeDashboard } from 'librechat-data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

/**
 * Links to the agents' own dashboards. Those pages listen on the host only, so they work after the
 * tunnel is open and not before; the panel says so and gives the command to open it.
 */
export default function DashboardsPanel({
  dashboards,
  tunnelCommand,
}: {
  dashboards: TBridgeDashboard[];
  tunnelCommand?: string;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!tunnelCommand) {
      return;
    }
    try {
      await navigator.clipboard.writeText(tunnelCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast({ message: localize('com_ui_copy_failed'), status: NotificationSeverity.ERROR });
    }
  };

  return (
    <section aria-labelledby="bridge-dash-heading" className="flex flex-col gap-3">
      <h2 id="bridge-dash-heading" className="text-text-primary text-lg font-semibold">
        {localize('com_bridge_dashboards')}
      </h2>
      <div className="border-border-light bg-surface-primary flex flex-col gap-3 rounded-xl border p-4 text-sm">
        <p className="text-text-secondary">{localize('com_bridge_dashboards_hint')}</p>
        {dashboards.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {dashboards.map((dashboard) => (
              <li key={dashboard.url}>
                <Button asChild variant="outline" size="sm">
                  <a href={dashboard.url} target="_blank" rel="noopener noreferrer">
                    {dashboard.name}
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {tunnelCommand && (
          <div className="flex items-center gap-2">
            <code
              className="border-border-medium bg-surface-secondary text-text-primary min-w-0 flex-1 overflow-x-auto rounded-lg border px-3 py-2 text-xs whitespace-nowrap"
              data-testid="bridge-tunnel"
            >
              {tunnelCommand}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? (
                <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              {localize(copied ? 'com_ui_copied' : 'com_ui_copy_to_clipboard')}
            </Button>
          </div>
        )}
        <p className="text-text-tertiary text-xs">{localize('com_bridge_browser_note')}</p>
      </div>
    </section>
  );
}
