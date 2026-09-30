import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, waitFor } from 'test/layout-test-utils';
import ImportConversations from '../ImportConversations';

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

describe('ImportConversations', () => {
  beforeEach(() => {
    mockHubEnabled = true;
    mockShowToast.mockReset();
    mockImportFile.mockReset().mockResolvedValue({
      message: 'ok',
      chats: { status: 'imported' },
      archive: { status: 'imported', threadCount: 2 },
    });
  });

  it('imports into both the chats and the archive by default when the hub is on', async () => {
    const { container, getByRole } = render(<ImportConversations />);

    expect(getByRole('combobox', { name: /Import to/ })).toHaveTextContent('Chats and archive');
    chooseFile(container);

    await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1));
    expect(sentTarget()).toBe('both');
    expect((mockImportFile.mock.calls[0][0] as FormData).get('file')).toBeInstanceOf(File);
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'Imported into your chats and the MindFerry archive',
        status: 'success',
      }),
    );
  });

  it('sends the destination the person picked', async () => {
    mockImportFile.mockResolvedValue({
      message: 'ok',
      archive: { status: 'imported', threadCount: 3 },
    });
    const { container, getByRole, findByRole } = render(<ImportConversations />);

    fireEvent.click(getByRole('combobox', { name: /Import to/ }));
    fireEvent.click(await findByRole('option', { name: 'Archive only' }));
    chooseFile(container);

    await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1));
    expect(sentTarget()).toBe('archive');
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'Imported 3 conversation(s) into the MindFerry archive',
        status: 'success',
      }),
    );
  });

  it('says which side could not take the file when only one side imported', async () => {
    mockImportFile.mockResolvedValue({
      message: 'ok',
      chats: { status: 'imported' },
      archive: { status: 'unsupported' },
    });
    const { container } = render(<ImportConversations />);

    chooseFile(container);

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: "Imported into your chats. The MindFerry archive couldn't take this file.",
        status: 'warning',
      }),
    );
  });

  it('offers no destination and imports into the chats when the hub is off', async () => {
    mockHubEnabled = false;
    mockImportFile.mockResolvedValue({ message: 'ok', chats: { status: 'imported' } });
    const { container, queryByRole } = render(<ImportConversations />);

    expect(queryByRole('combobox', { name: /Import to/ })).not.toBeInTheDocument();
    chooseFile(container);

    await waitFor(() => expect(mockImportFile).toHaveBeenCalledTimes(1));
    expect(sentTarget()).toBe('chats');
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'Conversations imported successfully',
        status: 'success',
      }),
    );
  });

  it('tells the person the file type is not supported when neither side reads it', async () => {
    mockImportFile.mockRejectedValue({
      response: { status: 400, data: { error: { code: 'unsupported_export' } } },
    });
    const { container, getByRole } = render(<ImportConversations />);

    chooseFile(container);

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'Unsupported import type',
        status: 'error',
      }),
    );
    expect(getByRole('button', { name: /Import/ })).not.toBeDisabled();
  });
});
