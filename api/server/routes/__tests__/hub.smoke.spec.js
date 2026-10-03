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

  it('registers "Continue in chat" as an authenticated POST on a note', () => {
    const router = require('../hub');
    const route = router.stack.find((layer) => layer.route?.path === '/notes/:id/continue')?.route;

    expect(route).toBeDefined();
    expect(route.methods).toEqual({ post: true });
    expect(route.stack.length).toBeGreaterThanOrEqual(5);
  });

  it('registers deleting a note as an authenticated DELETE with a note deleter from the app models', () => {
    const router = require('../hub');
    const route = router.stack.find(
      (layer) => layer.route?.path === '/notes/:id' && layer.route.methods.delete,
    )?.route;

    expect(route).toBeDefined();
    expect(route.stack.length).toBeGreaterThanOrEqual(4);
    expect(typeof require('~/models').deleteHubNote).toBe('function');
  });

  it('gives the routes the chat-link methods the archive list and imports use', () => {
    const db = require('~/models');
    expect(typeof db.linkHubThreadChats).toBe('function');
    expect(typeof db.findConvosByTitles).toBe('function');
  });

  it('gives the note route a note reader from the app models', () => {
    expect(typeof require('~/models').getHubNote).toBe('function');
  });

  it('loads the hub well-known router without throwing', () => {
    expect(() => require('../hubWellKnown')).not.toThrow();
  });
});
