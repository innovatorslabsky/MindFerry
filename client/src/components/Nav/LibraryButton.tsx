import { Library } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, TooltipAnchor } from '@librechat/client';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface LibraryButtonProps {
  side?: 'right' | 'bottom';
  /** Mobile dismisses the drawer on navigation; the desktop rail stays put. */
  onNavigate?: () => void;
  /** `icon` is the rail's square with a tooltip; `row` is the mobile drawer's labelled entry. */
  layout?: 'icon' | 'row';
}

/** Reading library entry in the sidebar. Self-gated on the operator having turned the library on. */
export default function LibraryButton({
  side = 'right',
  onNavigate,
  layout = 'icon',
}: LibraryButtonProps) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();

  if (startupConfig?.libraryEnabled !== true) {
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
        to="/library"
        data-testid="nav-library-button"
        aria-label={isRow ? undefined : localize('com_library_nav')}
        onClick={(event) => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
          }
          onNavigate?.();
        }}
      >
        <Library className="text-text-primary h-5 w-5 shrink-0" aria-hidden="true" />
        {isRow && (
          <span className="text-text-primary min-w-0 truncate text-sm font-medium">
            {localize('com_library_nav')}
          </span>
        )}
      </Link>
    </Button>
  );

  if (isRow) {
    return button;
  }
  return <TooltipAnchor side={side} description={localize('com_library_nav')} render={button} />;
}
