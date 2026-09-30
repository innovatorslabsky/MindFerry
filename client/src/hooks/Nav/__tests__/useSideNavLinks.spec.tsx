import { renderHook } from '@testing-library/react';
import type { TEndpointsConfig } from 'librechat-data-provider';
import useSideNavLinks from '../useSideNavLinks';

const mockStartupConfig = jest.fn();

jest.mock('~/hooks', () => ({
  useHasAccess: () => false,
  useAgentCapabilities: () => ({ skillsEnabled: false }),
  useMCPServerManager: () => ({ availableMCPServers: [] }),
  useGetAgentsConfig: () => ({ agentsConfig: undefined }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => mockStartupConfig(),
}));

jest.mock('~/components/SidePanel/Archive', () => ({ ArchivePanel: () => null }));
jest.mock('~/components/SidePanel/MCPBuilder/MCPBuilderPanel', () => () => null);
jest.mock('~/components/SidePanel/Agents/AgentPanelSwitch', () => () => null);
jest.mock('~/components/SidePanel/Bookmarks/BookmarkPanel', () => () => null);
jest.mock('~/components/SidePanel/Builder/PanelSwitch', () => () => null);
jest.mock('~/components/SidePanel/Schedules', () => ({ SchedulePanel: () => null }));
jest.mock('~/components/SidePanel/Parameters/Panel', () => () => null);
jest.mock('~/components/SidePanel/Memories', () => ({ MemoryPanel: () => null }));
jest.mock('~/components/SidePanel/Files/Panel', () => () => null);
jest.mock('~/components/Prompts', () => ({ PromptsAccordion: () => null }));
jest.mock('~/components/Skills', () => ({ SkillsAccordion: () => null }));

const links = () =>
  renderHook(() =>
    useSideNavLinks({
      keyProvided: true,
      interfaceConfig: {},
      endpointsConfig: {} as TEndpointsConfig,
      includeHidePanel: false,
    }),
  ).result.current;

describe('useSideNavLinks — the Archive entry', () => {
  it('adds an Archive entry when the context hub is enabled', () => {
    mockStartupConfig.mockReturnValue({ data: { contextHubEnabled: true } });

    const archive = links().find((link) => link.id === 'hub-archive');

    expect(archive).toBeDefined();
    expect(archive?.title).toBe('com_ui_context_hub_archive_nav');
    expect(archive?.Component).toBeDefined();
  });

  it('keeps the Archive entry out when the context hub is off', () => {
    mockStartupConfig.mockReturnValue({ data: { contextHubEnabled: false } });

    expect(links().some((link) => link.id === 'hub-archive')).toBe(false);
  });

  it('keeps it out while the startup config has not loaded', () => {
    mockStartupConfig.mockReturnValue({ data: undefined });

    expect(links().some((link) => link.id === 'hub-archive')).toBe(false);
  });

  it('leaves the other entries as they were', () => {
    mockStartupConfig.mockReturnValue({ data: { contextHubEnabled: true } });
    const withHub = links().map((link) => link.id);
    mockStartupConfig.mockReturnValue({ data: { contextHubEnabled: false } });
    const withoutHub = links().map((link) => link.id);

    expect(withHub.filter((id) => id !== 'hub-archive')).toEqual(withoutHub);
  });
});
