import { useEffect, useState } from 'react';
import { BookOpen, FileText, FileType } from 'lucide-react';
import type { TLibraryDocumentSummary } from 'librechat-data-provider';
import { useLibraryThumbnailQuery } from '~/data-provider';
import { cn } from '~/utils';

const ICONS = { article: FileText, pdf: FileType, epub: BookOpen } as const;

/**
 * The picture beside a document in a list: its cover or lead image when it has one, otherwise a tile
 * with an icon for its kind. The image is fetched with the session and shown from an object URL.
 */
export default function Thumbnail({
  document,
  className,
}: {
  document: Pick<TLibraryDocumentSummary, 'id' | 'kind' | 'thumbnailPath'>;
  className?: string;
}) {
  const image = useLibraryThumbnailQuery(document.id, document.thumbnailPath);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!image.data) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(image.data);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [image.data]);

  const Icon = ICONS[document.kind];
  return (
    <div
      className={cn(
        'bg-surface-secondary text-text-secondary flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg',
        className,
      )}
      data-testid="library-thumbnail"
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          data-testid="library-thumbnail-image"
        />
      ) : (
        <Icon className="h-6 w-6" aria-hidden="true" />
      )}
    </div>
  );
}
