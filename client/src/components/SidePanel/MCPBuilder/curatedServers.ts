import type { MCPServerFormData } from './MCPServerDialog/hooks/useMCPServerForm';

/**
 * A short, hand-picked list of remote MCP servers to one-click prefill into
 * `MCPServerDialog`. Deliberately not the full catalog in `docs/mcp-servers.md`:
 * the user-managed create path only accepts a `url`-based transport (SSE or
 * streamable-http) — stdio/command servers are an admin-only, YAML-configured
 * capability (see `MCPServerUserInputSchema` in `librechat-data-provider`,
 * which excludes stdio for arbitrary-command-execution reasons) — so every
 * entry here must actually be reachable over HTTP, not merely well-known.
 */
export interface CuratedServer {
  /** Stable key for tests and analytics; not shown in the UI. */
  id: string;
  title: string;
  description: string;
  /** Where to read more before adding it — shown as a link, never auto-followed. */
  learnMoreUrl: string;
  /** True when the operator must supply their own instance/account URL —
   *  the template leaves `url` blank rather than pointing at a placeholder
   *  a user could mistake for a working default. */
  selfHosted: boolean;
  template: Pick<MCPServerFormData, 'title' | 'description' | 'type'>;
}

export const curatedServers: readonly CuratedServer[] = [
  {
    id: 'searxng',
    title: 'SearXNG',
    description:
      'Self-hosted, keyless metasearch — no third-party search API key. Run mcp-searxng with MCP_HTTP_PORT set and point this at it. See docs/searxng.md for a working Docker Compose setup.',
    learnMoreUrl: 'https://github.com/ihor-sokoliuk/mcp-searxng',
    selfHosted: true,
    template: {
      title: 'SearXNG',
      description: 'Self-hosted metasearch via mcp-searxng.',
      type: 'streamable-http',
    },
  },
  {
    id: 'metamcp',
    title: 'MetaMCP',
    description:
      'A self-hosted gateway that aggregates several MCP servers behind one endpoint, with a GUI for managing them.',
    learnMoreUrl: 'https://github.com/metatool-ai/metatool-app',
    selfHosted: true,
    template: {
      title: 'MetaMCP',
      description: 'Self-hosted MCP aggregator.',
      type: 'streamable-http',
    },
  },
  {
    id: 'pipedream',
    title: 'Pipedream',
    description:
      "A hosted MCP endpoint reaching Pipedream's 2,500+ app connectors. Get your project's MCP URL from Pipedream's dashboard first.",
    learnMoreUrl: 'https://github.com/PipedreamHQ/pipedream/tree/master/modelcontextprotocol',
    selfHosted: false,
    template: {
      title: 'Pipedream',
      description: 'Pipedream MCP endpoint.',
      type: 'streamable-http',
    },
  },
] as const;
