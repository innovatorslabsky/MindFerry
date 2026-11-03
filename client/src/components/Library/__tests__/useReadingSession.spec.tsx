import { act, fireEvent, renderHook } from '@testing-library/react';

const mockMutate = jest.fn();
jest.mock('~/data-provider', () => ({
  useSaveLibrarySessionMutation: () => ({ mutate: mockMutate }),
}));
let mockOffset = 0;
jest.mock('~/utils/libraryAnchors', () => ({ offsetAtTop: () => mockOffset }));

import { useReadingSession } from '../useReadingSession';

const text = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
const refs = () => ({
  content: { current: document.createElement('div') },
  scroller: { current: document.createElement('div') },
});

function setup(documentId = 'd1') {
  return renderHook(
    (props: { documentId: string }) =>
      useReadingSession({
        ...refs(),
        anchorText: text,
        unitKey: 'document',
        aligned: true,
        ...props,
      }),
    { initialProps: { documentId } },
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-03-10T12:00:00Z'));
  mockOffset = 0;
  jest.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  mockMutate.mockClear();
});

/** The reader scrolls a little each second for `seconds`. */
function read(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    act(() => {
      mockOffset += 40;
      fireEvent.scroll(window);
      jest.advanceTimersByTime(1000);
    });
  }
}

describe('useReadingSession', () => {
  it('reports the time and words every so often, with the session it is keeping', () => {
    setup();
    read(15);
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const call = mockMutate.mock.calls[0][0];
    expect(call.id).toBe('d1');
    expect(call.report.activeSeconds).toBeGreaterThanOrEqual(13);
    expect(call.report.words).toBeGreaterThan(0);

    read(15);
    expect(mockMutate).toHaveBeenCalledTimes(2);
    expect(mockMutate.mock.calls[1][0].sid).toBe(call.sid);
    expect(mockMutate.mock.calls[1][0].report.activeSeconds).toBeGreaterThan(
      call.report.activeSeconds,
    );
  });

  it('says nothing for a reader who never did anything', () => {
    setup();
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('reports what it has when the tab is hidden and when the reader leaves', () => {
    const { unmount } = setup();
    read(5);
    expect(mockMutate).not.toHaveBeenCalled();

    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockMutate).toHaveBeenCalledTimes(1);

    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    read(4);
    unmount();
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });

  it('does not count time while the window has lost focus', () => {
    setup();
    jest.spyOn(document, 'hasFocus').mockReturnValue(false);
    read(20);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('starts a new session for a different document', () => {
    const { rerender } = setup('d1');
    read(5);
    rerender({ documentId: 'd2' });
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0].id).toBe('d1');
    read(5);
    rerender({ documentId: 'd3' });
    expect(mockMutate.mock.calls[1][0].id).toBe('d2');
    expect(mockMutate.mock.calls[1][0].sid).not.toBe(mockMutate.mock.calls[0][0].sid);
  });
});
