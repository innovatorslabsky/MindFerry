import type { THubSurface } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

export const HUB_SURFACES: readonly THubSurface[] = ['chat', 'code', 'agent', 'other'];

export const SURFACE_LABEL_KEYS: Record<THubSurface, TranslationKeys> = {
  chat: 'com_ui_context_hub_surface_chat',
  code: 'com_ui_context_hub_surface_code',
  agent: 'com_ui_context_hub_surface_agent',
  other: 'com_ui_context_hub_surface_other',
};

/** A thread archived before surfaces were recorded, or imported from an export, is a chat. */
export const surfaceOf = (surface?: THubSurface): THubSurface => surface ?? 'chat';

export const matchesSurface = (surface: THubSurface | undefined, filter?: THubSurface): boolean =>
  filter === undefined || surfaceOf(surface) === filter;
