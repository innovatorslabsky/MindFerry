describe('library routes wiring', () => {
  const router = () => require('../library');
  const find = (path, method) =>
    router().stack.find((layer) => layer.route?.path === path && layer.route.methods[method])
      ?.route;

  it('loads the library router without throwing', () => {
    expect(() => router()).not.toThrow();
  });

  it.each([
    ['/documents', 'post'],
    ['/documents', 'get'],
    ['/documents/:id', 'get'],
    ['/documents/:id', 'patch'],
    ['/documents/:id', 'delete'],
    ['/documents/:id/units/:index', 'get'],
    ['/documents/:id/resources', 'get'],
    ['/feeds/preview', 'post'],
    ['/export', 'get'],
    ['/review', 'get'],
    ['/review/:id', 'post'],
    ['/documents/:id/chat', 'post'],
    ['/folders', 'get'],
    ['/folders', 'post'],
    ['/folders/:id', 'patch'],
    ['/folders/:id', 'delete'],
    ['/feeds', 'post'],
    ['/feeds', 'get'],
    ['/feeds/:id/refresh', 'post'],
    ['/feeds/:id', 'delete'],
    ['/documents/:id/source', 'get'],
    ['/documents/:id/source', 'delete'],
    ['/documents/:id/progress', 'put'],
    ['/highlights', 'post'],
    ['/highlights/:id', 'patch'],
    ['/highlights/:id', 'delete'],
  ])('registers %s %s behind auth, config and a rate limit', (path, method) => {
    const route = find(path, method);
    expect(route).toBeDefined();
    // requireJwtAuth, configMiddleware, limiter, handler
    expect(route.stack.length).toBe(4);
  });

  it('registers the browser clip behind an API key, config, tenant and the save rate limit', () => {
    const route = find('/clip', 'post');
    expect(route).toBeDefined();
    // apiKeyMiddleware, configMiddleware, tenant context, limiter, handler
    expect(route.stack.length).toBe(5);
  });

  it('registers the newsletter address behind its own limits, its secret and the owner’s config', () => {
    const route = find('/inbox/:token', 'post');
    expect(route).toBeDefined();
    // ip limiter, secret check, multipart reader, config, tenant context, limiter, handler
    expect(route.stack.length).toBe(7);
  });

  it.each([
    ['/inbox', 'get'],
    ['/inbox', 'post'],
    ['/inbox', 'delete'],
  ])('registers %s %s behind auth, config and a rate limit', (path, method) => {
    expect(find(path, method)?.stack.length).toBe(4);
  });

  it('registers the upload behind auth, config, a rate limit and the file parser', () => {
    const route = find('/uploads', 'post');
    expect(route).toBeDefined();
    // requireJwtAuth, configMiddleware, limiter, upload parser, handler
    expect(route.stack.length).toBe(5);
  });

  it('gives the routes every method the service calls from the app models', () => {
    const db = require('~/models');
    for (const name of [
      'saveLibraryDocument',
      'saveLibraryBook',
      'listLibraryUnits',
      'getLibraryUnit',
      'getLibraryResource',
      'listLibraryDocumentsByIds',
      'createLibraryFolder',
      'listLibraryFolders',
      'renameLibraryFolder',
      'deleteLibraryFolder',
      'saveLibrarySource',
      'getLibrarySource',
      'deleteLibrarySource',
      'addLibraryFeed',
      'listLibraryFeeds',
      'getLibraryFeed',
      'recordLibraryFeedRefresh',
      'deleteLibraryFeed',
      'getLibraryDocument',
      'listLibraryDocuments',
      'searchLibraryDocuments',
      'updateLibraryDocument',
      'deleteLibraryDocument',
      'createLibraryHighlight',
      'listLibraryHighlights',
      'updateLibraryHighlight',
      'deleteLibraryHighlight',
      'rotateLibraryInbox',
      'getLibraryInbox',
      'deleteLibraryInbox',
      'findLibraryInboxOwner',
      'listLibraryReviewHighlights',
      'countLibraryReviewedSince',
      'markLibraryHighlightReviewed',
      'reanchorLibraryHighlights',
      'getLibraryProgress',
      'setLibraryProgress',
    ]) {
      expect(typeof db[name]).toBe('function');
    }
  });
});
