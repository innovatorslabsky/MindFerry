import axios, { AxiosError } from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MCPDirectoryResponse } from 'librechat-data-provider';
import type { AxiosResponse } from 'axios';
import MCPDirectoryList from './MCPDirectoryList';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useDebounce: (value: string) => value,
}));

jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  FilterInput: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }) => <input aria-label={label} value={value} onChange={onChange} />,
  Spinner: () => <span />,
}));

const entry = (id: string): MCPDirectoryResponse['entries'][number] => ({
  id,
  name: id,
  repoUrl: `https://github.com/${id}`,
  description: `${id} description`,
  categoryId: 'databases',
  categoryName: 'Databases',
  scopes: [],
  official: false,
});

const page = (overrides: Partial<MCPDirectoryResponse> = {}): MCPDirectoryResponse => ({
  entries: [entry('acme/one')],
  total: 1,
  categories: [{ id: 'databases', name: 'Databases', count: 1 }],
  sourceUrl: 'https://example.test/README.md',
  fetchedAt: '2026-10-12T00:00:00.000Z',
  ...overrides,
});

const requestedUrls = (spy: jest.SpyInstance): string[] =>
  spy.mock.calls.map(([url]) => String(url));

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MCPDirectoryList />
    </QueryClientProvider>,
  );
}

describe('MCPDirectoryList', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists entries with their repository link and the source attribution', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: page() });
    renderList();

    expect(await screen.findByText('acme/one')).toBeInTheDocument();
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', 'https://github.com/acme/one');
    expect(screen.getByText('com_ui_mcp_directory_source')).toHaveAttribute(
      'href',
      'https://example.test/README.md',
    );
  });

  it('passes the typed search through to the request', async () => {
    const spy = jest.spyOn(axios, 'get').mockResolvedValue({ data: page() });
    renderList();
    await screen.findByText('acme/one');

    fireEvent.change(screen.getByLabelText('com_ui_mcp_directory_search'), {
      target: { value: 'postgres' },
    });

    await waitFor(() =>
      expect(requestedUrls(spy).some((url) => url.includes('q=postgres'))).toBe(true),
    );
  });

  it('loads the next page with the returned cursor', async () => {
    const spy = jest
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: page({ total: 2, nextCursor: '1' }) })
      .mockResolvedValueOnce({ data: page({ total: 2, entries: [entry('acme/two')] }) });
    renderList();
    await screen.findByText('acme/one');

    fireEvent.click(screen.getByText('com_ui_load_more'));

    expect(await screen.findByText('acme/two')).toBeInTheDocument();
    expect(requestedUrls(spy).at(-1)).toContain('cursor=1');
  });

  it('shows the empty state when nothing matches', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: page({ entries: [], total: 0 }) });
    renderList();

    expect(await screen.findByText('com_ui_mcp_directory_empty')).toBeInTheDocument();
  });

  it('shows an error when the directory is unavailable', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('boom'));
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent('com_ui_mcp_directory_error');
  });

  it('renders nothing when the operator has not enabled the directory', async () => {
    const notFound = new AxiosError('Not Found', '404', undefined, undefined, {
      status: 404,
    } as AxiosResponse);
    const spy = jest.spyOn(axios, 'get').mockRejectedValue(notFound);
    const { container } = renderList();

    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
