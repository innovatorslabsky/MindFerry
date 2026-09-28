import { render, screen, fireEvent } from '@testing-library/react';
import CuratedServerBrowser from './CuratedServerBrowser';
import { curatedServers } from './curatedServers';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  OGDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  OGDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  OGDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OGDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockMCPServerDialog = jest.fn();
jest.mock('./MCPServerDialog', () => ({
  __esModule: true,
  default: (props: { open: boolean; template?: unknown }) => {
    mockMCPServerDialog(props);
    return props.open ? <div data-testid="mcp-server-dialog" /> : null;
  },
}));

describe('CuratedServerBrowser', () => {
  beforeEach(() => {
    mockMCPServerDialog.mockClear();
  });

  it('renders every curated server title when open', () => {
    render(<CuratedServerBrowser open={true} onOpenChange={jest.fn()} />);

    for (const server of curatedServers) {
      expect(screen.getByText(server.title)).toBeInTheDocument();
    }
  });

  it('renders nothing from the browse dialog when closed', () => {
    render(<CuratedServerBrowser open={false} onOpenChange={jest.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("opens MCPServerDialog prefilled with the picked entry's template, and closes the browser", () => {
    const onOpenChange = jest.fn();
    render(<CuratedServerBrowser open={true} onOpenChange={onOpenChange} />);

    const firstServer = curatedServers[0];
    const useThisButtons = screen.getAllByText('com_ui_use_this');
    fireEvent.click(useThisButtons[0]);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockMCPServerDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        template: expect.objectContaining({ title: firstServer.template.title }),
      }),
    );
  });
});
