import type { TLibraryHighlightColor } from 'librechat-data-provider';
import { HIGHLIGHT_COLORS } from '~/utils/libraryAnchors';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Written out so each label key is visible to the unused-key check. */
const COLOR_LABEL = {
  yellow: 'com_library_color_yellow',
  blue: 'com_library_color_blue',
  green: 'com_library_color_green',
  red: 'com_library_color_red',
  purple: 'com_library_color_purple',
} as const;

/** The colours offered above a selection; `top` and `left` are the point it floats over, in the viewport. */
export default function HighlightToolbar({
  top,
  left,
  onPick,
}: {
  top: number;
  left: number;
  onPick: (color: TLibraryHighlightColor) => void;
}) {
  const localize = useLocalize();
  return (
    <div
      role="toolbar"
      aria-label={localize('com_library_highlight_toolbar')}
      className="border-border-medium bg-surface-primary fixed z-50 flex -translate-x-1/2 -translate-y-full gap-1 rounded-lg border p-1 shadow-lg"
      style={{ top: Math.max(top - 8, 8), left }}
      data-testid="library-highlight-toolbar"
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          // Keep the selection alive while the button takes the click.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(color)}
          aria-label={localize('com_library_highlight_with', {
            0: localize(COLOR_LABEL[color]),
          })}
          className={cn('library-swatch h-6 w-6 rounded-full border', `library-swatch-${color}`)}
        />
      ))}
    </div>
  );
}
