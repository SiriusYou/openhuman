import { useCallback, useEffect, useMemo, useState } from 'react';

import { useT } from '../lib/i18n/I18nContext';
import {
  type CoreAlertSeverity,
  type CoreAlertStatus,
  type CoreWorkbenchAlert,
  createCoreWorkbenchClient,
} from '../services/api/coreWorkbenchClient';

type StatusFilter = CoreAlertStatus | 'all';
type SeverityFilter = CoreAlertSeverity | 'all';
type AlertAction = 'ack' | 'resolve';
type PendingActions = Record<string, AlertAction>;

const STATUS_FILTERS: StatusFilter[] = ['open', 'acknowledged', 'resolved', 'dismissed', 'all'];
const SEVERITY_FILTERS: SeverityFilter[] = ['all', 'low', 'medium', 'high', 'critical'];
const IDEMPOTENCY_STORAGE_KEY = 'openhuman.youpet.workbench.idempotency.v1';
const STATUS_LABEL_KEYS: Record<StatusFilter, string> = {
  open: 'workbench.status.open',
  acknowledged: 'workbench.status.acknowledged',
  resolved: 'workbench.status.resolved',
  dismissed: 'workbench.status.dismissed',
  all: 'workbench.status.all',
};
const SEVERITY_LABEL_KEYS: Record<SeverityFilter, string> = {
  all: 'workbench.severity.all',
  low: 'workbench.severity.low',
  medium: 'workbench.severity.medium',
  high: 'workbench.severity.high',
  critical: 'workbench.severity.critical',
};

export const workbenchIdempotencyStorageKey = IDEMPOTENCY_STORAGE_KEY;

function readIdempotencyStore(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => {
        const [key, value] = entry;
        return typeof key === 'string' && typeof value === 'string' && value.trim().length > 0;
      })
    );
  } catch {
    return {};
  }
}

function writeIdempotencyStore(store: Record<string, string>) {
  window.localStorage.setItem(IDEMPOTENCY_STORAGE_KEY, JSON.stringify(store));
}

function makeIdempotencyStorageId(alertId: string, action: AlertAction) {
  return `${action}:${alertId}`;
}

function generateIdempotencyKey(alertId: string, action: AlertAction) {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `youpet-workbench:${action}:${alertId}:${random}`;
}

function getOrCreateIdempotencyKey(alertId: string, action: AlertAction) {
  const store = readIdempotencyStore();
  const id = makeIdempotencyStorageId(alertId, action);
  if (store[id]) return store[id];
  const key = generateIdempotencyKey(alertId, action);
  store[id] = key;
  writeIdempotencyStore(store);
  return key;
}

function clearIdempotencyKey(alertId: string, action: AlertAction) {
  const store = readIdempotencyStore();
  delete store[makeIdempotencyStorageId(alertId, action)];
  writeIdempotencyStore(store);
}

function formatDate(value: string | null | undefined, noneLabel: string) {
  if (!value) return noneLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const Workbench = () => {
  const { t } = useT();
  const client = useMemo(() => createCoreWorkbenchClient({ timeoutMs: 15_000 }), []);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [alerts, setAlerts] = useState<CoreWorkbenchAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingActions>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const loadAlerts = useCallback(
    async (mode: 'initial' | 'refresh' = 'refresh') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const next = await client.listAlerts({
          status: status === 'all' ? null : status,
          severity: severity === 'all' ? undefined : severity,
        });
        setAlerts(next);
      } catch {
        setError(t('workbench.requestFailed'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client, severity, status, t]
  );

  useEffect(() => {
    void loadAlerts('initial');
  }, [loadAlerts]);

  const runAction = async (alert: CoreWorkbenchAlert, action: AlertAction) => {
    const idempotencyKey = getOrCreateIdempotencyKey(alert.id, action);
    setPendingActions(current => ({ ...current, [alert.id]: action }));
    setActionError(null);
    try {
      const updated =
        action === 'ack'
          ? await client.ackAlert(alert.id, {
              note: notes[alert.id]?.trim() || undefined,
              idempotencyKey,
            })
          : await client.resolveAlert(alert.id, {
              resolution: resolutions[alert.id]?.trim() || undefined,
              idempotencyKey,
            });
      clearIdempotencyKey(alert.id, action);
      setAlerts(current => current.map(item => (item.id === updated.id ? updated : item)));
      await loadAlerts('refresh');
    } catch {
      setActionError(t('workbench.requestFailed'));
    } finally {
      setPendingActions(current => {
        const { [alert.id]: _finished, ...rest } = current;
        return rest;
      });
    }
  };

  const isAlertPending = (alertId: string) => Boolean(pendingActions[alertId]);
  const isActionPending = (alertId: string, action: AlertAction) =>
    pendingActions[alertId] === action;

  return (
    <div className="min-h-full bg-stone-50 dark:bg-neutral-950 text-stone-900 dark:text-neutral-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
        <header className="flex flex-col gap-3 border-b border-stone-200 pb-4 dark:border-neutral-800 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-400">
              {t('workbench.eyebrow')}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{t('workbench.title')}</h1>
          </div>
          <button
            type="button"
            onClick={() => void loadAlerts('refresh')}
            disabled={refreshing}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900">
            {refreshing ? t('workbench.refreshing') : t('workbench.refresh')}
          </button>
        </header>

        <section className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700 dark:text-neutral-200">
            {t('workbench.status')}
            <select
              value={status}
              onChange={event => setStatus(event.target.value as StatusFilter)}
              className="min-h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              aria-label={t('workbench.statusFilterLabel')}>
              {STATUS_FILTERS.map(option => (
                <option key={option} value={option}>
                  {t(STATUS_LABEL_KEYS[option])}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700 dark:text-neutral-200">
            {t('workbench.severity')}
            <select
              value={severity}
              onChange={event => setSeverity(event.target.value as SeverityFilter)}
              className="min-h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              aria-label={t('workbench.severityFilterLabel')}>
              {SEVERITY_FILTERS.map(option => (
                <option key={option} value={option}>
                  {t(SEVERITY_LABEL_KEYS[option])}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {t('workbench.contextUnavailable')}
        </section>

        {error && (
          <div className="rounded-lg border border-coral-200 bg-coral-50 p-3 text-sm text-coral-700 dark:border-coral-500/30 dark:bg-coral-500/10 dark:text-coral-200">
            {error}
          </div>
        )}
        {actionError && (
          <div className="rounded-lg border border-coral-200 bg-coral-50 p-3 text-sm text-coral-700 dark:border-coral-500/30 dark:bg-coral-500/10 dark:text-coral-200">
            {actionError}
          </div>
        )}

        <section className="rounded-lg border border-stone-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          {loading ? (
            <div className="p-6 text-sm text-stone-500 dark:text-neutral-400">
              {t('workbench.loading')}
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-6 text-sm text-stone-500 dark:text-neutral-400">
              {t('workbench.empty')}
            </div>
          ) : (
            <div className="divide-y divide-stone-200 dark:divide-neutral-800">
              {alerts.map(alert => (
                <article key={alert.id} className="grid gap-4 p-4 lg:grid-cols-[1fr_18rem]">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold uppercase text-stone-700 dark:bg-neutral-800 dark:text-neutral-200">
                        {alert.severity}
                      </span>
                      <span className="rounded-md bg-primary-50 px-2 py-1 text-xs font-semibold uppercase text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                        {alert.status}
                      </span>
                      <span className="text-xs text-stone-500 dark:text-neutral-400">
                        {alert.alert_type}
                      </span>
                    </div>
                    <h2 className="text-base font-semibold">
                      {alert.summary || t('workbench.noSummary')}
                    </h2>
                    <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm md:grid-cols-2">
                      <div>
                        <dt className="text-xs uppercase text-stone-400">
                          {t('workbench.related')}
                        </dt>
                        <dd className="break-all text-stone-700 dark:text-neutral-200">
                          {alert.related_type} / {alert.related_id}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-stone-400">
                          {t('workbench.created')}
                        </dt>
                        <dd>{formatDate(alert.created_at, t('workbench.none'))}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-stone-400">
                          {t('workbench.acknowledged')}
                        </dt>
                        <dd>{formatDate(alert.acknowledged_at, t('workbench.none'))}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase text-stone-400">
                          {t('workbench.resolved')}
                        </dt>
                        <dd>{formatDate(alert.resolved_at, t('workbench.none'))}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1 text-sm font-medium text-stone-700 dark:text-neutral-200">
                      {t('workbench.ackNote')}
                      <input
                        value={notes[alert.id] ?? ''}
                        onChange={event =>
                          setNotes(current => ({ ...current, [alert.id]: event.target.value }))
                        }
                        className="min-h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                        aria-label={t('workbench.ackNoteFor').replace('{alertId}', alert.id)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void runAction(alert, 'ack')}
                      disabled={isAlertPending(alert.id)}
                      className="min-h-10 rounded-lg bg-primary-600 px-3 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60">
                      {isActionPending(alert.id, 'ack')
                        ? t('workbench.acknowledging')
                        : t('workbench.acknowledge')}
                    </button>

                    <label className="flex flex-col gap-1 text-sm font-medium text-stone-700 dark:text-neutral-200">
                      {t('workbench.resolution')}
                      <input
                        value={resolutions[alert.id] ?? ''}
                        onChange={event =>
                          setResolutions(current => ({
                            ...current,
                            [alert.id]: event.target.value,
                          }))
                        }
                        className="min-h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                        aria-label={t('workbench.resolutionFor').replace('{alertId}', alert.id)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void runAction(alert, 'resolve')}
                      disabled={isAlertPending(alert.id)}
                      className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800">
                      {isActionPending(alert.id, 'resolve')
                        ? t('workbench.resolving')
                        : t('workbench.resolve')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default Workbench;
