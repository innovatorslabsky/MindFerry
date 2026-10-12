const express = require('express');
const request = require('supertest');

const mockConfigMiddleware = jest.fn((_req, _res, next) => next());
const mockRequireHubMcpEnabled = jest.fn((_req, _res, next) => next());

jest.mock('~/server/middleware', () => ({
  configMiddleware: (...args) => mockConfigMiddleware(...args),
}));

jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    requireHubMcpEnabled: (...args) => mockRequireHubMcpEnabled(...args),
  };
});

describe('hub well-known routes', () => {
  let app;

  beforeAll(() => {
    process.env.DOMAIN_SERVER = 'https://hub.example.com';
    const hubWellKnownRouter = require('../hubWellKnown');

    app = express();
    app.use('/.well-known', hubWellKnownRouter);
  });

  afterAll(() => {
    delete process.env.DOMAIN_SERVER;
  });

  beforeEach(() => {
    mockConfigMiddleware.mockClear();
    mockRequireHubMcpEnabled.mockClear();
  });

  it('serves protected-resource metadata at the bare well-known path', async () => {
    const response = await request(app).get('/.well-known/oauth-protected-resource');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: 'https://hub.example.com/api/hub/mcp',
      authorization_servers: ['https://hub.example.com'],
    });
  });

  it('serves the same protected-resource metadata when the client inserts the resource path per RFC 9728', async () => {
    const response = await request(app).get('/.well-known/oauth-protected-resource/api/hub/mcp');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: 'https://hub.example.com/api/hub/mcp',
      authorization_servers: ['https://hub.example.com'],
    });
  });

  it('serves authorization-server metadata at the bare well-known path', async () => {
    const response = await request(app).get('/.well-known/oauth-authorization-server');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      issuer: 'https://hub.example.com',
      registration_endpoint: 'https://hub.example.com/api/hub/oauth/register',
    });
  });

  it('serves the same authorization-server metadata with an inserted resource path', async () => {
    const response = await request(app).get('/.well-known/oauth-authorization-server/api/hub/mcp');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      issuer: 'https://hub.example.com',
      registration_endpoint: 'https://hub.example.com/api/hub/oauth/register',
    });
  });
});
