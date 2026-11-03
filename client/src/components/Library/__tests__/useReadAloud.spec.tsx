import { act, renderHook } from '@testing-library/react';

const mockPaint = jest.fn((..._args: unknown[]) => null);
const mockClear = jest.fn();
let mockTop = 0;
jest.mock('~/utils/libraryAnchors', () => ({
  paintSpeaking: (...args: unknown[]) => mockPaint(...args),
  clearSpeaking: () => mockClear(),
  offsetAtTop: () => mockTop,
}));

import { canSpeak, useReadAloud } from '../useReadAloud';

class FakeUtterance {
  text: string;
  rate = 1;
  lang = '';
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const spoken: FakeUtterance[] = [];
const synth = {
  speak: jest.fn((utterance: FakeUtterance) => {
    spoken.push(utterance);
  }),
  cancel: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  getVoices: jest.fn(() => [] as unknown[]),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};

const TEXT = 'First sentence here. Second sentence follows. Third one ends it.';
const refs = () => ({
  content: { current: document.createElement('div') },
  scroller: { current: document.createElement('div') },
});

beforeEach(() => {
  spoken.length = 0;
  mockTop = 0;
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    FakeUtterance;
  window.localStorage.clear();
});
afterEach(() => {
  jest.clearAllMocks();
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  delete (globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
});

const setup = (text = TEXT) =>
  renderHook((props: { text: string }) => useReadAloud({ ...refs(), lang: 'en', ...props }), {
    initialProps: { text },
  });

describe('useReadAloud', () => {
  it('says it is not supported where the browser has no speech', () => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    expect(canSpeak()).toBe(false);
    const { result } = setup();
    expect(result.current.supported).toBe(false);
  });

  it('reads a sentence at a time from the top of the screen, and goes on to the next when one ends', () => {
    const { result } = setup();
    expect(result.current.supported).toBe(true);
    act(() => result.current.play());
    expect(result.current.status).toBe('playing');
    expect(spoken.map((u) => u.text)).toEqual(['First sentence here.']);
    expect(mockPaint).toHaveBeenLastCalledWith(expect.anything(), 0, 20);

    act(() => spoken[0].onend?.());
    expect(spoken.map((u) => u.text)).toEqual(['First sentence here.', 'Second sentence follows.']);
    act(() => spoken[1].onend?.());
    act(() => spoken[2].onend?.());
    expect(result.current.status).toBe('idle');
    expect(mockClear).toHaveBeenCalled();
  });

  it('starts at the sentence that is at the top of the screen', () => {
    mockTop = TEXT.indexOf('Second') + 3;
    const { result } = setup();
    act(() => result.current.play());
    expect(spoken[0].text).toBe('Second sentence follows.');
  });

  it('pauses, goes on from the pause, and stops', () => {
    const { result } = setup();
    act(() => result.current.play());
    act(() => result.current.pause());
    expect(synth.pause).toHaveBeenCalled();
    expect(result.current.status).toBe('paused');

    act(() => result.current.play());
    expect(synth.resume).toHaveBeenCalled();
    expect(result.current.status).toBe('playing');
    expect(spoken).toHaveLength(1);

    act(() => result.current.stop());
    expect(synth.cancel).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('does not go on to the next sentence after it has been stopped, even if the old one reports it ended', () => {
    const { result } = setup();
    act(() => result.current.play());
    const first = spoken[0];
    act(() => result.current.stop());
    act(() => first.onend?.());
    expect(spoken).toHaveLength(1);
    expect(result.current.status).toBe('idle');
  });

  it('goes on at the new speed from the sentence being read, and remembers the speed', () => {
    const { result } = setup();
    act(() => result.current.play());
    act(() => spoken[0].onend?.());
    expect(spoken).toHaveLength(2);

    act(() => result.current.setRate(1.5));
    expect(spoken).toHaveLength(3);
    expect(spoken[2].text).toBe('Second sentence follows.');
    expect(spoken[2].rate).toBe(1.5);
    expect(window.localStorage.getItem('library-read-aloud-rate')).toBe('1.5');
  });

  it('stops on an error that is not a cancellation, and ignores one that is', () => {
    const { result } = setup();
    act(() => result.current.play());
    act(() => spoken[0].onerror?.({ error: 'interrupted' }));
    expect(result.current.status).toBe('playing');
    expect(result.current.failed).toBe(false);
    act(() => spoken[0].onerror?.({ error: 'synthesis-failed' }));
    expect(result.current.status).toBe('idle');
    expect(result.current.failed).toBe(true);

    // Trying again clears it.
    act(() => result.current.play());
    expect(result.current.failed).toBe(false);
  });

  it('does not read on into a different text, or after the reader goes away', () => {
    const { result, rerender, unmount } = setup();
    act(() => result.current.play());
    rerender({ text: 'A different chapter begins here.' });
    expect(result.current.status).toBe('idle');
    expect(synth.cancel).toHaveBeenCalled();

    act(() => result.current.play());
    const before = synth.cancel.mock.calls.length;
    unmount();
    expect(synth.cancel.mock.calls.length).toBeGreaterThan(before);
  });

  it('uses the voice that was chosen, lists voices of the document’s language first, and remembers the choice', () => {
    const voices = [
      { voiceURI: 'de', name: 'Anna', lang: 'de-DE' },
      { voiceURI: 'en', name: 'Zoe', lang: 'en-GB' },
    ];
    synth.getVoices.mockReturnValue(voices);
    const { result } = setup();
    expect(result.current.voices.map((v) => v.voiceURI)).toEqual(['en', 'de']);

    act(() => result.current.setVoiceUri('en'));
    expect(window.localStorage.getItem('library-read-aloud-voice')).toBe('en');
    act(() => result.current.play());
    expect(spoken[0].voice).toBe(voices[1]);
    expect(spoken[0].lang).toBe('en-GB');
  });
});
