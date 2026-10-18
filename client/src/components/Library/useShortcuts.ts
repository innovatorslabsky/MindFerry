import { useEffect, useRef } from 'react';

type Handlers = Record<string, (event: KeyboardEvent) => void>;

/** Keys typed into a field belong to the field, never to a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Single-key shortcuts for a screen, such as `j` and `k` in a list. They stay quiet while a field has
 * focus or a modifier is held, so typing and the browser's own shortcuts are never taken over.
 */
export function useShortcuts(handlers: Handlers, enabled = true): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      const handler = latest.current[event.key];
      if (!handler) {
        return;
      }
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
