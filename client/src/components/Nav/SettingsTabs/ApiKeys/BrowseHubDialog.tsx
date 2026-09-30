import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogTrigger,
  OGDialogContent,
} from '@librechat/client';
import HubArchiveBrowser from './HubArchiveBrowser';
import { useLocalize } from '~/hooks';

/** The archive in a dialog, opened from Settings → API Keys. The browser inside unmounts on close, so a reopened dialog starts fresh. */
export default function BrowseHubDialog() {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <OGDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          {localize('com_ui_context_hub_browse')}
        </Button>
      </OGDialogTrigger>
      <OGDialogContent
        className="flex h-[80vh] w-11/12 max-w-2xl flex-col"
        aria-describedby={undefined}
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_context_hub_browse_title')}</OGDialogTitle>
        </OGDialogHeader>
        <HubArchiveBrowser onContinued={() => setOpen(false)} />
      </OGDialogContent>
    </OGDialog>
  );
}
