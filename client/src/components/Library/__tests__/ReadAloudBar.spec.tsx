import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReadAloud } from '../useReadAloud';
import { mockClient } from 'test/libraryMocks';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('@librechat/client', () => ({ ...mockClient }));

import ReadAloudBar from '../ReadAloudBar';

const controls = (extra: Partial<ReadAloud> = {}): ReadAloud => ({
  supported: true,
  status: 'idle',
  failed: false,
  rate: 1,
  setRate: jest.fn(),
  voices: [],
  voiceUri: '',
  setVoiceUri: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  stop: jest.fn(),
  ...extra,
});

describe('ReadAloudBar', () => {
  it('offers to listen while nothing is being read', () => {
    const readAloud = controls();
    render(<ReadAloudBar readAloud={readAloud} />);
    fireEvent.click(screen.getByTestId('read-aloud-start'));
    expect(readAloud.play).toHaveBeenCalled();
    expect(screen.queryByTestId('read-aloud-bar')).not.toBeInTheDocument();
  });

  it('says so when the device could not speak, and not otherwise', () => {
    const { rerender } = render(<ReadAloudBar readAloud={controls()} />);
    expect(screen.queryByTestId('read-aloud-failed')).not.toBeInTheDocument();
    rerender(<ReadAloudBar readAloud={controls({ failed: true })} />);
    expect(screen.getByTestId('read-aloud-failed')).toHaveTextContent('com_library_listen_failed');
    expect(screen.getByTestId('read-aloud-start')).toBeInTheDocument();
  });

  it('pauses while playing and continues while paused, and can always be stopped', () => {
    const playing = controls({ status: 'playing' });
    const { rerender } = render(<ReadAloudBar readAloud={playing} />);
    expect(screen.getByLabelText('com_library_listen_pause')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('read-aloud-toggle'));
    expect(playing.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('read-aloud-stop'));
    expect(playing.stop).toHaveBeenCalled();

    const paused = controls({ status: 'paused' });
    rerender(<ReadAloudBar readAloud={paused} />);
    expect(screen.getByLabelText('com_library_listen_resume')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('read-aloud-toggle'));
    expect(paused.play).toHaveBeenCalled();
  });

  it('changes the speed, and the voice when the device has any', () => {
    const readAloud = controls({
      status: 'playing',
      voices: [{ voiceURI: 'v1', name: 'Zoe', lang: 'en-GB' } as SpeechSynthesisVoice],
    });
    render(<ReadAloudBar readAloud={readAloud} />);
    fireEvent.change(screen.getByTestId('read-aloud-rate'), { target: { value: '1.5' } });
    expect(readAloud.setRate).toHaveBeenCalledWith(1.5);
    fireEvent.change(screen.getByTestId('read-aloud-voice'), { target: { value: 'v1' } });
    expect(readAloud.setVoiceUri).toHaveBeenCalledWith('v1');
  });

  it('shows no voice choice when the device lists none', () => {
    render(<ReadAloudBar readAloud={controls({ status: 'playing' })} />);
    expect(screen.queryByTestId('read-aloud-voice')).not.toBeInTheDocument();
  });
});
