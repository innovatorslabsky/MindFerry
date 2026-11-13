import React from 'react';
import { render, screen, within } from '@testing-library/react';
import type { TBridgeResultWarning } from 'librechat-data-provider';
import { mockLocalize } from 'test/bridgeMocks';

jest.mock('~/hooks', () => ({ useLocalize: () => mockLocalize }));

import ResultWarnings from '../ResultWarnings';

const w = (over: Partial<TBridgeResultWarning>): TBridgeResultWarning => ({
  code: 'secret',
  line: 3,
  ...over,
});

describe('ResultWarnings', () => {
  it('shows nothing when the scan found nothing', () => {
    const { container } = render(<ResultWarnings warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says each kind of finding once, with the lines to look at', () => {
    render(
      <ResultWarnings
        warnings={[
          w({ code: 'secret', line: 2 }),
          w({ code: 'placeholder_example', line: 9 }),
          w({ code: 'placeholder_example', line: 11 }),
        ]}
      />,
    );
    const box = screen.getByTestId('bridge-result-warnings');
    expect(within(box).getByText('com_bridge_warn_title')).toBeInTheDocument();
    expect(within(box).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByTestId('bridge-warning-secret')).toHaveTextContent(
      'com_bridge_warn_lines:2',
    );
    expect(screen.getByTestId('bridge-warning-placeholder_example')).toHaveTextContent(
      'com_bridge_warn_lines:9, 11',
    );
  });

  it('names the claim words found, each once, from the scan’s own list', () => {
    render(
      <ResultWarnings
        warnings={[
          w({ code: 'banned_claim', line: 7, term: 'free' }),
          w({ code: 'banned_claim', line: 8, term: 'free' }),
          w({ code: 'banned_claim', line: 8, term: 'licensed' }),
        ]}
      />,
    );
    expect(screen.getByTestId('bridge-warning-banned_claim')).toHaveTextContent(
      'com_bridge_warn_banned_claim:free, licensed',
    );
  });

  it('shortens a long list of lines', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      w({ code: 'claim_phrase', line: i + 1, term: 'x' }),
    );
    render(<ResultWarnings warnings={many} />);
    expect(screen.getByTestId('bridge-warning-claim_phrase')).toHaveTextContent(
      '1, 2, 3, 4, 5, 6…',
    );
  });

  it('says when more findings were left out', () => {
    render(<ResultWarnings warnings={[w({})]} omitted={7} />);
    expect(screen.getByText('com_bridge_warn_more:7')).toBeInTheDocument();
  });

  it('is a labelled region a screen reader can find', () => {
    render(<ResultWarnings warnings={[w({})]} />);
    expect(screen.getByRole('region', { name: 'com_bridge_warn_title' })).toBeInTheDocument();
  });
});
