import type { TImportResponse, TImportTarget } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { NotificationSeverity } from '~/common';

export type ImportToast = {
  key: TranslationKeys;
  count?: number;
  status: NotificationSeverity;
};

/**
 * What to tell the person after an import, from the target they picked and
 * how each destination went. A side that could not take the file is named, so
 * a partial import does not read as a full one.
 */
export function importToastFor(target: TImportTarget, response: TImportResponse): ImportToast {
  const chats = response.chats?.status === 'imported';
  const archive = response.archive?.status === 'imported';
  const count = response.archive?.threadCount;

  if (chats && archive) {
    return { key: 'com_ui_import_success_both', status: NotificationSeverity.SUCCESS };
  }
  if (archive) {
    return target === 'both'
      ? { key: 'com_ui_import_partial_archive', count, status: NotificationSeverity.WARNING }
      : { key: 'com_ui_import_success_archive', count, status: NotificationSeverity.SUCCESS };
  }
  if (target === 'both' && response.archive != null) {
    return { key: 'com_ui_import_partial_chats', status: NotificationSeverity.WARNING };
  }
  return { key: 'com_ui_import_conversation_success', status: NotificationSeverity.SUCCESS };
}

/** Whether a failed import was refused because neither destination reads the file's format. */
export function isUnsupportedImport(error: unknown): boolean {
  const code = (error as { response?: { data?: { error?: { code?: unknown } } } })?.response?.data
    ?.error?.code;
  return code === 'unsupported_export' || String(error).includes('Unsupported import type');
}
