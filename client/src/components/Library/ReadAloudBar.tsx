import { Button } from '@librechat/client';
import { Pause, Play, Square, Volume2 } from 'lucide-react';
import type { ReadAloud } from './useReadAloud';
import { RATES } from './useReadAloud';
import { useLocalize } from '~/hooks';

/** The controls for reading the text aloud: start from where you are, pause, stop, speed and voice. */
export default function ReadAloudBar({ readAloud }: { readAloud: ReadAloud }) {
  const localize = useLocalize();
  const { status, failed, rate, setRate, voices, voiceUri, setVoiceUri, play, pause, stop } =
    readAloud;

  if (status === 'idle') {
    return (
      <>
        {failed && (
          <span
            className="text-text-secondary text-xs"
            role="status"
            data-testid="read-aloud-failed"
          >
            {localize('com_library_listen_failed')}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={play}
          data-testid="read-aloud-start"
        >
          <Volume2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {localize('com_library_listen')}
        </Button>
      </>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5" data-testid="read-aloud-bar">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label={localize(
          status === 'playing' ? 'com_library_listen_pause' : 'com_library_listen_resume',
        )}
        onClick={status === 'playing' ? pause : play}
        data-testid="read-aloud-toggle"
      >
        {status === 'playing' ? (
          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label={localize('com_library_listen_stop')}
        onClick={stop}
        data-testid="read-aloud-stop"
      >
        <Square className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <select
        value={rate}
        onChange={(event) => setRate(Number(event.target.value))}
        aria-label={localize('com_library_listen_speed')}
        className="border-border-medium bg-surface-primary text-text-secondary rounded border px-1 py-0.5 text-xs"
        data-testid="read-aloud-rate"
      >
        {RATES.map((value) => (
          <option key={value} value={value}>
            {`${value}x`}
          </option>
        ))}
      </select>
      {voices.length > 0 && (
        <select
          value={voiceUri}
          onChange={(event) => setVoiceUri(event.target.value)}
          aria-label={localize('com_library_listen_voice')}
          className="border-border-medium bg-surface-primary text-text-secondary max-w-32 rounded border px-1 py-0.5 text-xs"
          data-testid="read-aloud-voice"
        >
          <option value="">{localize('com_library_listen_voice_default')}</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
