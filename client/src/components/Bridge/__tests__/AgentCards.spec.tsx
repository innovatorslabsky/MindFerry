import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TBridgeAgentStatus, TBridgeStatus } from 'librechat-data-provider';
import { mockLocalize } from 'test/bridgeMocks';

jest.mock('~/hooks', () => ({ useLocalize: () => mockLocalize }));

import AgentCards from '../AgentCards';

const agent = (over: Partial<TBridgeAgentStatus> & Pick<TBridgeAgentStatus, 'agent'>) =>
  ({ health: 'up', job: { state: 'ok' }, ...over }) as TBridgeAgentStatus;

const fresh = (agents: TBridgeAgentStatus[]): TBridgeStatus => ({
  generatedAt: '2026-11-09T13:20:00Z',
  stale: false,
  agents,
});

describe('AgentCards', () => {
  it('shows a running agent whose poll works', () => {
    render(
      <AgentCards
        status={fresh([
          agent({ agent: 'hermes', version: 'v0.22.7', startedAt: '2026-11-07T01:36:18Z' }),
          agent({ agent: 'openclaw' }),
        ])}
      />,
    );
    expect(screen.getByTestId('bridge-health-hermes')).toHaveTextContent('com_bridge_health_up');
    expect(screen.getByTestId('bridge-job-hermes')).toHaveTextContent('com_bridge_job_ok');
    expect(screen.getByText('com_bridge_version:v0.22.7')).toBeInTheDocument();
    expect(screen.queryByTestId('bridge-stale')).not.toBeInTheDocument();
  });

  it('shows why a poll the host switched off is off, not just that the container is up', () => {
    render(
      <AgentCards
        status={fresh([
          agent({ agent: 'hermes' }),
          agent({
            agent: 'openclaw',
            job: {
              state: 'disabled',
              errorKind: 'billing',
              consecutiveErrors: 10,
              lastRunAt: '2026-11-07T23:29:20Z',
            },
          }),
        ])}
      />,
    );
    expect(screen.getByTestId('bridge-health-openclaw')).toHaveTextContent('com_bridge_health_up');
    expect(screen.getByTestId('bridge-job-openclaw')).toHaveTextContent('com_bridge_job_disabled');
    expect(screen.getByTestId('bridge-reason-openclaw')).toHaveTextContent(
      'com_bridge_reason_billing',
    );
    expect(screen.getByText('com_bridge_streak:10')).toBeInTheDocument();
  });

  it('shows a failed poll and a stopped container', () => {
    render(
      <AgentCards
        status={fresh([
          agent({ agent: 'hermes', health: 'down', job: { state: 'error', errorKind: 'timeout' } }),
          agent({ agent: 'openclaw' }),
        ])}
      />,
    );
    expect(screen.getByTestId('bridge-health-hermes')).toHaveTextContent('com_bridge_health_down');
    expect(screen.getByTestId('bridge-job-hermes')).toHaveTextContent('com_bridge_job_error');
    expect(screen.getByTestId('bridge-reason-hermes')).toHaveTextContent(
      'com_bridge_reason_timeout',
    );
  });

  it('for a host cron, says empty polls are normal and shows the last task handed to the agent', () => {
    render(
      <AgentCards
        status={fresh([
          agent({ agent: 'hermes' }),
          agent({
            agent: 'openclaw',
            job: {
              state: 'ok',
              kind: 'host-cron',
              lastRunAt: '2026-11-09T13:20:00Z',
              lastCallAt: '2026-11-09T09:00:00Z',
              intervalMinutes: 10,
            },
          }),
        ])}
      />,
    );
    expect(screen.getByTestId('bridge-job-openclaw')).toHaveTextContent('com_bridge_job_ok');
    expect(screen.getByTestId('bridge-gated-openclaw')).toHaveTextContent('com_bridge_poll_gated');
    expect(screen.getByTestId('bridge-call-openclaw')).toHaveTextContent('com_bridge_last_call');
    expect(screen.queryByTestId('bridge-gated-hermes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bridge-call-hermes')).not.toBeInTheDocument();
  });

  it('shows a host cron that has gone quiet as a problem, with its reason', () => {
    render(
      <AgentCards
        status={fresh([
          agent({ agent: 'hermes' }),
          agent({
            agent: 'openclaw',
            job: { state: 'error', kind: 'host-cron', errorKind: 'stalled', intervalMinutes: 10 },
          }),
        ])}
      />,
    );
    expect(screen.getByTestId('bridge-job-openclaw')).toHaveTextContent('com_bridge_job_error');
    expect(screen.getByTestId('bridge-reason-openclaw')).toHaveTextContent(
      'com_bridge_reason_stalled',
    );
    expect(screen.queryByTestId('bridge-gated-openclaw')).not.toBeInTheDocument();
  });

  it('says plainly when the last task handed to the agent failed and was left unfinished', () => {
    render(
      <AgentCards
        status={fresh([
          agent({ agent: 'hermes' }),
          agent({
            agent: 'openclaw',
            job: {
              state: 'error',
              kind: 'host-cron',
              lastCallOk: false,
              lastCallAt: '2026-11-09T09:00:00Z',
              errorKind: 'billing',
              consecutiveErrors: 1,
            },
          }),
        ])}
      />,
    );
    expect(screen.getByTestId('bridge-callfailed-openclaw')).toHaveTextContent(
      'com_bridge_call_failed',
    );
    expect(screen.getByTestId('bridge-reason-openclaw')).toHaveTextContent(
      'com_bridge_reason_billing',
    );
    expect(screen.queryByTestId('bridge-callfailed-hermes')).not.toBeInTheDocument();
  });

  it('does not show a reason for a poll that is fine', () => {
    render(
      <AgentCards status={fresh([agent({ agent: 'hermes' }), agent({ agent: 'openclaw' })])} />,
    );
    expect(screen.queryByTestId('bridge-reason-hermes')).not.toBeInTheDocument();
  });

  it('says the status is out of date and shows unknown, never running', () => {
    render(
      <AgentCards
        status={{
          stale: true,
          agents: [
            agent({ agent: 'hermes', health: 'unknown', job: { state: 'unknown' } }),
            agent({ agent: 'openclaw', health: 'unknown', job: { state: 'unknown' } }),
          ],
        }}
      />,
    );
    expect(screen.getByTestId('bridge-stale')).toHaveTextContent('com_bridge_stale');
    expect(screen.getByTestId('bridge-health-hermes')).toHaveTextContent(
      'com_bridge_health_unknown',
    );
    expect(screen.getByTestId('bridge-job-hermes')).toHaveTextContent('com_bridge_job_unknown');
    expect(screen.queryByText('com_bridge_health_up')).not.toBeInTheDocument();
  });
});
