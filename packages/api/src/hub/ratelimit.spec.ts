import type { ServerRequest } from '../types/http';
import { contextHubRateLimitKey } from './ratelimit';

const requestFrom = (ip?: string, userId?: string): ServerRequest =>
  ({ ip, user: userId == null ? undefined : { id: userId } }) as ServerRequest;

describe('contextHubRateLimitKey', () => {
  it('prefers the authenticated user over the address', () => {
    expect(contextHubRateLimitKey(requestFrom('203.0.113.5', 'user-a'))).toBe('user-a');
  });

  it('leaves an IPv4 address unchanged', () => {
    expect(contextHubRateLimitKey(requestFrom('203.0.113.5'))).toBe('203.0.113.5');
  });

  it('shares one bucket across IPv6 addresses in the same subnet', () => {
    const first = contextHubRateLimitKey(requestFrom('2001:db8:abcd:1234::1'));
    const second = contextHubRateLimitKey(requestFrom('2001:db8:abcd:1234:ffff::2'));
    expect(first).toBe(second);
  });

  it('separates IPv6 addresses from different subnets', () => {
    const first = contextHubRateLimitKey(requestFrom('2001:db8:abcd:1234::1'));
    const second = contextHubRateLimitKey(requestFrom('2001:db8:ffff:1234::1'));
    expect(first).not.toBe(second);
  });

  it('falls back to a fixed key when neither user nor address is known', () => {
    expect(contextHubRateLimitKey(requestFrom())).toBe('unknown');
  });
});
