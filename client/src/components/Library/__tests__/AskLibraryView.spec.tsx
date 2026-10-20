import React from 'react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockStart = jest.fn();
const mockNavigate = jest.fn();
const mockToast = jest.fn();
let mockConversation: Record<string, unknown> | null = null;
let mockCount: { data?: { count: number } } = {};
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
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useLibraryCountQuery: () => mockCount,
  useStartLibraryAskMutation: (options: typeof startOptions) => {
    startOptions = options;
    return { mutate: mockStart, isLoading: false };
  },
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import AskLibraryView from '../AskLibraryView';

const renderView = () =>
  render(
    <RecoilRoot>
      <AskLibraryView />
    </RecoilRoot>,
    { wrapper: MemoryRouter },
  );

beforeEach(() => {
  mockConversation = { endpoint: 'openAI', model: 'gpt-x' };
  mockCount = { data: { count: 12 } };
});
afterEach(() => jest.clearAllMocks());

describe('AskLibraryView', () => {
  it('says how many documents there are', () => {
    renderView();

    expect(screen.getByTestId('library-ask-count')).toHaveTextContent(
      'com_library_ask_library_count:12',
    );
  });

  it('needs a topic to find, and sends it with the open chat model', () => {
    renderView();
    const start = screen.getByRole('button', { name: 'com_library_ask_library_start' });
    expect(start).toBeDisabled();

    fireEvent.change(screen.getByLabelText('com_library_ask_library_topic'), {
      target: { value: '  sleep  ' },
    });
    fireEvent.click(start);

    expect(mockStart).toHaveBeenCalledWith({
      mode: 'find',
      topic: 'sleep',
      endpoint: 'openAI',
      model: 'gpt-x',
    });
  });

  it('starts catch up and recommend without a topic', () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'com_library_ask_mode_catchup' }));
    expect(screen.queryByLabelText('com_library_ask_library_topic')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_ask_library_start' }));

    expect(mockStart).toHaveBeenCalledWith({
      mode: 'catchup',
      endpoint: 'openAI',
      model: 'gpt-x',
    });
  });

  it('opens the new chat, and says why when nothing matched', () => {
    renderView();

    startOptions.onSuccess?.({ conversationId: 'c1' });
    expect(mockNavigate).toHaveBeenCalledWith('/c/c1');

    startOptions.onError?.({ response: { data: { error: { code: 'no_matches' } } } });
    expect(mockToast).toHaveBeenCalledWith({
      message: 'com_library_ask_library_no_matches',
      status: 'error',
    });
  });
});
