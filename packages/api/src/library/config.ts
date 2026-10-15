import type { AppConfig } from '@librechat/data-schemas';
import type { LibraryIsolationConfig } from './worker';

const ISOLATION_DEFAULTS: LibraryIsolationConfig = {
  mode: 'process',
  maxConcurrent: 2,
  maxQueue: 16,
  timeoutMs: 60_000,
  memoryMb: 768,
};

/** The isolation settings in force: the operator's, with anything unset filled in safe defaults. */
export function getLibraryIsolation(config: AppConfig | undefined): LibraryIsolationConfig {
  return { ...ISOLATION_DEFAULTS, ...config?.contextHub?.library?.isolation };
}

/**
 * The reading library is opt-in per deployment (`contextHub.library.enabled`). It fetches URLs on
 * behalf of users and stores third-party content, so an operator turns it on deliberately.
 */
export function isLibraryEnabled(config: AppConfig | undefined): boolean {
  return config?.contextHub?.library?.enabled === true;
}
