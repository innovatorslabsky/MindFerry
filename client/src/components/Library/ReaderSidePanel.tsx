import type { TLibraryDocumentSummary, TLibraryHighlight } from 'librechat-data-provider';
import HighlightsPanel from './HighlightsPanel';
import { useLocalize } from '~/hooks';
import InfoPanel from './InfoPanel';
import NoteField from './NoteField';
import { cn } from '~/utils';

export type ReaderPanelTab = 'info' | 'notebook';

const MAX_NOTE_LENGTH = 5000;
const TABS: readonly {
  value: ReaderPanelTab;
  label: 'com_library_panel_info' | 'com_library_panel_notebook';
}[] = [
  { value: 'info', label: 'com_library_panel_info' },
  { value: 'notebook', label: 'com_library_panel_notebook' },
];

/**
 * The column beside the text: Info is about the document, Notebook is what the person wrote about it,
 * their own note and their highlights.
 */
export default function ReaderSidePanel({
  document,
  highlights,
  tab,
  onTab,
  onFocus,
}: {
  document: TLibraryDocumentSummary;
  highlights: readonly TLibraryHighlight[];
  tab: ReaderPanelTab;
  onTab: (tab: ReaderPanelTab) => void;
  onFocus: (highlight: TLibraryHighlight) => void;
}) {
  const localize = useLocalize();
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="library-side-panel">
      <div
        role="tablist"
        aria-label={localize('com_library_panel_label')}
        className="border-border-light flex shrink-0 border-b"
      >
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`library-panel-tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`library-panel-${value}`}
            onClick={() => onTab(value)}
            className={cn(
              'flex-1 px-3 py-2.5 text-sm',
              tab === value
                ? 'border-text-primary text-text-primary border-b-2 font-semibold'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {localize(label)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`library-panel-${tab}`}
        aria-labelledby={`library-panel-tab-${tab}`}
        className="min-h-0 flex-1"
      >
        {tab === 'info' ? (
          <InfoPanel document={document} />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-border-light shrink-0 border-b px-3 py-3">
              <NoteField
                key={`${document.id}:${document.note ?? ''}`}
                documentId={document.id}
                field="note"
                value={document.note ?? ''}
                maxLength={MAX_NOTE_LENGTH}
                label={localize('com_library_doc_note')}
                placeholder={localize('com_library_note_placeholder')}
                className="min-h-20"
              />
            </div>
            <div className="min-h-0 flex-1">
              <HighlightsPanel documentId={document.id} highlights={highlights} onFocus={onFocus} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
