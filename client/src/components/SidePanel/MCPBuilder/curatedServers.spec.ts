import { curatedServers } from './curatedServers';

describe('curatedServers', () => {
  it('is non-empty', () => {
    expect(curatedServers.length).toBeGreaterThan(0);
  });

  it('has a unique id for every entry', () => {
    const ids = curatedServers.map((server) => server.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only offers a transport the user-managed create path actually accepts', () => {
    // MCPServerUserInputSchema (librechat-data-provider) forbids stdio —
    // every curated template's type must be one the create form can submit.
    for (const server of curatedServers) {
      expect(['streamable-http', 'sse']).toContain(server.template.type);
    }
  });

  it('gives every entry a non-empty title, description, and learn-more link', () => {
    for (const server of curatedServers) {
      expect(server.title.trim().length).toBeGreaterThan(0);
      expect(server.description.trim().length).toBeGreaterThan(0);
      expect(server.learnMoreUrl).toMatch(/^https:\/\//);
    }
  });

  it("never templates a URL — every entry needs the user's own instance or account", () => {
    for (const server of curatedServers) {
      expect(server.template).not.toHaveProperty('url');
    }
  });

  it("every template's own title is non-empty, for the form to prefill", () => {
    for (const server of curatedServers) {
      expect(server.template.title.trim().length).toBeGreaterThan(0);
    }
  });
});
