import React from 'react';
import { render, screen } from '@testing-library/react';

import ResultMarkdown from '../ResultMarkdown';

const renderText = (text: string) => render(<ResultMarkdown text={text} />);

describe('ResultMarkdown', () => {
  it('draws ordinary Markdown', () => {
    renderText('status: DONE\n\n## What was done\n\n- read it\n- wrote it\n');
    expect(screen.getByRole('heading', { name: 'What was done' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('never renders raw HTML an agent wrote', () => {
    const { container } = renderText(
      '<script>window.hacked = 1</script><iframe src="https://evil.test"></iframe><b onclick="x()">hi</b>',
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it('does not draw images, so the text cannot make this browser fetch anything', () => {
    const { container } = renderText(
      '![tracker](https://evil.test/pixel.png) and ![](https://evil.test/p2.png)',
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('tracker')).toBeInTheDocument();
  });

  it('makes only http and https addresses into links, opened safely', () => {
    const { container } = renderText(
      '[good](https://example.com/a) [bad](javascript:alert(1)) [data](data:text/html,x) [mail](mailto:a@b.c)',
    );
    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.com/a');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(screen.getByText('bad')).toBeInTheDocument();
  });
});
