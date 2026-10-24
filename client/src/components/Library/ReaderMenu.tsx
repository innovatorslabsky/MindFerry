import { Archive, Clock, Download, Inbox, Keyboard, Link2, MoreHorizontal } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useToastContext,
} from '@librechat/client';
import type { TLibraryLocation } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useExportLibraryHighlightsMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { saveBlob } from '~/utils/saveBlob';
import { useLocalize } from '~/hooks';

/** Where a document can be moved to, with the key that does it and what the entry says. */
const MOVES: ReadonlyArray<{
  location: Extract<TLibraryLocation, 'inbox' | 'later' | 'archive'>;
  key: string;
  label: TranslationKeys;
  Icon: LucideIcon;
}> = [
  { location: 'inbox', key: 'i', label: 'com_library_shortcut_inbox', Icon: Inbox },
  { location: 'later', key: 'l', label: 'com_library_shortcut_later', Icon: Clock },
  { location: 'archive', key: 'e', label: 'com_library_shortcut_archive', Icon: Archive },
];

const EXPORTS = [
  { format: 'markdown', label: 'com_library_export_markdown' },
  { format: 'csv', label: 'com_library_export_csv' },
] as const;

function Hint({ children }: { children: string }) {
  return <kbd className="text-text-secondary ml-auto pl-4 font-mono text-xs">{children}</kbd>;
}

/**
 * The reader's "more actions": where to move the document, the link to its original, a download of
 * its highlights, and the keyboard shortcuts. Each move shows the key that does the same.
 */
export default function ReaderMenu({
  documentId,
  location,
  originalUrl,
  onMove,
  onShowShortcuts,
}: {
  documentId: string;
  location: TLibraryLocation;
  /** The address the document came from, when it is a web page that can be opened. */
  originalUrl?: string;
  onMove: (location: TLibraryLocation) => void;
  onShowShortcuts: () => void;
}) {
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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(originalUrl ?? '');
      showToast({
        message: localize('com_ui_copied_to_clipboard'),
        status: NotificationSeverity.SUCCESS,
      });
    } catch {
      showToast({ message: localize('com_ui_copy_failed'), status: NotificationSeverity.ERROR });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={localize('com_library_more_actions')}
          data-testid="reader-menu"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {MOVES.filter((move) => move.location !== location).map(
          ({ location: to, key, label, Icon }) => (
            <DropdownMenuItem key={to} onSelect={() => onMove(to)}>
              <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
              {localize(label)}
              <Hint>{key}</Hint>
            </DropdownMenuItem>
          ),
        )}
        {originalUrl && (
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {localize('com_library_copy_original_link')}
          </DropdownMenuItem>
        )}
        {EXPORTS.map(({ format, label }) => (
          <DropdownMenuItem
            key={format}
            disabled={exportFile.isLoading}
            onSelect={() => exportFile.mutate({ format, documentId })}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {`${localize('com_library_export')}: ${localize(label)}`}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={onShowShortcuts}>
          <Keyboard className="mr-2 h-4 w-4" aria-hidden="true" />
          {localize('com_library_shortcuts')}
          <Hint>?</Hint>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
