import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

/** Written out so each label key is visible to the unused-key check. */
const READER_SHORTCUTS: ReadonlyArray<{ keys: string; label: TranslationKeys; books?: true }> = [
  { keys: 'h', label: 'com_library_shortcut_highlight' },
  { keys: 'e', label: 'com_library_shortcut_archive' },
  { keys: 'l', label: 'com_library_shortcut_later' },
  { keys: 'i', label: 'com_library_shortcut_inbox' },
  { keys: 'n / p', label: 'com_library_shortcut_next_previous', books: true },
  { keys: 'u', label: 'com_library_shortcut_back' },
  { keys: '?', label: 'com_library_shortcut_help' },
];

/** The keys that work in the reader, in a dialog so they can be read without leaving the page. */
export default function ReaderShortcuts({
  open,
  onOpenChange,
  isBook,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chapter and page keys are only listed for a book. */
  isBook: boolean;
}) {
  const localize = useLocalize();
  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        showCloseButton={true}
        title={localize('com_library_shortcuts')}
        className="w-11/12 max-w-md"
        main={
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-left text-sm"
            data-testid="reader-shortcuts"
          >
            {READER_SHORTCUTS.filter((shortcut) => isBook || !shortcut.books).map((shortcut) => (
              <div key={shortcut.keys} className="contents">
                <dt className="text-text-primary font-mono">{shortcut.keys}</dt>
                <dd className="text-text-secondary">{localize(shortcut.label)}</dd>
              </div>
            ))}
          </dl>
        }
      />
    </OGDialog>
  );
}
