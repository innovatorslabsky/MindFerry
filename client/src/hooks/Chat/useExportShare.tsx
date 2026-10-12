import { useState, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import { Upload, Share2, Database } from 'lucide-react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useGetSharedLinkQuery } from 'librechat-data-provider/react-query';
import type { ReactNode } from 'react';
import type * as t from '~/common';
import { useGetStartupConfig, useArchiveConversationToHubMutation } from '~/data-provider';
import ExportModal from '~/components/Nav/ExportConversation/ExportModal';
import { ShareButton } from '~/components/Conversations/ConvoOptions';
import { useHasAccess, useLocalize } from '~/hooks';
import store from '~/store';

export type UseExportShareResult = {
  /** New and search conversations have nothing to export or share. */
  show: boolean;
  items: t.MenuItemProps[];
  hasSharedLink: boolean;
  /** Rendered by whichever surface owns the menu; both need the same instance. */
  dialogs: ReactNode;
};

/**
 * Export and share as menu items, so the desktop icon menu and the mobile
 * overflow menu share one set of items and one pair of dialogs.
 */
export default function useExportShare({
  isSharedButtonEnabled,
}: {
  isSharedButtonEnabled: boolean;
}): UseExportShareResult {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [showExports, setShowExports] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);

  const canCreateSharedLinks = useHasAccess({
    permissionType: PermissionTypes.SHARED_LINKS,
    permission: Permissions.CREATE,
  });
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const { data: startupConfig } = useGetStartupConfig();
  const contextHubEnabled = startupConfig?.contextHubEnabled === true;
  const { mutate: archiveToHub, isLoading: isArchivingToHub } = useArchiveConversationToHubMutation(
    {
      onSuccess: () => {
        showToast({ message: localize('com_ui_context_hub_save_success'), status: 'success' });
      },
      onError: () => {
        showToast({ message: localize('com_ui_context_hub_save_error'), status: 'error' });
      },
    },
  );

  const exportable =
    conversation != null &&
    conversation.conversationId != null &&
    conversation.conversationId !== 'new' &&
    conversation.conversationId !== 'search';

  /** Declared before the `exportable` gate so hook order stays stable. */
  const { data: share } = useGetSharedLinkQuery(conversation?.conversationId ?? '', {
    enabled: exportable && isSharedButtonEnabled,
  });

  const items: t.MenuItemProps[] = [
    {
      label: localize('com_ui_share'),
      onClick: () => setShowShareDialog(true),
      icon: <Share2 className="text-text-secondary size-4" />,
      show: isSharedButtonEnabled && canCreateSharedLinks,
      /** NOTE: THE FOLLOWING PROPS ARE REQUIRED FOR MENU ITEMS THAT OPEN DIALOGS */
      hideOnClick: false,
      ref: shareButtonRef,
      render: (props) => <button {...props} data-testid="share-conversation-menu-item" />,
    },
    {
      label: localize('com_endpoint_export'),
      onClick: () => setShowExports(true),
      icon: <Upload className="text-text-secondary size-4" />,
      /** NOTE: THE FOLLOWING PROPS ARE REQUIRED FOR MENU ITEMS THAT OPEN DIALOGS */
      hideOnClick: false,
      ref: exportButtonRef,
      render: (props) => <button {...props} />,
    },
    {
      label: localize('com_ui_context_hub_save'),
      onClick: () => {
        if (conversation?.conversationId) {
          archiveToHub(conversation.conversationId);
        }
      },
      icon: <Database className="text-text-secondary size-4" />,
      show: contextHubEnabled,
      disabled: isArchivingToHub,
      render: (props) => <button {...props} data-testid="context-hub-save-menu-item" />,
    },
  ];

  return {
    show: exportable,
    items,
    hasSharedLink: Boolean(share?.shareId),
    dialogs: exportable ? (
      <>
        <ExportModal
          open={showExports}
          onOpenChange={setShowExports}
          conversation={conversation}
          triggerRef={exportButtonRef}
          aria-label={localize('com_ui_export_convo_modal')}
        />
        <ShareButton
          triggerRef={shareButtonRef}
          conversationId={conversation.conversationId ?? ''}
          open={showShareDialog}
          onOpenChange={setShowShareDialog}
        />
      </>
    ) : null,
  };
}
