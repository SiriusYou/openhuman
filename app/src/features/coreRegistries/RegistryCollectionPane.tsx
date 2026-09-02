import type { RegistryObservationState } from './types';

export interface RegistryCollectionPaneItem {
  id: string;
  title: string;
  subtitle: string;
  meta?: string[];
  statusLabel?: string;
  fingerprintLabel?: string;
  onSelect: () => void;
}

interface RegistryCollectionPaneProps {
  title: string;
  description: string;
  observation: RegistryObservationState;
  items: RegistryCollectionPaneItem[];
  loadMoreLabel?: string;
  onLoadMore?: () => void;
  onRetry?: () => void;
  hasMore?: boolean;
}

function summarizeObservation(observation: RegistryObservationState) {
  switch (observation.kind) {
    case 'not_loaded':
      return { label: 'Idle', tone: 'stone', body: 'Waiting for the first observation.' };
    case 'loading':
      return { label: 'Loading', tone: 'sky', body: 'Refreshing the exact records from Core.' };
    case 'empty':
      return { label: 'Observed', tone: 'stone', body: 'Observed with no records returned.' };
    case 'loaded':
      return { label: 'Observed', tone: 'sage', body: `Observed at ${observation.observedAt}.` };
    case 'stale':
      return {
        label: 'Stale',
        tone: 'amber',
        body: `Observed at ${observation.observedAt}; the latest refresh kept the last good data.`,
      };
    case 'blocked':
      return {
        label: 'Blocked',
        tone: 'coral',
        body: 'Core rejected this collection for inspection.',
      };
  }
}

type ObservationTone = ReturnType<typeof summarizeObservation>['tone'];

function badgeClass(tone: ObservationTone) {
  switch (tone) {
    case 'sage':
      return 'border-sage-200 bg-sage-50 text-sage-700';
    case 'amber':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'coral':
      return 'border-coral-200 bg-coral-50 text-coral-700';
    case 'sky':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    default:
      return 'border-stone-200 bg-stone-50 text-stone-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200';
  }
}

export default function RegistryCollectionPane({
  title,
  description,
  observation,
  items,
  loadMoreLabel,
  onLoadMore,
  onRetry,
  hasMore = false,
}: RegistryCollectionPaneProps) {
  const summary = summarizeObservation(observation);

  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-soft dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900 dark:text-neutral-100">{title}</h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-neutral-400">{description}</p>
        </div>

        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${badgeClass(summary.tone)}`}>
          {summary.label}
        </span>
      </div>

      <p className="mt-3 text-xs text-stone-500 dark:text-neutral-400">{summary.body}</p>

      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-5 text-sm text-stone-500 dark:border-neutral-800 dark:text-neutral-400">
            No exact records available in this collection yet.
          </div>
        ) : (
          items.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={item.onSelect}
              className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-left transition hover:border-primary-300 hover:bg-stone-50 dark:border-neutral-800 dark:hover:border-primary-500/50 dark:hover:bg-neutral-800/80">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-stone-900 dark:text-neutral-100">
                    {item.title}
                  </div>
                  <div className="mt-1 text-xs text-stone-500 dark:text-neutral-400">
                    {item.subtitle}
                  </div>
                  {item.meta && item.meta.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.meta.map(value => (
                        <span
                          key={value}
                          className="inline-flex items-center rounded-full bg-stone-100 px-2 py-1 text-[11px] text-stone-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-2">
                  {item.statusLabel ? (
                    <span className="inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] font-medium text-stone-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {item.statusLabel}
                    </span>
                  ) : null}
                  {item.fingerprintLabel ? (
                    <span className="font-mono text-[11px] text-stone-500 dark:text-neutral-400">
                      {item.fingerprintLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
            Retry
          </button>
        ) : null}

        {hasMore && onLoadMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex items-center rounded-xl bg-primary-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-600">
            {loadMoreLabel ?? 'Load more'}
          </button>
        ) : null}
      </div>
    </section>
  );
}
