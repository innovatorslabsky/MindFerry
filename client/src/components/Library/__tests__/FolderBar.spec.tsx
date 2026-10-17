import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockCreate = jest.fn();
const mockRename = jest.fn();
const mockRemove = jest.fn();
let createOptions: { onSuccess?: (d: unknown) => void } = {};
let removeOptions: { onSuccess?: () => void } = {};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useCreateLibraryFolderMutation: (o: typeof createOptions) => {
    createOptions = o;
    return { mutate: mockCreate, isLoading: false };
  },
  useRenameLibraryFolderMutation: () => ({ mutate: mockRename, isLoading: false }),
  useDeleteLibraryFolderMutation: (o: typeof removeOptions) => {
    removeOptions = o;
    return { mutate: mockRemove };
  },
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: jest.fn() }),
}));

import FolderBar from '../FolderBar';

const folders = [
  { id: 'f1', name: 'Work', documentCount: 3, createdAt: '' },
  { id: 'f2', name: 'Home', documentCount: 0, createdAt: '' },
];

afterEach(() => jest.clearAllMocks());

describe('FolderBar', () => {
  it('lists all documents, the unfiled ones and each folder with its count, and reports the choice', () => {
    const onChange = jest.fn();
    render(<FolderBar folders={folders} value="" onChange={onChange} />);
    const select = screen.getByLabelText('com_library_folder_filter');
    expect(select.querySelectorAll('option')).toHaveLength(4);
    expect(screen.getByText('com_library_folder_count:Work,3')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'none' } });
    expect(onChange).toHaveBeenCalledWith('none');
  });

  it('offers rename and delete only for a real folder', () => {
    const { rerender } = render(<FolderBar folders={folders} value="" onChange={jest.fn()} />);
    expect(screen.queryByLabelText('com_library_folder_rename')).not.toBeInTheDocument();
    rerender(<FolderBar folders={folders} value="none" onChange={jest.fn()} />);
    expect(screen.queryByLabelText('com_library_folder_delete')).not.toBeInTheDocument();
    rerender(<FolderBar folders={folders} value="f1" onChange={jest.fn()} />);
    expect(screen.getByLabelText('com_library_folder_rename')).toBeInTheDocument();
    expect(screen.getByLabelText('com_library_folder_delete')).toBeInTheDocument();
  });

  it('creates a folder and switches to it', () => {
    const onChange = jest.fn();
    render(<FolderBar folders={folders} value="" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('com_library_folder_new'));
    const input = screen.getByLabelText('com_library_folder_name');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: ' Reading ' } });
    fireEvent.submit(input);
    expect(mockCreate).toHaveBeenCalledWith('Reading');
    act(() => createOptions.onSuccess?.({ folder: { id: 'f9' } }));
    expect(onChange).toHaveBeenCalledWith('f9');
    expect(screen.queryByLabelText('com_library_folder_name')).not.toBeInTheDocument();
  });

  it('does not submit a blank name', () => {
    render(<FolderBar folders={folders} value="" onChange={jest.fn()} />);
    fireEvent.click(screen.getByLabelText('com_library_folder_new'));
    fireEvent.submit(screen.getByLabelText('com_library_folder_name'));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('renames the open folder starting from its current name', () => {
    render(<FolderBar folders={folders} value="f1" onChange={jest.fn()} />);
    fireEvent.click(screen.getByLabelText('com_library_folder_rename'));
    const input = screen.getByLabelText('com_library_folder_name');
    expect(input).toHaveValue('Work');
    fireEvent.change(input, { target: { value: 'Office' } });
    fireEvent.submit(input);
    expect(mockRename).toHaveBeenCalledWith({ id: 'f1', name: 'Office' });
  });

  it('deletes only after confirming, then goes back to all documents', () => {
    const onChange = jest.fn();
    render(<FolderBar folders={folders} value="f1" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('com_library_folder_delete'));
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete' }));
    expect(mockRemove).toHaveBeenCalledWith({ id: 'f1' });
    act(() => removeOptions.onSuccess?.());
    expect(onChange).toHaveBeenCalledWith('');
  });
});
