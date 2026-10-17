import { Download } from 'lucide-react';
import { Button, useToastContext } from '@librechat/client';
import { useExportLibraryHighlightsMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { saveBlob } from '~/utils/saveBlob';
import { useLocalize } from '~/hooks';

type Format = 'markdown' | 'csv';
const FORMATS: ReadonlyArray<{
  format: Format;
  label: 'com_library_export_markdown' | 'com_library_export_csv';
}> = [
  { format: 'markdown', label: 'com_library_export_markdown' },
  { format: 'csv', label: 'com_library_export_csv' },
];

/** Download the highlights of one document, or of everything saved, as Markdown or CSV. */
export default function ExportButtons({ documentId }: { documentId?: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const exportFile = useExportLibraryHighlightsMutation({
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename),
    onError: () =>
      showToast({
        message: localize('com_library_export_error'),
        status: NotificationSeverity.ERROR,
      }),
  });
  return (
    <div
      role="group"
      aria-label={localize('com_library_export')}
      className="flex items-center gap-1"
      data-testid="library-export"
    >
      <Download className="text-text-secondary h-4 w-4" aria-hidden="true" />
      {FORMATS.map(({ format, label }) => (
        <Button
          key={format}
          type="button"
          variant="ghost"
          size="sm"
          disabled={exportFile.isLoading}
          aria-label={`${localize('com_library_export')}: ${localize(label)}`}
          onClick={() => exportFile.mutate({ format, documentId })}
        >
          {localize(label)}
        </Button>
      ))}
    </div>
  );
}
