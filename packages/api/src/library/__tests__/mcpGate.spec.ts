import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createContextHubMcpHandler } from '../../hub/mcp/route';
import { handleHubMcpRequest } from '../../hub/mcp/http';

jest.mock('../../hub/mcp/http', () => ({ handleHubMcpRequest: jest.fn(async () => undefined) }));

const hubMethods = {
  upsertHubThread: jest.fn(),
  getHubThread: jest.fn(),
  searchHubThreads: jest.fn(),
  listHubNotes: jest.fn(),
  searchHubNotes: jest.fn(),
  appendHubNote: jest.fn(),
  linkHubThreadChats: jest.fn(),
};

const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false };

function requestWith(library: boolean | undefined): ServerRequest {
  return {
    user: { id: 'u1' },
    body: {},
    config: {
      contextHub: {
        enabled: true,
        mcp: { enabled: true },
        ...(library === undefined ? {} : { library: { enabled: library } }),
      },
    },
  } as unknown as ServerRequest;
}

async function librarySeenBy(
  handler: ReturnType<typeof createContextHubMcpHandler>,
  flag?: boolean,
) {
  jest.mocked(handleHubMcpRequest).mockClear();
  await handler(requestWith(flag), res as unknown as Response);
  const { options } = jest.mocked(handleHubMcpRequest).mock.calls[0]![0];
  return options.library;
}

describe('library tools on the hub MCP endpoint', () => {
  const libraryMethods = createFakeLibraryMethods().methods;

  it('are offered only when the operator enabled the library and storage was supplied', async () => {
    const withStorage = createContextHubMcpHandler({ methods: hubMethods, libraryMethods });
    expect(await librarySeenBy(withStorage, true)).toMatchObject({ userId: 'u1' });
    expect(await librarySeenBy(withStorage, false)).toBeUndefined();
    expect(await librarySeenBy(withStorage, undefined)).toBeUndefined();

    const withoutStorage = createContextHubMcpHandler({ methods: hubMethods });
    expect(await librarySeenBy(withoutStorage, true)).toBeUndefined();
  });
});
