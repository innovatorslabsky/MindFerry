import type { ContextHubSemanticSearchConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { ServerRequest } from '../../types/http';
import {
  isContextHubMcpEnabled,
  contextHubMcpRateLimitKey,
  buildSemanticSearchOptions,
} from './route';

describe('isContextHubMcpEnabled', () => {
  it('requires both the hub and its MCP surface to be enabled', () => {
    expect(isContextHubMcpEnabled(undefined)).toBe(false);
    expect(isContextHubMcpEnabled({} as AppConfig)).toBe(false);
    expect(isContextHubMcpEnabled({ contextHub: { enabled: false } } as AppConfig)).toBe(false);
    expect(
      isContextHubMcpEnabled({
        contextHub: { enabled: true, mcp: { enabled: false } },
      } as AppConfig),
    ).toBe(false);
    expect(
      isContextHubMcpEnabled({
        contextHub: { enabled: true, mcp: { enabled: true } },
      } as AppConfig),
    ).toBe(true);
  });

  it('does not treat a hub enabled for import alone as MCP-enabled', () => {
    expect(isContextHubMcpEnabled({ contextHub: { enabled: true } } as AppConfig)).toBe(false);
  });
});

describe('contextHubMcpRateLimitKey', () => {
  it('keys the limiter by the authenticated user, not by address', () => {
    const req = { user: { id: 'user-a' }, ip: '203.0.113.5' } as unknown as ServerRequest;

    expect(contextHubMcpRateLimitKey(req)).toBe('user-a');
  });

  it('falls back to address only when no user was resolved', () => {
    const req = { ip: '203.0.113.5' } as unknown as ServerRequest;

    expect(contextHubMcpRateLimitKey(req)).toBe('203.0.113.5');
  });
});

describe('buildSemanticSearchOptions', () => {
  const baseConfig: ContextHubSemanticSearchConfig = {
    enabled: true,
    baseURL: 'http://freellmapi:3001/v1',
    apiKey: '${FREELLMAPI_KEY}',
    model: 'text-embedding-3-small',
    weight: 0.5,
    candidatePoolSize: 50,
  };

  it('returns undefined when no config is present', () => {
    expect(buildSemanticSearchOptions(undefined)).toBeUndefined();
  });

  it('returns undefined when the config is present but disabled', () => {
    expect(buildSemanticSearchOptions({ ...baseConfig, enabled: false })).toBeUndefined();
  });

  it('resolves an ${ENV_VAR} apiKey reference from the environment', () => {
    process.env.FREELLMAPI_KEY = 'resolved-secret';
    const options = buildSemanticSearchOptions(baseConfig);
    delete process.env.FREELLMAPI_KEY;

    expect(options).toBeDefined();
    expect(options?.weight).toBe(0.5);
    expect(options?.candidatePoolSize).toBe(50);
  });
});

describe('createContextHubMcpHandler', () => {
  const methods = {
    upsertHubThread: jest.fn(),
    getHubThread: jest.fn(),
    searchHubThreads: jest.fn(),
    listHubNotes: jest.fn(),
    searchHubNotes: jest.fn(),
    appendHubNote: jest.fn(),
    linkHubThreadChats: jest.fn(),
  };

  function fakeRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      headersSent: false,
    };
  }

  it('rejects with 404 before authenticating anything against the store, when the feature is off', async () => {
    const { createContextHubMcpHandler } = await import('./route');
    const handler = createContextHubMcpHandler({ methods });
    const req = { user: { id: 'user-a' }, config: undefined } as unknown as ServerRequest;
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(methods.getHubThread).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the feature is on but no user was resolved', async () => {
    const { createContextHubMcpHandler } = await import('./route');
    const handler = createContextHubMcpHandler({ methods });
    const req = {
      config: { contextHub: { enabled: true, mcp: { enabled: true } } },
    } as unknown as ServerRequest;
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('buildOpenInChat', () => {
  const methods = { getHubThread: jest.fn(), linkHubThreadChats: jest.fn() };
  const importConversation = jest.fn();
  const req = { user: { id: 'user-a' } } as unknown as ServerRequest & { user: { id: string } };

  it('is offered only when the operator allows it and an importer is supplied', async () => {
    const { buildOpenInChat } = await import('./route');

    expect(buildOpenInChat({ methods, importConversation }, undefined, req)).toBeUndefined();
    expect(buildOpenInChat({ methods, importConversation }, false, req)).toBeUndefined();
    expect(buildOpenInChat({ methods }, true, req)).toBeUndefined();
    expect(buildOpenInChat({ methods, importConversation }, true, req)).toEqual(
      expect.any(Function),
    );
  });
});
