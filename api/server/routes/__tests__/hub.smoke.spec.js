describe('hub routes wiring', () => {
  it('loads the hub router without throwing', () => {
    expect(() => require('../hub')).not.toThrow();
  });

  it('registers "Continue in chat" as an authenticated POST on a thread', () => {
    const router = require('../hub');
    const route = router.stack.find(
      (layer) => layer.route?.path === '/threads/:id/continue',
    )?.route;

    expect(route).toBeDefined();
    expect(route.methods).toEqual({ post: true });
    expect(route.stack.length).toBeGreaterThanOrEqual(5);
  });

  it('loads the hub well-known router without throwing', () => {
    expect(() => require('../hubWellKnown')).not.toThrow();
  });
});
