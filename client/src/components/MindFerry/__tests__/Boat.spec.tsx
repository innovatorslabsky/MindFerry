import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import Boat from '../Boat';

describe('Boat', () => {
  it('draws the MindFerry logo as a decorative round image', () => {
    const { container } = render(<Boat className="h-full w-full" />);
    const image = container.querySelector('img');

    expect(image).toHaveAttribute('src', 'assets/logo.svg');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('aria-hidden', 'true');
    expect(image).toHaveClass('rounded-full', 'h-full', 'w-full');
  });
});
