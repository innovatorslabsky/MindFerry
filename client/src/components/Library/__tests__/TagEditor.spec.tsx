import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockClient } from 'test/libraryMocks';

const mockUpdate = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error', SUCCESS: 'success' } }));
jest.mock('~/data-provider', () => ({
  useUpdateLibraryDocumentMutation: () => ({ mutate: mockUpdate }),
}));
jest.mock('@librechat/client', () => ({
  ...mockClient,
  useToastContext: () => ({ showToast: jest.fn() }),
}));

import TagEditor, { addTag, MAX_TAGS, MAX_TAG_LENGTH } from '../TagEditor';

afterEach(() => jest.clearAllMocks());

describe('addTag', () => {
  it('trims, collapses spaces and ignores case when checking for a duplicate', () => {
    expect(addTag(['Psych'], '  memory   palace ')).toEqual(['Psych', 'memory palace']);
    expect(addTag(['Psych'], 'psych')).toEqual(['Psych']);
    expect(addTag(['a'], '   ')).toEqual(['a']);
  });

  it('cuts a tag to the length the server accepts and stops at the tag limit', () => {
    expect(addTag([], 'x'.repeat(200))[0]).toHaveLength(MAX_TAG_LENGTH);
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(addTag(full, 'one more')).toEqual(full);
  });
});

describe('TagEditor', () => {
  it('adds a tag on Enter and saves the whole list', () => {
    render(<TagEditor documentId="d1" tags={['psych']} />);
    const input = screen.getByLabelText('com_library_tag_add');
    fireEvent.change(input, { target: { value: 'memory' } });
    fireEvent.submit(input);
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'd1', patch: { tags: ['psych', 'memory'] } });
    expect(input).toHaveValue('');
  });

  it('does not save a duplicate or an empty tag', () => {
    render(<TagEditor documentId="d1" tags={['psych']} />);
    const input = screen.getByLabelText('com_library_tag_add');
    fireEvent.change(input, { target: { value: 'PSYCH' } });
    fireEvent.submit(input);
    fireEvent.submit(input);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('removes just the chosen tag', () => {
    render(<TagEditor documentId="d1" tags={['a', 'b', 'c']} />);
    fireEvent.click(screen.getByLabelText('com_library_tag_remove:b'));
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'd1', patch: { tags: ['a', 'c'] } });
  });
});
