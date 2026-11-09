import { agentBridgeSchema, configSchema } from './config';

describe('agentBridgeSchema', () => {
  it('fills in the limits when only enabled is set', () => {
    expect(agentBridgeSchema.parse({ enabled: true })).toEqual({
      enabled: true,
      tasksDir: '/home/deploy/tasks',
      maxTaskChars: 2000,
      maxResultBytes: 131072,
      listLimit: 100,
      createPerHour: 10,
      statusStaleSeconds: 180,
      dashboards: [],
    });
  });

  it('is off by default: an empty block turns nothing on', () => {
    expect(agentBridgeSchema.parse({})?.enabled).toBe(false);
    expect(agentBridgeSchema.parse(undefined)).toBeUndefined();
  });

  it('accepts dashboard links and a tunnel hint', () => {
    const parsed = agentBridgeSchema.parse({
      enabled: true,
      dashboards: [{ name: 'Hermes', url: 'http://localhost:9119' }],
      tunnelCommand: 'ssh -L 9119:localhost:9119 deploy@host',
    });
    expect(parsed?.dashboards).toHaveLength(1);
    expect(parsed?.tunnelCommand).toContain('deploy@host');
  });

  it.each([
    [
      'a dashboard link that is not http(s)',
      { dashboards: [{ name: 'x', url: 'javascript:alert(1)' }] },
    ],
    ['a task limit that is too small', { maxTaskChars: 10 }],
    ['a limit that is too large', { createPerHour: 100000 }],
    ['an empty task folder', { tasksDir: '' }],
    [
      'too many dashboards',
      { dashboards: Array.from({ length: 9 }, () => ({ name: 'x', url: 'http://a' })) },
    ],
  ])('rejects %s', (_name, input) => {
    expect(agentBridgeSchema.safeParse({ enabled: true, ...input }).success).toBe(false);
  });

  it('is an optional key of the main config, so existing files are unaffected', () => {
    expect(configSchema.shape.agentBridge).toBeDefined();
    expect(configSchema.shape.agentBridge.isOptional()).toBe(true);
  });
});
