import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockSummarize = jest.fn();
const mockUpdate = jest.fn();
const mockToast = jest.fn();
let mockConversation: Record<string, unknown> | null = null;
let summarizeOptions: {
  onSuccess?: (data: { summary: string }) => void;
  onError?: (error: unknown) => void;
} = {};
let updateOptions: { onSuccess?: () => void } = {};

jest.mock('recoil', () => ({
  ...jest.requireActual('recoil'),
  useRecoilValue: () => mockConversation,
}));
jest.mock('~/store', () => ({ __esModule: true, default: { conversationByIndex: () => 'convo' } }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useSummarizeLibraryDocumentMutation: (options: typeof summarizeOptions) => {
    summarizeOptions = options;
    return { mutate: mockSummarize, isLoading: false };
  },
  useUpdateLibraryDocumentMutation: (options: typeof updateOptions) => {
    updateOptions = options;
    return { mutate: mockUpdate, isLoading: false };
  },
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: mockToast }),
}));

import SummaryField from '../SummaryField';

const renderField = (value = '') =>
  render(<SummaryField documentId="d1" value={value} maxLength={2000} />);

beforeEach(() => {
  mockConversation = { endpoint: 'openAI', model: 'gpt-x' };
  localStorage.clear();
});
afterEach(() => jest.clearAllMocks());

describe('SummaryField', () => {
  it('asks the model of the open chat for a draft', () => {
    renderField();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_summary_write' }));
    expect(mockSummarize).toHaveBeenCalledWith({ id: 'd1', endpoint: 'openAI', model: 'gpt-x' });
  });

  it('offers to rewrite when there is already a summary', () => {
    renderField('Mine.');
    expect(screen.getByRole('button', { name: 'com_library_summary_rewrite' })).toBeInTheDocument();
  });

  it('falls back to the last chat the app stored when none is open', () => {
    mockConversation = null;
    localStorage.setItem(
      'lastConversationSetup_0',
      JSON.stringify({ endpoint: 'Mock', model: 'mock-model' }),
    );
    renderField();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_summary_write' }));
    expect(mockSummarize).toHaveBeenCalledWith({ id: 'd1', endpoint: 'Mock', model: 'mock-model' });
  });

  it('asks without a model when there is no chat, leaving it to the deployment’s own', () => {
    mockConversation = null;
    renderField();
    fireEvent.click(screen.getByRole('button', { name: 'com_library_summary_write' }));
    expect(mockSummarize).toHaveBeenCalledWith({ id: 'd1' });
  });

  it('shows the draft unsaved, saves it only when kept, and can drop it', () => {
    const { rerender } = renderField('Mine.');
    fireEvent.click(screen.getByRole('button', { name: 'com_library_summary_rewrite' }));
    act(() => summarizeOptions.onSuccess?.({ summary: 'Draft text.' }));

    const draft = screen.getByTestId('library-summary-draft') as HTMLTextAreaElement;
    expect(draft.value).toBe('Draft text.');
    expect(mockUpdate).not.toHaveBeenCalled();

    fireEvent.change(draft, { target: { value: ' Edited draft ' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_library_summary_keep' }));
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'd1', patch: { summary: 'Edited draft' } });

    act(() => updateOptions.onSuccess?.());
    rerender(<SummaryField documentId="d1" value="Edited draft" maxLength={2000} />);
    expect(screen.queryByTestId('library-summary-draft')).not.toBeInTheDocument();
  });

  it('keeps the old summary when the draft is discarded', () => {
    renderField('Mine.');
    fireEvent.click(screen.getByRole('button', { name: 'com_library_summary_rewrite' }));
    act(() => summarizeOptions.onSuccess?.({ summary: 'Draft text.' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_library_summary_discard' }));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect((screen.getByLabelText('com_library_summary') as HTMLTextAreaElement).value).toBe(
      'Mine.',
    );
  });

  it('tells a person with no model to open a chat, and one over the daily limit', () => {
    renderField();
    summarizeOptions.onError?.({ response: { data: { error: { code: 'model_required' } } } });
    expect(mockToast).toHaveBeenLastCalledWith({
      message: 'com_library_summary_no_model',
      status: 'error',
    });
    summarizeOptions.onError?.({ response: { data: { error: { code: 'summary_limit' } } } });
    expect(mockToast).toHaveBeenLastCalledWith({
      message: 'com_library_summary_error_limit',
      status: 'error',
    });
  });

  it('explains a failure the person can act on', () => {
    renderField();
    summarizeOptions.onError?.({ response: { data: { error: { code: 'insufficient_balance' } } } });
    expect(mockToast).toHaveBeenCalledWith({
      message: 'com_library_summary_error_balance',
      status: 'error',
    });
  });
});
