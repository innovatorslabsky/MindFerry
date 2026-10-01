import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, waitFor } from 'test/layout-test-utils';
import ImportMenu from '../ImportMenu';

const mockImportFile = jest.fn();
const mockShowToast = jest.fn();
let mockHubEnabled = true;

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      importConversationsFile: (...args: unknown[]) => mockImportFile(...args),
    },
  };
});

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetStartupConfig: () => ({ data: { contextHubEnabled: mockHubEnabled } }),
}));

const file = new File(['[]'], 'export.json', { type: 'application/json' });

function chooseFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const sentTarget = () => (mockImportFile.mock.calls[0][0] as FormData).get('target');

/** Opened from the keyboard, which jsdom drives the way a browser does. */
const openMenu = (trigger: HTMLElement) => {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
};

describe('ImportMenu', () => {
  beforeEach(() => {
    mockHubEnabled = true;
    mockShowToast.mockReset();
    mockImportFile.mockReset().mockResolvedValue({
      message: 'ok',
      archive: { status: 'imported', threadCount: 1 },
    });
  });

  it('asks where the file goes, then imports it there', async () => {
    const { container, getByRole, findByRole } = render(<ImportMenu />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pick = jest.spyOn(input, 'click');

    openMenu(getByRole('button', { name: 'Import conversations' }));
    expect(await findByRole('menuitem', { name: 'Chats and archive' })).toBeInTheDocument();
    expect(getByRole('menuitem', { name: 'Chats only' })).toBeInTheDocument();
    fireEvent.click(getByRole('menuitem', { name: 'Archive only' }));

    expect(pick).toHaveBeenCalledTimes(1);
    chooseFile(container);
    await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1));
    expect(sentTarget()).toBe('archive');
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'Imported 1 conversation(s) into the MindFerry archive',
        status: 'success',
      }),
    );
  });

  it('opens the file picker straight away and imports into the chats when the hub is off', async () => {
    mockHubEnabled = false;
    mockImportFile.mockResolvedValue({ message: 'ok', chats: { status: 'imported' } });
    const { container, getByRole, queryByRole } = render(<ImportMenu />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pick = jest.spyOn(input, 'click');

    fireEvent.click(getByRole('button', { name: 'Import conversations' }));

    expect(pick).toHaveBeenCalledTimes(1);
    expect(queryByRole('menu')).not.toBeInTheDocument();
    chooseFile(container);
    await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1));
    expect(sentTarget()).toBe('chats');
  });

  it('shows the importer is busy and accepts no second file meanwhile', async () => {
    mockHubEnabled = false;
    mockImportFile.mockReturnValue(new Promise(() => undefined));
    const { container, getByRole, findByRole } = render(<ImportMenu />);

    chooseFile(container);

    expect(await findByRole('button', { name: 'Importing' })).toBeDisabled();
    expect(getByRole('button', { name: 'Importing' })).toBeInTheDocument();
  });
});
