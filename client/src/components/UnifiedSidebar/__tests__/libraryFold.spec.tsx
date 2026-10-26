import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import UnifiedSidebar from '../UnifiedSidebar';

/** The library entry reads the startup config, which these tests do not provide; it is covered by its own spec. */
jest.mock('~/components/Nav/LibraryButton', () => ({ __esModule: true, default: () => null }));

/**
 * The library is a workspace of its own, so on its pages the chat panel starts folded to its icon
 * strip. These pin when that happens and what undoes it, without touching the saved preference.
 */

const mockSidebarState = { isSmallScreen: false, expanded: true, setExpanded: jest.fn() };

jest.mock('@librechat/client', () => ({
  pxToRem: (value: number) => `${value}px`,
  useMediaQuery: () => false,
  useRemScale: () => 1,
}));

jest.mock('~/hooks/Nav/useSidebarState', () => ({
  __esModule: true,
  default: () => mockSidebarState,
}));

jest.mock('~/hooks/Nav/useSidebarToggle', () => ({
  __esModule: true,
  default: () => ({ setSidebarOpen: jest.fn(), toggleSidebar: jest.fn() }),
}));

jest.mock('~/hooks/Nav/useUnifiedSidebarLinks', () => ({
  __esModule: true,
  default: () => [],
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useChatHelpers: () => ({}),
  useShowMarketplace: () => false,
}));

jest.mock('~/Providers', () => ({
  ChatContext: { Provider: ({ children }: { children: ReactNode }) => <>{children}</> },
  ChatFormProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ActivePanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('~/components/SidePanel/Nav', () => ({
  __esModule: true,
  default: () => <div data-testid="side-panel-nav" />,
}));

jest.mock('../mobile', () => ({
  MobileHeader: () => <div data-testid="mobile-header" />,
  MobileBottomBar: () => <div data-testid="mobile-bottom-bar" />,
  MobileShortcutTargets: () => <div data-testid="mobile-shortcut-targets" />,
}));

jest.mock('../Sidebar', () => ({
  __esModule: true,
  default: ({ expanded, onExpand }: { expanded: boolean; onExpand: () => void }) => (
    <button data-testid="desktop-sidebar" data-expanded={String(expanded)} onClick={onExpand} />
  ),
}));

let go: (path: string) => void = () => undefined;
function Navigator() {
  const navigate = useNavigate();
  go = (path) => navigate(path);
  return null;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Navigator />
      <UnifiedSidebar switchToHistory={true} />
    </MemoryRouter>,
  );

const isOpen = () => screen.getByTestId('desktop-sidebar').getAttribute('data-expanded') === 'true';

beforeEach(() => {
  mockSidebarState.expanded = true;
});

describe('the chat panel on the library pages', () => {
  it('stays open outside the library', () => {
    renderAt('/c/new');
    expect(isOpen()).toBe(true);
  });

  it('starts folded on the list and on a document', () => {
    const list = renderAt('/library');
    expect(isOpen()).toBe(false);
    list.unmount();

    renderAt('/library/abc123');
    expect(isOpen()).toBe(false);
  });

  it('unfolds when the person opens it, and folds again on the next visit', () => {
    renderAt('/library');
    fireEvent.click(screen.getByTestId('desktop-sidebar'));
    expect(isOpen()).toBe(true);

    act(() => go('/c/new'));
    expect(isOpen()).toBe(true);

    act(() => go('/library'));
    expect(isOpen()).toBe(false);
  });

  it('stays folded while moving between library pages', () => {
    renderAt('/library');
    act(() => go('/library/abc123'));
    expect(isOpen()).toBe(false);
    act(() => go('/library/review'));
    expect(isOpen()).toBe(false);
  });

  it('unfolds when the saved preference is switched on from the library', () => {
    mockSidebarState.expanded = false;
    const { rerender } = renderAt('/library');
    expect(isOpen()).toBe(false);

    mockSidebarState.expanded = true;
    rerender(
      <MemoryRouter initialEntries={['/library']}>
        <Navigator />
        {/* The shell is memoized, so a changed prop is what makes it read the new state. */}
        <UnifiedSidebar isSliding={true} switchToHistory={true} />
      </MemoryRouter>,
    );
    expect(isOpen()).toBe(true);
  });
});
