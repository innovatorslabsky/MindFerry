import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { mockClient } from 'test/libraryMocks';

const mockStart = jest.fn();
const mockNavigate = jest.fn();
const mockToast = jest.fn();
let mockConversation: Record<string, unknown> | null = null;
let startOptions: { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void } = {};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('recoil', () => ({
  ...jest.requireActual('recoil'),
  useRecoilValue: () => mockConversation,
}));
jest.mock('~/store', () => ({ __esModule: true, default: { conversationByIndex: () => 'convo' } }));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useStartLibraryChatMutation: (options: typeof startOptions) => {
    startOptions = options;
    return { mutate: mockStart, isLoading: false };
  },
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import AskButtons from '../AskButtons';

const renderButtons = (kind: 'article' | 'pdf' | 'epub', unitIndex = 2) =>
  render(
    <RecoilRoot>
      <AskButtons documentId="d1" kind={kind} unitIndex={unitIndex} />
    </RecoilRoot>,
    { wrapper: MemoryRouter },
  );

beforeEach(() => {
  mockConversation = { endpoint: 'openAI', model: 'gpt-x' };
});
afterEach(() => jest.clearAllMocks());

describe('AskButtons', () => {
  it('asks about an article on the model of the open chat', () => {
    renderButtons('article');

    fireEvent.click(screen.getByRole('button', { name: 'com_library_ask' }));

    expect(mockStart).toHaveBeenCalledWith({ id: 'd1', endpoint: 'openAI', model: 'gpt-x' });
  });

  it('asks about the current page of a PDF, or about the whole book', () => {
    renderButtons('pdf', 4);

    fireEvent.click(screen.getByRole('button', { name: 'com_library_ask_page' }));
    expect(mockStart).toHaveBeenLastCalledWith({
      id: 'd1',
      endpoint: 'openAI',
      model: 'gpt-x',
      unitIndex: 4,
    });

    fireEvent.click(screen.getByRole('button', { name: 'com_library_ask_book' }));
    expect(mockStart).toHaveBeenLastCalledWith({ id: 'd1', endpoint: 'openAI', model: 'gpt-x' });
  });

  it('calls an EPUB section a chapter', () => {
    renderButtons('epub');

    expect(screen.getByRole('button', { name: 'com_library_ask_chapter' })).toBeInTheDocument();
  });

  it('leaves the model to the server when the open chat is an agent', () => {
    mockConversation = { endpoint: 'agents', model: 'gpt-x' };
    renderButtons('article');

    fireEvent.click(screen.getByRole('button', { name: 'com_library_ask' }));

    expect(mockStart).toHaveBeenCalledWith({ id: 'd1' });
  });

  it('opens the new chat, and explains a failure', () => {
    renderButtons('article');

    startOptions.onSuccess?.({ conversationId: 'conv-9' });
    expect(mockNavigate).toHaveBeenCalledWith('/c/conv-9');

    startOptions.onError?.({ response: { data: { error: { code: 'empty_document' } } } });
    expect(mockToast).toHaveBeenCalledWith({
      message: 'com_library_ask_empty',
      status: 'error',
    });
  });
});
