import type { AppConfig } from '@librechat/data-schemas';

/**
 * The reading library is opt-in per deployment (`contextHub.library.enabled`). It fetches URLs on
 * behalf of users and stores third-party content, so an operator turns it on deliberately.
 */
export function isLibraryEnabled(config: AppConfig | undefined): boolean {
  return config?.contextHub?.library?.enabled === true;
}
