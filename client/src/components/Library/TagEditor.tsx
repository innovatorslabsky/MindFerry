import { useState } from 'react';
import { X } from 'lucide-react';
import { Input, useToastContext } from '@librechat/client';
import { useUpdateLibraryDocumentMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

export const MAX_TAGS = 50;
export const MAX_TAG_LENGTH = 64;

/** Trims and collapses whitespace; a tag already present (ignoring case) is not added twice. */
export function addTag(tags: readonly string[], raw: string): string[] {
  const tag = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
  if (!tag || tags.length >= MAX_TAGS) {
    return [...tags];
  }
  const exists = tags.some((existing) => existing.toLowerCase() === tag.toLowerCase());
  return exists ? [...tags] : [...tags, tag];
}

/** The tags of one document, editable in place: Enter adds, the × on a tag removes it. */
export default function TagEditor({
  documentId,
  tags,
}: {
  documentId: string;
  tags: readonly string[];
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [draft, setDraft] = useState('');
  const update = useUpdateLibraryDocumentMutation({
    onError: () =>
      showToast({ message: localize('com_library_tag_error'), status: NotificationSeverity.ERROR }),
  });
  const save = (next: string[]) => update.mutate({ id: documentId, patch: { tags: next } });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = addTag(tags, draft);
    setDraft('');
    if (next.length !== tags.length) {
      save(next);
    }
  };

  return (
    <div
      className="border-border-light flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5"
      data-testid="library-tags"
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="bg-surface-secondary text-text-primary inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
        >
          {tag}
          <button
            type="button"
            className="text-text-secondary hover:text-text-primary rounded-full p-0.5"
            aria-label={localize('com_library_tag_remove', { 0: tag })}
            onClick={() => save(tags.filter((existing) => existing !== tag))}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <form onSubmit={onSubmit} className="min-w-32 flex-1">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={localize('com_library_tag_add')}
          aria-label={localize('com_library_tag_add')}
          maxLength={MAX_TAG_LENGTH}
          className="w-full"
        />
      </form>
    </div>
  );
}
