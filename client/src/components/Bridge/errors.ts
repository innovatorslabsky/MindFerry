import type { TranslationKeys } from '~/hooks';

/** The `error` code the bridge API puts in its JSON body, if the failure came from it. */
export function bridgeErrorCode(error: unknown): string | undefined {
  const code = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data
    ?.error;
  return typeof code === 'string' ? code : undefined;
}

/** The fields a roles failure may carry besides its code, such as how far a cap has been used. */
export function bridgeErrorDetail(error: unknown): { used?: number; cap?: number; field?: string } {
  const data = (error as { response?: { data?: Record<string, unknown> } } | null)?.response?.data;
  return {
    ...(typeof data?.used === 'number' ? { used: data.used } : {}),
    ...(typeof data?.cap === 'number' ? { cap: data.cap } : {}),
    ...(typeof data?.field === 'string' ? { field: data.field } : {}),
  };
}

/** True when the server answered at all, so the failure is definite and a retry is a new attempt. */
export function bridgeAnswered(error: unknown): boolean {
  return (error as { response?: unknown } | null)?.response != null;
}

const MESSAGES: Record<string, TranslationKeys> = {
  ROLE_INVALID: 'com_bridge_roles_error_invalid',
  ROLE_SECRET_DETECTED: 'com_bridge_error_secret',
  ROLE_NOT_FOUND: 'com_bridge_roles_error_not_found',
  ROLE_SLUG_TAKEN: 'com_bridge_roles_error_name_taken',
  ROLE_LIMIT: 'com_bridge_roles_error_limit',
  ROLE_DISABLED: 'com_bridge_roles_error_disabled',
  ROLE_LOCKED: 'com_bridge_roles_error_locked',
  ROLE_AGENT_UNAVAILABLE: 'com_bridge_roles_error_agent',
  CAP_ROLE: 'com_bridge_roles_error_cap_role',
  CAP_TEAM: 'com_bridge_roles_error_cap_team',
  ASSIGN_RATE_LIMITED: 'com_bridge_roles_error_rate',
  ASSIGN_FAILED: 'com_bridge_roles_error_assign',
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
