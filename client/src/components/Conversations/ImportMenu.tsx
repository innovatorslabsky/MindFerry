import { useCallback, useRef } from 'react';
import { Import } from 'lucide-react';
import {
  Spinner,
  TooltipAnchor,
  DropdownMenu,
  buttonVariants,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@librechat/client';
import type { TImportTarget } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import useConversationImport from '~/hooks/Conversations/useConversationImport';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const TARGETS: ReadonlyArray<{ value: TImportTarget; label: TranslationKeys }> = [
  { value: 'both', label: 'com_ui_import_target_both' },
  { value: 'chats', label: 'com_ui_import_target_chats' },
  { value: 'archive', label: 'com_ui_import_target_archive' },
];

/**
 * Import beside the Chats and Archived tabs, where the imported conversations
 * land. With the MindFerry archive on, it asks where the file goes first;
 * without it, it opens the file picker straight away.
 */
export default function ImportMenu() {
  const localize = useLocalize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<TImportTarget>('both');
  const { hubEnabled, isUploading, importFile } = useConversationImport();

  const pickFile = useCallback((target: TImportTarget) => {
    targetRef.current = target;
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        importFile(file, targetRef.current);
      }
      event.target.value = '';
    },
    [importFile],
  );

  const label = localize(isUploading ? 'com_ui_importing' : 'com_ui_import_conversations');
  const triggerClass = cn(
    buttonVariants({ variant: 'section-action', size: 'icon-xs' }),
    'shrink-0',
  );
  const icon = isUploading ? (
    <Spinner className="size-4" />
  ) : (
    <Import className="size-4" aria-hidden="true" />
  );

  return (
    <>
      {hubEnabled ? (
        <DropdownMenu>
          <TooltipAnchor
            description={label}
            render={
              <DropdownMenuTrigger
                aria-label={label}
                disabled={isUploading}
                className={triggerClass}
                data-testid="import-menu"
              >
                {icon}
              </DropdownMenuTrigger>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[180px]">
            {TARGETS.map((option) => (
              <DropdownMenuItem key={option.value} onSelect={() => pickFile(option.value)}>
                {localize(option.label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <TooltipAnchor
          description={label}
          render={
            <button
              type="button"
              aria-label={label}
              disabled={isUploading}
              className={triggerClass}
              onClick={() => pickFile('chats')}
              data-testid="import-menu"
            >
              {icon}
            </button>
          }
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".json"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}
