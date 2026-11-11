import type { AppConfig } from '@librechat/data-schemas';
import { areRolesEnabled, getBridgeSettings } from '../config';

const app = (agentBridge: unknown) => ({ agentBridge }) as unknown as AppConfig;

describe('role settings', () => {
  it('are off with the agreed caps when nothing is configured', () => {
    expect(getBridgeSettings(undefined).roles).toEqual({
      enabled: false,
      dailyCapPerRole: 6,
      dailyCapTeam: 25,
      assignPerHour: 20,
      maxBriefChars: 4000,
      maxRoles: 12,
      fileRolesEnabled: false,
    });
  });

  it('take the operator’s values and keep the rest at their defaults', () => {
    const roles = getBridgeSettings(
      app({ enabled: true, roles: { enabled: true, dailyCapTeam: 10 } }),
    ).roles;
    expect(roles).toMatchObject({ enabled: true, dailyCapTeam: 10, dailyCapPerRole: 6 });
  });

  it('need both the bridge and the roles switch', () => {
    expect(areRolesEnabled(app({ enabled: true, roles: { enabled: true } }))).toBe(true);
    expect(areRolesEnabled(app({ enabled: true, roles: { enabled: false } }))).toBe(false);
    expect(areRolesEnabled(app({ enabled: true }))).toBe(false);
    expect(areRolesEnabled(app({ enabled: false, roles: { enabled: true } }))).toBe(false);
    expect(areRolesEnabled(undefined)).toBe(false);
  });

  it('never open host-agent roles by themselves', () => {
    const roles = getBridgeSettings(app({ enabled: true, roles: { enabled: true } })).roles;
    expect(roles.fileRolesEnabled).toBe(false);
  });
});
