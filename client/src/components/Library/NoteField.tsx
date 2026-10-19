import { useState } from 'react';
import { useToastContext } from '@librechat/client';
import { useUpdateLibraryDocumentMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * A short piece of the person's own text kept with a document, such as a note or a summary. It is
 * saved when the field loses focus, and only if it changed; clearing it removes it.
 */
export default function NoteField({
  documentId,
  field,
  value,
  maxLength,
  label,
  placeholder,
  className,
}: {
  documentId: string;
  field: 'note' | 'summary';
  value: string;
  maxLength: number;
  label: string;
  placeholder: string;
  className?: string;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [text, setText] = useState(value);
  const update = useUpdateLibraryDocumentMutation({
    onError: () =>
      showToast({
        message: localize('com_library_edit_error'),
        status: NotificationSeverity.ERROR,
      }),
  });

  return (
    <textarea
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = text.trim();
        if (next !== value.trim()) {
          update.mutate({ id: documentId, patch: { [field]: next } });
        }
      }}
      maxLength={maxLength}
      rows={4}
      aria-label={label}
      placeholder={placeholder}
      className={cn(
        'border-border-medium bg-surface-primary text-text-primary placeholder:text-text-tertiary w-full resize-y rounded-lg border px-3 py-2 text-sm',
        className,
      )}
      data-testid={`library-${field}`}
    />
  );
}
