import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@librechat/client';
import type { TLibraryDocumentSummary } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import NoteField from './NoteField';
import InfoPanel from './InfoPanel';
import TagEditor from './TagEditor';

const MAX_NOTE_LENGTH = 5000;

/**
 * A book the person reads somewhere else and only tracks here: there is no text to read, so the page is
 * where it stands (status, stars, time read), the person's own note, and tags.
 */
export default function ManualBookView({ document }: { document: TLibraryDocumentSummary }) {
  const localize = useLocalize();
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="library-manual-book">
      <header className="border-border-light flex shrink-0 items-center gap-3 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          <Link to="/library" aria-label={localize('com_library_back')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-text-primary truncate text-sm font-semibold">{document.title}</h1>
          {document.byline && (
            <p className="text-text-secondary truncate text-xs">{document.byline}</p>
          )}
        </div>
      </header>
      <TagEditor documentId={document.id} tags={document.tags} />
      <div className="mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto">
        <p className="text-text-secondary px-3 pt-3 text-sm">
          {localize('com_library_manual_hint')}
        </p>
        <InfoPanel document={document} />
        <section className="flex flex-col gap-1.5 px-3 pb-6">
          <h3 className="text-text-primary text-sm font-semibold">
            {localize('com_library_doc_note')}
          </h3>
          <NoteField
            key={`${document.id}:${document.note ?? ''}`}
            documentId={document.id}
            field="note"
            value={document.note ?? ''}
            maxLength={MAX_NOTE_LENGTH}
            label={localize('com_library_doc_note')}
            placeholder={localize('com_library_note_placeholder')}
          />
        </section>
      </div>
    </div>
  );
}
