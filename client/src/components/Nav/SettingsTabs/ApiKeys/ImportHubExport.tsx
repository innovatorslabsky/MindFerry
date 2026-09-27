import { useState, useRef, useCallback } from 'react';
import { Import } from 'lucide-react';
import { Spinner, useToastContext, Label, Button } from '@librechat/client';
import { useImportHubExportMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { cn, logger } from '~/utils';

/**
 * Uploads a full-account export from ChatGPT, Claude.ai, or Gemini (Google
 * Takeout) so it gets archived into MindFerry's context hub — the UI half of
 * `POST /api/hub/import`, which already has adapters for all three formats.
 * Shown alongside `ContextHubEndpoint`, gated by the same `contextHubEnabled`
 * flag, since both are context-hub actions rather than ordinary API-key ones.
 */
export default function ImportHubExport() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleSuccess = useCallback(
    (data: { threadCount: number }) => {
      showToast({
        message: localize('com_ui_context_hub_import_success', { 0: data.threadCount }),
        status: NotificationSeverity.SUCCESS,
      });
      setIsUploading(false);
    },
    [localize, showToast],
  );

  const handleError = useCallback(
    (error: unknown) => {
      logger.error('Context hub import error:', error);
      setIsUploading(false);

      const isUnsupportedType = error?.toString().includes('unsupported_export');

      showToast({
        message: localize(
          isUnsupportedType
            ? 'com_ui_context_hub_import_file_type_error'
            : 'com_ui_context_hub_import_error',
        ),
        status: NotificationSeverity.ERROR,
      });
    },
    [localize, showToast],
  );

  const importFile = useImportHubExportMutation({
    onSuccess: handleSuccess,
    onError: handleError,
    onMutate: () => setIsUploading(true),
  });

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }
      const formData = new FormData();
      formData.append('file', file, encodeURIComponent(file.name || 'export.json'));
      importFile.mutate(formData);
    },
    [importFile],
  );

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleImportClick();
      }
    },
    [handleImportClick],
  );

  return (
    <div className="flex items-center justify-between">
      <Label id="import-hub-export-label">{localize('com_ui_context_hub_import_info')}</Label>
      <Button
        variant="outline"
        onClick={handleImportClick}
        onKeyDown={handleKeyDown}
        disabled={isUploading}
        aria-label={localize('com_ui_import')}
        aria-labelledby="import-hub-export-label"
      >
        {isUploading ? (
          <>
            <Spinner className="mr-1 w-4" />
            <span>{localize('com_ui_importing')}</span>
          </>
        ) : (
          <>
            <Import className="mr-1 flex h-4 w-4 items-center stroke-1" aria-hidden="true" />
            <span>{localize('com_ui_import')}</span>
          </>
        )}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        className={cn('hidden')}
        accept=".json"
        onChange={handleFileChange}
        aria-hidden="true"
      />
    </div>
  );
}
