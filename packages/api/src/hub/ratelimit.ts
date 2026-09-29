import { ipKeyGenerator } from 'express-rate-limit';
import type { ServerRequest } from '../types/http';

/**
 * Scopes a hub rate limit to the authenticated user. The IP fallback goes
 * through `ipKeyGenerator` so an IPv6 caller shares one bucket per subnet
 * instead of getting a fresh one for every address it can vary.
 */
export function contextHubRateLimitKey(req: ServerRequest): string {
  const userId = req.user?.id;
  if (userId != null) {
    return userId;
  }
  return req.ip == null ? 'unknown' : ipKeyGenerator(req.ip);
}
