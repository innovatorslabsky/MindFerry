import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TBridgeTask } from 'librechat-data-provider';
import { mockBridgeClient, mockLocalize } from 'test/bridgeMocks';

jest.mock('~/hooks', () => ({ useLocalize: () => mockLocalize }));
jest.mock('@librechat/client', () => mockBridgeClient);

import TaskList from '../TaskList';

const task = (over: Partial<TBridgeTask>): TBridgeTask => ({
  id: '2026-11-07-0143-hermes-readme-summary',
  to: 'hermes',
  state: 'done',
  summary: 'Read the README',
  hasResult: true,
  resultStatus: 'DONE',
  priority: 'normal',
  created: '2026-11-07T01:43:00Z',
  ...over,
});

describe('TaskList', () => {
  it('lists each task with its state, agent and priority', () => {
    render(<TaskList tasks={[task({})]} truncated={false} onOpen={jest.fn()} />);
    const row = screen.getByTestId('bridge-task-2026-11-07-0143-hermes-readme-summary');
    expect(row).toHaveTextContent('Read the README');
    expect(row).toHaveTextContent('com_bridge_state_done');
    expect(row).toHaveTextContent('com_bridge_for:Hermes');
    expect(row).toHaveTextContent('com_bridge_priority_normal');
  });

  it.each([
    ['queued', 'com_bridge_state_queued'],
    ['running', 'com_bridge_state_running'],
    ['failed', 'com_bridge_state_failed'],
    ['archived', 'com_bridge_state_archived'],
  ] as const)('labels a %s task', (state, label) => {
    render(
      <TaskList tasks={[task({ state, hasResult: false })]} truncated={false} onOpen={jest.fn()} />,
    );
    expect(screen.getByTestId('bridge-task-state')).toHaveTextContent(label);
  });

  it('opens a result only for a task that has one', () => {
    const onOpen = jest.fn();
    render(
      <TaskList
        tasks={[
          task({}),
          task({
            id: '2026-11-08-0900-openclaw-wait',
            to: 'openclaw',
            state: 'queued',
            hasResult: false,
          }),
        ]}
        truncated={false}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByTestId('bridge-open-2026-11-07-0143-hermes-readme-summary'));
    expect(onOpen).toHaveBeenCalledWith('2026-11-07-0143-hermes-readme-summary');
    expect(
      screen.queryByTestId('bridge-open-2026-11-08-0900-openclaw-wait'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('com_bridge_no_result')).toBeInTheDocument();
  });

  it('says a task that has been running for an hour with no result may be stuck, and moves nothing', () => {
    const onOpen = jest.fn();
    render(
      <TaskList
        tasks={[
          task({
            state: 'running',
            hasResult: false,
            resultStatus: undefined,
            stuck: true,
          }),
        ]}
        truncated={false}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByTestId('bridge-task-stuck')).toHaveTextContent('com_bridge_task_stuck');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows no stuck hint for a task that is not marked', () => {
    render(
      <TaskList
        tasks={[task({ state: 'running', hasResult: false })]}
        truncated={false}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('bridge-task-stuck')).not.toBeInTheDocument();
  });

  it('says what to do when there are no tasks', () => {
    render(<TaskList tasks={[]} truncated={false} onOpen={jest.fn()} />);
    expect(screen.getByTestId('empty-state')).toHaveTextContent('com_bridge_tasks_empty');
    expect(screen.queryByTestId('bridge-task-list')).not.toBeInTheDocument();
  });

  it('says when only the newest tasks are shown', () => {
    render(<TaskList tasks={[task({})]} truncated={true} onOpen={jest.fn()} />);
    expect(screen.getByTestId('bridge-truncated')).toBeInTheDocument();
  });

  it('renders a task summary as plain text, not markup', () => {
    render(
      <TaskList
        tasks={[task({ summary: '<img src=x onerror=alert(1)> <b>bold</b>' })]}
        truncated={false}
        onOpen={jest.fn()}
      />,
    );
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  });
});
