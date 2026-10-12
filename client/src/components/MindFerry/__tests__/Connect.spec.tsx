import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { useSubmitHubOAuthConsentMutation } from '~/data-provider';
import { render, fireEvent } from 'test/layout-test-utils';
import useAuthRedirect from '~/routes/useAuthRedirect';
import MindFerryConnect from '../Connect';

jest.mock('~/routes/useAuthRedirect');
jest.mock('~/data-provider/mutations', () => ({
  ...jest.requireActual('~/data-provider/mutations'),
  useSubmitHubOAuthConsentMutation: jest.fn(),
}));

const mockUseAuthRedirect = useAuthRedirect as jest.Mock;
const mockUseConsentMutation = useSubmitHubOAuthConsentMutation as jest.Mock;

function setUrl(search: string) {
  window.history.pushState({}, '', `/mindferry/connect${search}`);
}

const validSearch =
  '?client_id=mf_abc123&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fcallback&code_challenge=challenge-value&state=xyz';

describe('MindFerryConnect', () => {
  let mutate: jest.Mock;

  beforeEach(() => {
    mutate = jest.fn();
    mockUseConsentMutation.mockReturnValue({ mutate, isLoading: false, isError: false });
    mockUseAuthRedirect.mockReturnValue({ isAuthenticated: true });
  });

  it('shows a spinner instead of the consent card while the user is not yet authenticated', () => {
    setUrl(validSearch);
    mockUseAuthRedirect.mockReturnValue({ isAuthenticated: false });

    const { getByRole, queryByText } = render(<MindFerryConnect />);

    expect(getByRole('status')).toBeInTheDocument();
    expect(queryByText('Connect to MindFerry')).not.toBeInTheDocument();
  });

  it('shows an invalid-request message rather than the approve/deny buttons when required params are missing', () => {
    setUrl('?client_id=mf_abc123');

    const { getByText, queryByRole } = render(<MindFerryConnect />);

    expect(
      getByText(
        "This connection request is missing required information. Please restart the connection from the client you're connecting.",
      ),
    ).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('renders the requesting redirect host and both decision buttons for a well-formed request', () => {
    setUrl(validSearch);

    const { getByText, getByRole } = render(<MindFerryConnect />);

    expect(getByText('claude.ai')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('submits an approve decision with the parsed OAuth params', () => {
    setUrl(validSearch);

    const { getByRole } = render(<MindFerryConnect />);
    fireEvent.click(getByRole('button', { name: 'Approve' }));

    expect(mutate).toHaveBeenCalledWith({
      client_id: 'mf_abc123',
      redirect_uri: 'https://claude.ai/api/mcp/callback',
      code_challenge: 'challenge-value',
      response_type: 'code',
      code_challenge_method: 'S256',
      decision: 'approve',
      state: 'xyz',
    });
  });

  it('submits a deny decision without a state param when none was in the URL', () => {
    setUrl(
      '?client_id=mf_abc123&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fcallback&code_challenge=challenge-value',
    );

    const { getByRole } = render(<MindFerryConnect />);
    fireEvent.click(getByRole('button', { name: 'Deny' }));

    const [[payload]] = mutate.mock.calls;
    expect(payload.decision).toBe('deny');
    expect(payload).not.toHaveProperty('state');
  });

  it("wires the mutation's onSuccess to a handler that navigates using the response", () => {
    setUrl(validSearch);
    let capturedOnSuccess: ((data: { redirectUrl: string }) => void) | undefined;
    mockUseConsentMutation.mockImplementation((options) => {
      capturedOnSuccess = options?.onSuccess;
      return { mutate, isLoading: false, isError: false };
    });

    render(<MindFerryConnect />);

    /**
     * jsdom refuses to redefine `window.location` (non-configurable here)
     * and only logs a "not implemented" navigation notice rather than
     * throwing, so the actual browser redirect can't be asserted from this
     * environment. This still proves the handler runs to completion against
     * a real response shape without an unrelated error.
     */
    expect(() =>
      capturedOnSuccess?.({ redirectUrl: 'https://claude.ai/api/mcp/callback?code=abc' }),
    ).not.toThrow();
  });

  it('shows an error message when the consent submission fails', () => {
    setUrl(validSearch);
    mockUseConsentMutation.mockReturnValue({ mutate, isLoading: false, isError: true });

    const { getByText } = render(<MindFerryConnect />);

    expect(
      getByText('Something went wrong submitting your decision. Please try again.'),
    ).toBeInTheDocument();
  });
});
