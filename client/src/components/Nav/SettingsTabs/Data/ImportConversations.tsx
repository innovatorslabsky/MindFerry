import { useState, useRef, useCallback } from 'react';
import { Import } from 'lucide-react';
import { Spinner, Label, Button, Dropdown } from '@librechat/client';
import type { TImportTarget } from 'librechat-data-provider';
import useConversationImport from '~/hooks/Conversations/useConversationImport';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

function ImportConversations() {
  const localize = useLocalize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { hubEnabled, isUploading, importFile } = useConversationImport();
  const [chosenTarget, setChosenTarget] = useState<TImportTarget>('both');

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        importFile(file, chosenTarget);
      }
      event.target.value = '';
    },
    [importFile, chosenTarget],
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

  const isImportDisabled = isUploading;
  const targetOptions = [
    { value: 'both', label: localize('com_ui_import_target_both') },
    { value: 'chats', label: localize('com_ui_import_target_chats') },
    { value: 'archive', label: localize('com_ui_import_target_archive') },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label id="import-conversation-label">{localize('com_ui_import_conversation_info')}</Label>
      <div className="flex items-center gap-2">
        {hubEnabled && (
          <Dropdown
            value={chosenTarget}
            options={targetOptions}
            onChange={(value) => setChosenTarget(value as TImportTarget)}
            testId="import-target-selector"
            sizeClasses="w-[170px]"
            ariaLabel={localize('com_ui_import_target_label')}
          />
        )}
        <Button
          variant="outline"
          onClick={handleImportClick}
          onKeyDown={handleKeyDown}
          disabled={isImportDisabled}
          aria-label={localize('com_ui_import')}
          aria-labelledby="import-conversation-label"
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
      </div>
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

export default ImportConversations;
