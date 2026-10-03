import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import type { THubNote } from 'librechat-data-provider';
import { render, fireEvent, waitFor } from 'test/layout-test-utils';
import HubNoteList from '../HubNoteList';

const mockDeleteHubNote = jest.fn();
const mockShowToast = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      deleteHubNote: (...args: unknown[]) => mockDeleteHubNote(...args),
    },
  };
});

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const note: THubNote = {
  id: 'note-1',
  title: 'PetVee — beta testers',
  text: 'Recruit 15 testers.',
  surface: 'code',
  createdAt: '2026-10-03T07:05:17.770Z',
};

function renderList() {
  const utils = render(
    <HubNoteList
      notes={[note]}
      query=""
      isLoading={false}
      isError={false}
      onContinued={jest.fn()}
      onOpenThread={jest.fn()}
    />,
  );
  fireEvent.click(utils.getByRole('button', { name: /PetVee — beta testers/ }));
  fireEvent.click(utils.getByRole('button', { name: 'Delete note' }));
  return utils;
}

describe('HubNoteList — deleting a note', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockDeleteHubNote.mockReset().mockResolvedValue(undefined);
  });

  it('asks before deleting, names the note, and deletes it on confirm', async () => {
    const { findByRole } = renderList();

    const dialog = await findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete "PetVee — beta testers"?');
    expect(mockDeleteHubNote).not.toHaveBeenCalled();

    fireEvent.click(await findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteHubNote).toHaveBeenCalledWith('note-1'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({ message: 'Note deleted', status: 'success' }),
    );
  });

  it('leaves the note alone when the person cancels', async () => {
    const { findByRole, queryByRole } = renderList();

    fireEvent.click(await findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDeleteHubNote).not.toHaveBeenCalled();
  });

  it('says so when the delete fails', async () => {
    mockDeleteHubNote.mockRejectedValue(new Error('network'));
    const { findByRole } = renderList();

    fireEvent.click(await findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: "Couldn't delete this note. Try again.",
        status: 'error',
      }),
    );
  });
});
