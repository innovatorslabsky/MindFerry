import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { useSubmitHubOAuthConsentMutation } from '~/data-provider';
import useAuthRedirect from '~/routes/useAuthRedirect';
import { useLocalize } from '~/hooks';

/**
 * The page Claude.ai's connector flow lands on after `/api/hub/oauth/authorize`
 * validates the request and redirects here — this app's access token lives in
 * the SPA's memory, not a cookie a plain navigation carries, so the decision
 * has to happen from a real page rather than a backend-rendered one.
 */
export default function MindFerryConnect() {
  const localize = useLocalize();
  const { isAuthenticated } = useAuthRedirect();
  const [searchParams] = useSearchParams();
  const [decisionSent, setDecisionSent] = useState<'approve' | 'deny' | null>(null);
  const consentMutation = useSubmitHubOAuthConsentMutation({
    onSuccess: (data) => {
      window.location.href = data.redirectUrl;
    },
  });

  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const codeChallenge = searchParams.get('code_challenge');
  const state = searchParams.get('state') ?? undefined;

  const redirectHost = useMemo(() => {
    if (!redirectUri) {
      return null;
    }
    try {
      return new URL(redirectUri).host;
    } catch {
      return null;
    }
  }, [redirectUri]);

  const requestIsValid = Boolean(clientId && redirectUri && codeChallenge && redirectHost);

  const submit = (decision: 'approve' | 'deny') => {
    if (!clientId || !redirectUri || !codeChallenge) {
      return;
    }
    setDecisionSent(decision);
    consentMutation.mutate({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      response_type: 'code',
      code_challenge_method: 'S256',
      decision,
      ...(state ? { state } : {}),
    });
  };

  if (!isAuthenticated) {
    return (
      <div
        className="bg-surface-secondary flex min-h-screen items-center justify-center"
        aria-live="polite"
        role="status"
      >
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  return (
    <div className="bg-surface-secondary flex min-h-screen items-center justify-center p-8">
      <div className="bg-surface-primary w-full max-w-md rounded-xl p-8 shadow-lg">
        <h1 className="text-text-primary mb-4 text-xl font-bold">
          {localize('com_ui_mindferry_connect_title')}
        </h1>

        {!requestIsValid ? (
          <p className="text-status-error text-sm">
            {localize('com_ui_mindferry_connect_invalid')}
          </p>
        ) : (
          <>
            <p className="text-text-secondary mb-6 text-sm">
              <strong className="text-text-primary">{redirectHost}</strong>{' '}
              {localize('com_ui_mindferry_connect_description')}
            </p>
            {consentMutation.isError ? (
              <p className="text-status-error mb-4 text-sm">
                {localize('com_ui_mindferry_connect_error')}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                disabled={consentMutation.isLoading}
                onClick={() => submit('deny')}
                aria-label={localize('com_ui_deny')}
              >
                {decisionSent === 'deny' && consentMutation.isLoading ? (
                  <Spinner className="mx-auto h-4 w-4" />
                ) : (
                  localize('com_ui_deny')
                )}
              </Button>
              <Button
                variant="default"
                className="flex-1"
                disabled={consentMutation.isLoading}
                onClick={() => submit('approve')}
                aria-label={localize('com_ui_approve')}
              >
                {decisionSent === 'approve' && consentMutation.isLoading ? (
                  <Spinner className="mx-auto h-4 w-4" />
                ) : (
                  localize('com_ui_approve')
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
