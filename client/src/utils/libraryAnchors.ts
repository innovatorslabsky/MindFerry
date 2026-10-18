import type {
  TLibraryAnchor,
  TLibraryHighlight,
  TLibraryHighlightColor,
} from 'librechat-data-provider';

/**
 * Selections and highlights in the reader. The coordinate space is `root.textContent` of the HTML the
 * server sent: every text node in document order, concatenated. The server stores highlights in the
 * same space, so the client must render that HTML untouched and refuse to highlight if it cannot.
 */

const SHOW_TEXT = 0x4;
const CONTEXT_LENGTH = 32;

export const HIGHLIGHT_COLORS: readonly TLibraryHighlightColor[] = [
  'yellow',
  'blue',
  'green',
  'red',
  'purple',
] as const;

/** True when the rendered text is exactly the text the server anchors highlights in. */
export function rendersServerText(root: Node, serverText: string): boolean {
  return (root.textContent ?? '') === serverText;
}

function documentOf(root: Node): Document {
  return (root.nodeType === 9 ? (root as Document) : root.ownerDocument) as Document;
}

/** A selection as offsets into `root`'s text, or null when empty or partly outside `root`. */
export function offsetsFromRange(root: Node, range: Range): { start: number; end: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }
  const before = documentOf(root).createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const length = range.toString().length;
  return length > 0 ? { start, end: start + length } : null;
}

/** Offsets as a Range over `root`'s text nodes, or null when they run past the end. */
export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  if (!(start >= 0) || !(end > start)) {
    return null;
  }
  const doc = documentOf(root);
  const walker = doc.createTreeWalker(root, SHOW_TEXT);
  let position = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    if (!startNode && start < position + length) {
      startNode = node;
      startOffset = start - position;
    }
    if (startNode && end <= position + length) {
      const range = doc.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(node, end - position);
      return range;
    }
    position += length;
  }
  return null;
}

/** The anchor the server stores: the quote, the text around it, and the offsets as a hint. */
export function buildAnchor(text: string, start: number, end: number): TLibraryAnchor | null {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > text.length ||
    start >= end
  ) {
    return null;
  }
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
    start,
    end,
  };
}

const MARK_ATTRIBUTE = 'data-library-highlight';

type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

function customHighlights(): {
  registry: HighlightRegistry;
  Highlight: new (...r: Range[]) => unknown;
} | null {
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)
    ?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown })
    .Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

const registryName = (color: TLibraryHighlightColor) => `library-${color}`;

/** Takes `<mark>` wrappers off again, leaving the text exactly as it was. */
export function clearMarks(root: Element): void {
  for (const mark of Array.from(root.querySelectorAll(`mark[${MARK_ATTRIBUTE}]`))) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
}

/** Wraps each text node a range touches in a `<mark>`; the text itself does not change. */
function wrapRange(range: Range, color: TLibraryHighlightColor, id: string): void {
  const doc = range.startContainer.ownerDocument as Document;
  const walker = doc.createTreeWalker(range.commonAncestorContainer, SHOW_TEXT);
  const touched: Text[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (range.intersectsNode(node)) {
      touched.push(node);
    }
  }
  if (touched.length === 0 && range.startContainer.nodeType === 3) {
    touched.push(range.startContainer as Text);
  }
  for (const node of touched) {
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;
    if (to <= from) {
      continue;
    }
    const target = node.splitText(from);
    target.splitText(to - from);
    const mark = doc.createElement('mark');
    mark.setAttribute(MARK_ATTRIBUTE, id);
    mark.setAttribute('data-color', color);
    target.parentNode?.insertBefore(mark, target);
    mark.appendChild(target);
  }
}

/**
 * Shows highlights over `root`. Uses the CSS Custom Highlight API where the browser has it, which
 * draws without touching the document; otherwise wraps text in `<mark>`, which leaves the text
 * unchanged. Returns the ids that could not be placed. Call it again to repaint.
 */
export function paintHighlights(
  root: Element,
  highlights: readonly TLibraryHighlight[],
  /** Where a highlight sits in `root`'s text; its own anchor offsets unless the text is a lookalike. */
  locate: (highlight: TLibraryHighlight) => { start: number; end: number } | null = (highlight) =>
    highlight.anchor,
): string[] {
  const unplaced: string[] = [];
  const custom = customHighlights();
  clearMarks(root);
  if (custom) {
    for (const color of HIGHLIGHT_COLORS) {
      custom.registry.delete(registryName(color));
    }
  }
  const byColor = new Map<TLibraryHighlightColor, Range[]>();
  // Placed against the untouched text first, so one wrapped highlight cannot shift the next.
  const placed: Array<{ highlight: TLibraryHighlight; range: Range }> = [];
  for (const highlight of highlights) {
    const where = highlight.orphaned ? null : locate(highlight);
    const range = where ? rangeFromOffsets(root, where.start, where.end) : null;
    if (!range) {
      unplaced.push(highlight.id);
      continue;
    }
    placed.push({ highlight, range });
  }
  if (custom) {
    for (const { highlight, range } of placed) {
      byColor.set(highlight.color, [...(byColor.get(highlight.color) ?? []), range]);
    }
    for (const [color, ranges] of byColor) {
      custom.registry.set(registryName(color), new custom.Highlight(...ranges));
    }
  } else {
    // Wrapping splits text nodes, so go from the end of the text to the start to keep earlier offsets valid.
    const ordered = placed
      .map(({ highlight }) => ({ highlight, where: locate(highlight) }))
      .sort((a, b) => (b.where?.start ?? 0) - (a.where?.start ?? 0));
    for (const { highlight, where } of ordered) {
      const fresh = where ? rangeFromOffsets(root, where.start, where.end) : null;
      if (fresh) {
        wrapRange(fresh, highlight.color, highlight.id);
      }
    }
  }
  return unplaced;
}

/** Drops the page-wide highlight registrations when the reader goes away. */
export function releaseHighlights(): void {
  const custom = customHighlights();
  if (custom) {
    for (const color of HIGHLIGHT_COLORS) {
      custom.registry.delete(registryName(color));
    }
  }
}

/** Scrolls the first painted piece of a highlight into view, if it is painted. */
export function scrollToHighlight(root: Element, highlight: TLibraryHighlight): boolean {
  const mark = root.querySelector(`mark[${MARK_ATTRIBUTE}="${CSS.escape(highlight.id)}"]`);
  const target =
    mark ??
    rangeFromOffsets(root, highlight.anchor.start, highlight.anchor.end)?.startContainer
      .parentElement;
  if (!target) {
    return false;
  }
  target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  return true;
}

/** The text offset at the top of the reading area, for "resume where I left off". */
export function offsetAtTop(root: Element, topY: number): number {
  const doc = documentOf(root);
  const walker = doc.createTreeWalker(root, SHOW_TEXT);
  let position = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (parent && parent.getBoundingClientRect().bottom >= topY) {
      return position;
    }
    position += node.data.length;
  }
  return Math.max(0, position - 1);
}

/** Scrolls so the text at `offset` is at the top of the reading area. */
export function scrollToOffset(root: Element, offset: number): void {
  const range = rangeFromOffsets(root, Math.max(0, offset), offset + 1);
  range?.startContainer.parentElement?.scrollIntoView?.({ block: 'start' });
}
