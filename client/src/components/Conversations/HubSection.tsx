import { memo } from 'react';
import { useSetAtom } from 'jotai';
import { ChevronDown } from 'lucide-react';
import { buttonVariants } from '@librechat/client';
import HubArchiveBrowser from '~/components/Nav/SettingsTabs/ApiKeys/HubArchiveBrowser';
import { setChatFilterStatusAtom } from './chatFilters';
import { useLocalize, useLocalStorage } from '~/hooks';
import { Collapse } from '~/components/ui';
import { cn } from '~/utils';

type HubSectionProps = {
  /** The Chat History search term, which this section follows instead of a field of its own. */
  query: string;
  /** Closes the drawer on a small screen once a chat has been opened. */
  toggleNav: () => void;
};

/**
 * The part of Archived that is not a MindFerry chat: conversations and notes
 * saved from Claude.ai, Claude Code and other clients, from the MindFerry
 * archive. MindFerry's own archived chats are the list below it, so their
 * archive copies are left out here. Continuing one opens it as a new chat and
 * returns to Chats, where that chat now is.
 */
const HubSection = memo(({ query, toggleNav }: HubSectionProps) => {
  const localize = useLocalize();
  const setStatus = useSetAtom(setChatFilterStatusAtom);
  const [isExpanded, setIsExpanded] = useLocalStorage('archiveHubSectionExpanded', true);

  return (
    <section className="px-2 pb-2" aria-label={localize('com_ui_context_hub_other_apps')}>
      <div className="flex h-8 w-full items-center pr-2">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(buttonVariants({ variant: 'section-header' }), 'group min-w-0 flex-1')}
          aria-expanded={isExpanded}
        >
          <span className="select-none truncate">{localize('com_ui_context_hub_other_apps')}</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none',
              isExpanded ? '' : '-rotate-90',
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      <Collapse open={isExpanded}>
        <div className="flex flex-col pt-1">
          <HubArchiveBrowser
            query={query}
            excludeLive={true}
            onContinued={() => {
              setStatus('active');
              toggleNav();
            }}
          />
        </div>
      </Collapse>
    </section>
  );
});

HubSection.displayName = 'HubSection';

export default HubSection;
