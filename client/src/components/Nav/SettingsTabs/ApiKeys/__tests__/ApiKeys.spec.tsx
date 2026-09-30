import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import {
  useGetAgentApiKeysQuery,
  useCreateAgentApiKeyMutation,
  useDeleteAgentApiKeyMutation,
} from 'librechat-data-provider/react-query';
import { render, fireEvent, waitFor } from 'test/layout-test-utils';
import ApiKeys from '../ApiKeys';

jest.mock('librechat-data-provider/react-query', () => ({
  ...jest.requireActual('librechat-data-provider/react-query'),
  useGetAgentApiKeysQuery: jest.fn(),
  useCreateAgentApiKeyMutation: jest.fn(),
  useDeleteAgentApiKeyMutation: jest.fn(),
}));

const mockUseGetStartupConfig = jest.fn();
jest.mock('~/data-provider/Endpoints/queries', () => ({
  ...jest.requireActual('~/data-provider/Endpoints/queries'),
  useGetStartupConfig: () => mockUseGetStartupConfig(),
}));

const mockQuery = useGetAgentApiKeysQuery as jest.Mock;
const mockCreate = useCreateAgentApiKeyMutation as jest.Mock;
const mockDelete = useDeleteAgentApiKeyMutation as jest.Mock;

const createdKey = {
  id: 'new-1',
  name: 'CI key',
  key: 'lc-secret-full-key',
  keyPrefix: 'lc-secret',
  createdAt: '2026-06-13T00:00:00Z',
};

function openManageDialog() {
  const utils = render(<ApiKeys />);
  fireEvent.click(utils.getByRole('button', { name: 'Agent API Keys' }));
  return utils;
}

describe('ApiKeys', () => {
  beforeEach(() => {
    mockQuery.mockReturnValue({
      data: { keys: [] },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    mockCreate.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue(createdKey),
      isLoading: false,
    });
    mockDelete.mockReturnValue({ mutateAsync: jest.fn(), isLoading: false });
    mockUseGetStartupConfig.mockReturnValue({ data: { contextHubEnabled: false } });
  });

  it('renders a manage trigger without opening the dialog', () => {
    const { getByText, getByRole, queryByRole } = render(<ApiKeys />);
    expect(getByText('Manage')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Agent API Keys' })).toBeInTheDocument();
    expect(queryByRole('heading', { name: 'Agent API Keys' })).not.toBeInTheDocument();
  });

  it('opens the management dialog with the empty state', () => {
    const { getByText } = openManageDialog();
    expect(getByText('Connect your agents to external apps')).toBeInTheDocument();
  });

  it('opens the create dialog from within the management dialog', () => {
    const { getAllByRole, getByRole } = openManageDialog();
    fireEvent.click(getAllByRole('button', { name: 'Create API Key' })[0]);
    expect(getByRole('heading', { name: 'Create API Key' })).toBeInTheDocument();
  });

  it('walks through create -> reveal -> close', async () => {
    const { getAllByRole, getByRole, getByLabelText, getByDisplayValue, queryByRole } =
      openManageDialog();
    fireEvent.click(getAllByRole('button', { name: 'Create API Key' })[0]);

    fireEvent.change(getByLabelText('Key Name'), { target: { value: 'CI key' } });
    fireEvent.click(getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(getByRole('heading', { name: 'API key created successfully' })).toBeInTheDocument(),
    );
    expect(getByDisplayValue('lc-secret-full-key')).toBeInTheDocument();

    fireEvent.click(getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(
        queryByRole('heading', { name: 'API key created successfully' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('closes the create dialog on cancel without creating a key', () => {
    const mutateAsync = jest.fn();
    mockCreate.mockReturnValue({ mutateAsync, isLoading: false });
    const { getAllByRole, getByRole } = openManageDialog();
    fireEvent.click(getAllByRole('button', { name: 'Create API Key' })[0]);
    fireEvent.click(getByRole('button', { name: 'Cancel' }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('hides the context hub endpoint when the operator has not enabled it', () => {
    const { queryByText } = openManageDialog();
    expect(queryByText('MindFerry MCP Endpoint')).not.toBeInTheDocument();
  });

  it('shows the context hub endpoint once the operator enables it', () => {
    mockUseGetStartupConfig.mockReturnValue({ data: { contextHubEnabled: true } });
    const { getByText, getByLabelText } = openManageDialog();
    expect(getByText('MindFerry MCP Endpoint')).toBeInTheDocument();
    expect((getByLabelText('MindFerry MCP Endpoint') as HTMLInputElement).value).toContain(
      '/api/hub/mcp',
    );
  });

  it('hides the hub export importer when the operator has not enabled it', () => {
    const { queryByText } = openManageDialog();
    expect(
      queryByText('Import a ChatGPT, Claude.ai, or Gemini export into MindFerry'),
    ).not.toBeInTheDocument();
  });

  it('has no importer of its own: the one Import in Data & Privacy also fills the archive', () => {
    mockUseGetStartupConfig.mockReturnValue({ data: { contextHubEnabled: true } });
    const { queryByRole } = openManageDialog();
    expect(queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
  });

  it('hides the browse-archive button when the operator has not enabled the context hub', () => {
    const { queryByRole } = openManageDialog();
    expect(queryByRole('button', { name: 'Browse' })).not.toBeInTheDocument();
  });

  it('shows the browse-archive button once the operator enables the context hub', () => {
    mockUseGetStartupConfig.mockReturnValue({ data: { contextHubEnabled: true } });
    const { getByRole } = openManageDialog();
    expect(getByRole('button', { name: 'Browse' })).toBeInTheDocument();
  });
});
