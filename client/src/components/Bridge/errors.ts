import type { TranslationKeys } from '~/hooks';

/** The `error` code the bridge API puts in its JSON body, if the failure came from it. */
export function bridgeErrorCode(error: unknown): string | undefined {
  const code = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data
    ?.error;
  return typeof code === 'string' ? code : undefined;
}

const MESSAGES: Record<string, TranslationKeys> = {
  BRIDGE_INVALID: 'com_bridge_error_invalid',
  BRIDGE_SECRET_DETECTED: 'com_bridge_error_secret',
  BRIDGE_RATE_LIMITED: 'com_bridge_error_rate',
  BRIDGE_UNAVAILABLE: 'com_bridge_error_unavailable',
  BRIDGE_CONFLICT: 'com_bridge_error_conflict',
  BRIDGE_NOT_FOUND: 'com_bridge_error_not_found',
};

/** A message the person can act on for a failed request, in their language. */
export function bridgeErrorKey(error: unknown, fallback: TranslationKeys): TranslationKeys {
  const code = bridgeErrorCode(error);
  return (code && MESSAGES[code]) || fallback;
}
