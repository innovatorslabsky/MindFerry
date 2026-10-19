import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockUpdate = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useUpdateLibraryDocumentMutation: () => ({ mutate: mockUpdate, isLoading: false }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: jest.fn() }),
}));
jest.mock('../HighlightsPanel', () => ({
  __esModule: true,
  default: ({ highlights }: { highlights: unknown[] }) => (
    <div data-testid="highlights-panel">{highlights.length}</div>
  ),
}));
jest.mock('../InfoPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="info-panel" />,
}));

import ReaderSidePanel from '../ReaderSidePanel';

const document = { id: 'd1', note: 'Existing note' } as never;

afterEach(() => jest.clearAllMocks());

describe('ReaderSidePanel', () => {
  it('shows the Info tab on its own', () => {
    render(
      <ReaderSidePanel
        document={document}
        highlights={[]}
        tab="info"
        onTab={jest.fn()}
        onFocus={jest.fn()}
      />,
    );
    expect(screen.getByTestId('info-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('highlights-panel')).toBeNull();
    expect(screen.getByRole('tab', { name: 'com_library_panel_info' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows the note above the highlights in the Notebook tab', () => {
    render(
      <ReaderSidePanel
        document={document}
        highlights={[{ id: 'h1' }, { id: 'h2' }] as never}
        tab="notebook"
        onTab={jest.fn()}
        onFocus={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('com_library_doc_note')).toHaveValue('Existing note');
    expect(screen.getByTestId('highlights-panel')).toHaveTextContent('2');
    expect(screen.queryByTestId('info-panel')).toBeNull();
  });

  it('changes tab when one is chosen', () => {
    const onTab = jest.fn();
    render(
      <ReaderSidePanel
        document={document}
        highlights={[]}
        tab="notebook"
        onTab={onTab}
        onFocus={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'com_library_panel_info' }));
    expect(onTab).toHaveBeenCalledWith('info');
  });

  it('saves the note when the field loses focus', () => {
    render(
      <ReaderSidePanel
        document={document}
        highlights={[]}
        tab="notebook"
        onTab={jest.fn()}
        onFocus={jest.fn()}
      />,
    );
    const field = screen.getByLabelText('com_library_doc_note');
    fireEvent.change(field, { target: { value: 'Changed note' } });
    fireEvent.blur(field);
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'd1', patch: { note: 'Changed note' } });
  });
});
