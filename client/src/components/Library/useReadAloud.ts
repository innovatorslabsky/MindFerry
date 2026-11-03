import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { clearSpeaking, offsetAtTop, paintSpeaking } from '~/utils/libraryAnchors';
import { sentenceAt, splitSentences } from './sentences';

export type ReadAloudStatus = 'idle' | 'playing' | 'paused';

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const RATE_KEY = 'library-read-aloud-rate';
const VOICE_KEY = 'library-read-aloud-voice';

/** Whether this browser can read text aloud. */
export function canSpeak(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof globalThis.SpeechSynthesisUtterance === 'function'
  );
}

function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembering a choice is only a convenience lost.
  }
}

type Options = {
  /** The text the reader shows, and which the offsets mean. */
  text: string;
  /** Its language (a code such as `en`), to prefer voices of it. */
  lang?: string;
  content: RefObject<HTMLElement>;
  scroller: RefObject<HTMLElement>;
};

export type ReadAloud = {
  supported: boolean;
  status: ReadAloudStatus;
  /** The device could not speak the last time it was tried, for instance with no voice installed. */
  failed: boolean;
  rate: number;
  setRate: (rate: number) => void;
  voices: SpeechSynthesisVoice[];
  voiceUri: string;
  setVoiceUri: (uri: string) => void;
  /** Begins at the sentence at the top of the screen, or goes on from a pause. */
  play: () => void;
  pause: () => void;
  stop: () => void;
};

/**
 * Reads the text aloud with the browser's own voices, a sentence at a time, drawing the sentence being
 * read and keeping it on screen. Nothing is sent anywhere; the voices are the device's.
 */
export function useReadAloud({ text, lang, content, scroller }: Options): ReadAloud {
  const supported = canSpeak();
  const sentences = useMemo(
    () => (supported ? splitSentences(text, lang) : []),
    [supported, text, lang],
  );
  const [status, setStatus] = useState<ReadAloudStatus>('idle');
  const [failed, setFailed] = useState(false);
  const [rate, setRateState] = useState(() => {
    const saved = Number(remembered(RATE_KEY));
    return RATES.includes(saved as (typeof RATES)[number]) ? saved : 1;
  });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUriState] = useState(() => remembered(VOICE_KEY) ?? '');

  // Which run of sentences a callback belongs to, so an utterance that was cancelled cannot go on to the next.
  const run = useRef(0);
  const index = useRef(0);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const latest = useRef({ sentences, text, rate, voiceUri, voices, lang });
  latest.current = { sentences, text, rate, voiceUri, voices, lang };

  useEffect(() => {
    if (!supported) {
      return;
    }
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, [supported]);

  const halt = useCallback(() => {
    run.current += 1;
    utterance.current = null;
    if (canSpeak()) {
      window.speechSynthesis.cancel();
    }
    clearSpeaking();
  }, []);

  const speak = useCallback(
    (i: number, id: number) => {
      const {
        sentences: list,
        text: full,
        rate: speed,
        voiceUri: uri,
        voices: all,
        lang: code,
      } = latest.current;
      const sentence = list[i];
      if (!sentence) {
        halt();
        setStatus('idle');
        return;
      }
      index.current = i;
      const range = content.current
        ? paintSpeaking(content.current, sentence.start, sentence.end)
        : null;
      const box = scroller.current;
      if (range && box) {
        const at = range.getBoundingClientRect();
        const view = box.getBoundingClientRect();
        if (at.top < view.top + 24 || at.bottom > view.bottom - 24) {
          box.scrollTop += at.top - view.top - view.height / 3;
        }
      }
      const next = new SpeechSynthesisUtterance(full.slice(sentence.start, sentence.end));
      next.rate = speed;
      const voice = all.find((candidate) => candidate.voiceURI === uri);
      if (voice) {
        next.voice = voice;
        next.lang = voice.lang;
      } else if (code) {
        next.lang = code;
      }
      next.onend = () => {
        if (run.current === id) {
          speak(i + 1, id);
        }
      };
      next.onerror = (event) => {
        if (run.current === id && event.error !== 'interrupted' && event.error !== 'canceled') {
          halt();
          setStatus('idle');
          setFailed(true);
        }
      };
      // Held, so the browser cannot collect it before it finishes and never say it ended.
      utterance.current = next;
      window.speechSynthesis.speak(next);
    },
    [content, scroller, halt],
  );

  const start = useCallback(
    (from: number) => {
      halt();
      setFailed(false);
      setStatus('playing');
      speak(from, run.current);
    },
    [halt, speak],
  );

  const play = useCallback(() => {
    if (!canSpeak()) {
      return;
    }
    if (status === 'paused') {
      window.speechSynthesis.resume();
      setStatus('playing');
      return;
    }
    const root = content.current;
    const box = scroller.current;
    const top = root && box ? offsetAtTop(root, box.getBoundingClientRect().top) : 0;
    start(sentenceAt(latest.current.sentences, top));
  }, [status, content, scroller, start]);

  const pause = useCallback(() => {
    if (canSpeak() && status === 'playing') {
      window.speechSynthesis.pause();
      setStatus('paused');
    }
  }, [status]);

  const stop = useCallback(() => {
    halt();
    setStatus('idle');
  }, [halt]);

  const setRate = useCallback(
    (next: number) => {
      remember(RATE_KEY, String(next));
      latest.current.rate = next;
      setRateState(next);
      // The sentence being read goes on at the new speed.
      if (status !== 'idle') {
        start(index.current);
      }
    },
    [status, start],
  );

  const setVoiceUri = useCallback(
    (uri: string) => {
      remember(VOICE_KEY, uri);
      latest.current.voiceUri = uri;
      setVoiceUriState(uri);
      if (status !== 'idle') {
        start(index.current);
      }
    },
    [status, start],
  );

  // A different text (another chapter, another document) is not read on from the last one.
  useEffect(() => {
    return () => {
      halt();
      setStatus('idle');
    };
  }, [text, halt]);

  // Voices of the document's language first, so the first one offered is a sensible choice.
  const ordered = useMemo(() => {
    const prefix = (lang ?? '').toLowerCase().split('-')[0];
    const rank = (voice: SpeechSynthesisVoice) =>
      prefix && voice.lang.toLowerCase().startsWith(prefix) ? 0 : 1;
    return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [voices, lang]);

  return {
    supported,
    status,
    failed,
    rate,
    setRate,
    voices: ordered,
    voiceUri,
    setVoiceUri,
    play,
    pause,
    stop,
  };
}
