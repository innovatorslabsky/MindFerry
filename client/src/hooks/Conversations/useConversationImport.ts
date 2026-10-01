import { useCallback, useState } from 'react';
import { useToastContext } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import type { TImportTarget, TStartupConfig } from 'librechat-data-provider';
import {
  startupConfigKey,
  useGetStartupConfig,
  useUploadConversationsMutation,
} from '~/data-provider';
import { importToastFor, isUnsupportedImport } from '~/components/Nav/SettingsTabs/Data/outcome';
import { NotificationSeverity } from '~/common';
import useLocalize from '~/hooks/useLocalize';
import { logger } from '~/utils';

/**
 * Uploads a conversation export to the chat list, the MindFerry archive, or
 * both, and tells the person how each side went. Shared by every place that
 * offers Import, so the size check, the destination and the messages are the
 * same wherever the file is picked. `hubEnabled` says whether the archive is
 * a destination at all; without it every import goes to the chats.
 */
export default function useConversationImport() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const { data: startupConfig } = useGetStartupConfig();
  const hubEnabled = startupConfig?.contextHubEnabled === true;
  const [isUploading, setIsUploading] = useState(false);

  const uploadFile = useUploadConversationsMutation({
    onMutate: () => setIsUploading(true),
  });

  const importFile = useCallback(
    (file: File, requested: TImportTarget) => {
      const target: TImportTarget = hubEnabled ? requested : 'chats';
      const config = queryClient.getQueryData<TStartupConfig>(startupConfigKey(true));
      const maxFileSize = config?.conversationImportMaxFileSize;
      if (maxFileSize && file.size > maxFileSize) {
        showToast({
          message: localize('com_error_files_upload_too_large', {
            0: (maxFileSize / (1024 * 1024)).toFixed(2),
          }),
          status: NotificationSeverity.ERROR,
        });
        return;
      }

      const formData = new FormData();
      formData.append('target', target);
      formData.append('file', file, encodeURIComponent(file.name || 'File'));
      setIsUploading(true);
      uploadFile.mutate(formData, {
        onSuccess: (response) => {
          const toast = importToastFor(target, response);
          showToast({
            message: localize(toast.key, { 0: toast.count ?? 0 }),
            status: toast.status,
          });
          setIsUploading(false);
        },
        onError: (error) => {
          logger.error('Import error:', error);
          setIsUploading(false);
          showToast({
            message: localize(
              isUnsupportedImport(error)
                ? 'com_ui_import_conversation_file_type_error'
                : 'com_ui_import_conversation_error',
            ),
            status: NotificationSeverity.ERROR,
          });
        },
      });
    },
    [hubEnabled, localize, queryClient, showToast, uploadFile],
  );

  return { hubEnabled, isUploading, importFile };
}
