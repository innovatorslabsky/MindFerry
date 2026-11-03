import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { durationLabel, sessionCountLabel } from './readingTime';
import { useLibraryStatsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const RANGES = [7, 30, 90] as const;

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border-light rounded-xl border px-4 py-3" data-testid="library-stat">
      <div className="text-text-secondary text-xs">{label}</div>
      <div className="text-text-primary mt-1 text-xl font-semibold">{children}</div>
    </div>
  );
}

/** What the person has read lately, from the sessions the reader kept and the ones they logged. */
export default function LibraryStatsView() {
  const localize = useLocalize();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const { data, isLoading, isError } = useLibraryStatsQuery(days);
  const stats = data?.stats;
  const busiest = Math.max(1, ...(stats?.days.map((day) => day.seconds) ?? [0]));

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6"
      data-testid="library-stats"
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link to="/library" aria-label={localize('com_library_back')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <h1 className="text-text-primary text-xl font-semibold">{localize('com_library_stats')}</h1>
      </div>

      <div role="group" aria-label={localize('com_library_stats_range')} className="flex gap-1.5">
        {RANGES.map((range) => (
          <Button
            key={range}
            type="button"
            size="sm"
            variant="outline-toggle"
            aria-pressed={days === range}
            onClick={() => setDays(range)}
          >
            {localize('com_library_stats_days', { 0: range })}
          </Button>
        ))}
      </div>

      {isLoading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {isError && (
        <p className="text-text-secondary" role="alert">
          {localize('com_library_stats_error')}
        </p>
      )}

      {stats && stats.totals.sessions === 0 && stats.totals.finished === 0 && (
        <p className="text-text-secondary text-sm" data-testid="library-stats-empty">
          {localize('com_library_stats_empty')}
        </p>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card label={localize('com_library_stats_time')}>
              {durationLabel(stats.totals.seconds, localize)}
            </Card>
            <Card label={localize('com_library_stats_words')}>
              {stats.totals.words.toLocaleString()}
            </Card>
            <Card label={localize('com_library_stats_sessions')}>
              {sessionCountLabel(stats.totals.sessions, localize)}
            </Card>
            <Card label={localize('com_library_stats_documents')}>{stats.totals.documents}</Card>
            <Card label={localize('com_library_stats_finished')}>{stats.totals.finished}</Card>
            <Card label={localize('com_library_stats_longest')}>
              {durationLabel(stats.longestSessionSeconds, localize)}
            </Card>
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="text-text-primary text-sm font-semibold">
              {localize('com_library_stats_per_day')}
            </h2>
            <ol
              className="flex h-32 items-end gap-px"
              aria-label={localize('com_library_stats_per_day')}
              data-testid="library-stats-chart"
            >
              {stats.days.map((day) => (
                <li
                  key={day.date}
                  className="flex h-full min-w-0 flex-1 items-end"
                  title={`${day.date}: ${durationLabel(day.seconds, localize)}`}
                  data-testid="library-stats-day"
                >
                  <span className="sr-only">{`${day.date}: ${durationLabel(day.seconds, localize)}`}</span>
                  <div
                    className={cn(
                      'bg-surface-submit w-full rounded-t',
                      day.seconds === 0 && 'opacity-25',
                    )}
                    style={{
                      height:
                        day.seconds === 0 ? 2 : `${Math.max(4, (day.seconds / busiest) * 100)}%`,
                    }}
                    aria-hidden="true"
                  />
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
