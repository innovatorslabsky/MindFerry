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
      scanResults: true,
      roles: {
        enabled: false,
        dailyCapPerRole: 6,
        dailyCapTeam: 25,
        assignPerHour: 20,
        maxBriefChars: 4000,
        maxRoles: 12,
        fileRolesEnabled: false,
      },
    });
  });

  describe('roles', () => {
    it('are off, with the agreed daily caps, until the operator turns them on', () => {
      const roles = agentBridgeSchema.parse({ enabled: true })?.roles;
      expect(roles).toMatchObject({
        enabled: false,
        dailyCapPerRole: 6,
        dailyCapTeam: 25,
        fileRolesEnabled: false,
      });
    });

    it('take the operator’s own values', () => {
      const roles = agentBridgeSchema.parse({
        enabled: true,
        roles: { enabled: true, dailyCapPerRole: 3, dailyCapTeam: 10, fileRolesEnabled: true },
      })?.roles;
      expect(roles).toMatchObject({
        enabled: true,
        dailyCapPerRole: 3,
        dailyCapTeam: 10,
        fileRolesEnabled: true,
      });
    });

    it.each([
      ['a cap of zero', { dailyCapPerRole: 0 }],
      ['a fractional cap', { dailyCapTeam: 2.5 }],
      ['a brief over the hard limit', { maxBriefChars: 16001 }],
      ['no roles allowed', { maxRoles: 0 }],
    ])('reject %s', (_label, roles) => {
      expect(agentBridgeSchema.safeParse({ enabled: true, roles }).success).toBe(false);
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
