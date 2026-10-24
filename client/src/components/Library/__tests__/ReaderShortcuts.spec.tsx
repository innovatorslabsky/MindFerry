import React from 'react';
import { render, screen, within } from '@testing-library/react';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('@librechat/client', () => ({
  OGDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  OGDialogTemplate: ({ title, main }: { title: string; main: React.ReactNode }) => (
    <div>
      <h2>{title}</h2>
      {main}
    </div>
  ),
}));

import ReaderShortcuts from '../ReaderShortcuts';

const renderShortcuts = (isBook: boolean, open = true) =>
  render(<ReaderShortcuts open={open} onOpenChange={jest.fn()} isBook={isBook} />);

describe('ReaderShortcuts', () => {
  it('lists the keys that work in the reader', () => {
    renderShortcuts(false);
    const list = within(screen.getByTestId('reader-shortcuts'));
    for (const key of ['h', 'e', 'l', 'i', 'u', '?']) {
      expect(list.getByText(key)).toBeInTheDocument();
    }
  });

  it('lists the chapter and page keys only for a book', () => {
    const { unmount } = renderShortcuts(false);
    expect(screen.queryByText('n / p')).not.toBeInTheDocument();
    unmount();
    renderShortcuts(true);
    expect(screen.getByText('n / p')).toBeInTheDocument();
  });

  it('shows nothing while closed', () => {
    renderShortcuts(true, false);
    expect(screen.queryByTestId('reader-shortcuts')).not.toBeInTheDocument();
  });
});
