import { Bot } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { Button, TooltipAnchor } from '@librechat/client';
import { useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface BridgeButtonProps {
  side?: 'right' | 'bottom';
  /** Mobile dismisses the drawer on navigation; the desktop rail stays put. */
  onNavigate?: () => void;
  /** `icon` is the rail's square with a tooltip; `row` is the mobile drawer's labelled entry. */
  layout?: 'icon' | 'row';
}

/** Agents page entry in the sidebar. Shown only where the operator turned it on, and only to an admin. */
export default function BridgeButton({
  side = 'right',
  onNavigate,
  layout = 'icon',
}: BridgeButtonProps) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();

  if (startupConfig?.agentBridgeEnabled !== true || user?.role !== SystemRoles.ADMIN) {
    return null;
  }

  const isRow = layout === 'row';
  const button = (
    <Button
      asChild
      variant="ghost"
      size={isRow ? 'row' : 'icon'}
      className={cn('shrink-0', isRow ? 'w-full justify-start' : 'h-9 w-9')}
    >
      <Link
        to="/bridge"
        data-testid="nav-bridge-button"
        aria-label={isRow ? undefined : localize('com_bridge_nav')}
        onClick={(event) => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
          }
          onNavigate?.();
        }}
      >
        <Bot className="text-text-primary h-5 w-5 shrink-0" aria-hidden="true" />
        {isRow && (
          <span className="text-text-primary min-w-0 truncate text-sm font-medium">
            {localize('com_bridge_nav')}
          </span>
        )}
      </Link>
    </Button>
  );

  if (isRow) {
    return button;
  }
  return <TooltipAnchor side={side} description={localize('com_bridge_nav')} render={button} />;
}
