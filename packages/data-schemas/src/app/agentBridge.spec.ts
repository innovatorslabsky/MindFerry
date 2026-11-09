import { loadAgentBridgeConfig } from './service';

describe('loadAgentBridgeConfig', () => {
  it('returns nothing when the block is absent, so the bridge stays off', () => {
    expect(loadAgentBridgeConfig({})).toBeUndefined();
    expect(loadAgentBridgeConfig({ agentBridge: undefined })).toBeUndefined();
  });

  it('returns the parsed block with its defaults filled in', () => {
    const config = loadAgentBridgeConfig({
      agentBridge: { enabled: true, tasksDir: '/srv/tasks' },
    });
    expect(config).toMatchObject({ enabled: true, tasksDir: '/srv/tasks', maxTaskChars: 2000 });
  });

  it('ignores an invalid block instead of failing startup', () => {
    expect(
      loadAgentBridgeConfig({ agentBridge: { enabled: true, maxTaskChars: 5 } }),
    ).toBeUndefined();
  });
});
