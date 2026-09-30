import { useAtomValue, useSetAtom } from 'jotai';
import { Tabs, TabsList, TabsTrigger } from '@librechat/client';
import type { ChatFilterStatus } from './chatFilters';
import { chatFilterStatusAtom, setChatFilterStatusAtom } from './chatFilters';
import { useLocalize } from '~/hooks';

/**
 * Chats and Archived as two tabs over the one chat list, so archiving and
 * restoring are a tab away instead of inside the filter menu. Drives the same
 * status the filter menu does.
 */
export default function StatusTabs() {
  const localize = useLocalize();
  const status = useAtomValue(chatFilterStatusAtom);
  const setStatus = useSetAtom(setChatFilterStatusAtom);

  return (
    <Tabs value={status} onValueChange={(value) => setStatus(value as ChatFilterStatus)}>
      <TabsList
        aria-label={localize('com_ui_chat_list_status')}
        className="grid w-full grid-cols-2 bg-surface-secondary p-1"
      >
        <TabsTrigger value="active" className="min-w-0">
          {localize('com_ui_chats')}
        </TabsTrigger>
        <TabsTrigger value="archived" className="min-w-0">
          {localize('com_ui_archived')}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
