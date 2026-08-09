import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../lib/i18n/I18nContext';
import {
  type CoreActionRequestLifecycleEnvelope,
  createCoreActionRequestClient,
  extractYoupetErrorCode,
} from '../services/api/coreActionRequestClient';

type DecisionAction = 'approve' | 'reject';
type PendingDecisions = Record<string, DecisionAction>;

const IDEMPOTENCY_STORAGE_KEY = 'openhuman.youpet.action_request.idempotency.v1';
const DEFAULT_FILTER = 'pending';

export const actionRequestIdempotencyStorageKey = IDEMPOTENCY_STORAGE_KEY;

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

function makeIdempotencyStorageId(actionRequestId: string, action: DecisionAction) {
  return `${action}:${actionRequestId}`;
}

function generateIdempotencyKey(actionRequestId: string, action: DecisionAction) {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `youpet-action-request:${action}:${actionRequestId}:${random}`;
}

function getOrCreateIdempotencyKey(actionRequestId: string, action: DecisionAction) {
  const store = readIdempotencyStore();
  const id = makeIdempotencyStorageId(actionRequestId, action);
  if (store[id]) return store[id];
  const key = generateIdempotencyKey(actionRequestId, action);
  store[id] = key;
  writeIdempotencyStore(store);
  return key;
}

function clearIdempotencyKey(actionRequestId: string, action: DecisionAction) {
  const store = readIdempotencyStore();
  delete store[makeIdempotencyStorageId(actionRequestId, action)];
  writeIdempotencyStore(store);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function formatDate(value: string | null | undefined, noneLabel: string) {
  if (!value) return noneLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function isPending(item: CoreActionRequestLifecycleEnvelope) {
  return item.approval_state === 'pending';
}

function isTerminalApproval(item: CoreActionRequestLifecycleEnvelope) {
  return item.approval_state === 'approved' || item.approval_state === 'rejected';
}

export default function ActionRequestInbox() {
  const { t } = useT();
  const client = useMemo(() => createCoreActionRequestClient(), []);
  const [items, setItems] = useState<CoreActionRequestLifecycleEnvelope[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingDecisions>({});
  const [filter, setFilter] = useState<'pending' | 'all'>(DEFAULT_FILTER);
  const inFlightRef = useRef<Set<string>>(new Set());

  const selected = useMemo(
    () => items.find(item => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const listed = await client.list({
          approvalState: filter === 'pending' ? 'pending' : undefined,
          limit: 50,
        });
        setItems(listed);
        setSelectedId(current => {
          if (current && listed.some(item => item.id === current)) return current;
          return listed[0]?.id ?? null;
        });
      } catch (err) {
        const code = extractYoupetErrorCode(err);
        setError(
          code
            ? t('actionRequest.errorWithCode', 'Action request failed ({code}).').replace(
                '{code}',
                code
              )
            : t(
                'actionRequest.requestFailed',
                'Action request failed. Check Core configuration and try again.'
              )
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client, filter, t]
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const refreshOne = useCallback(
    async (actionRequestId: string) => {
      const fresh = await client.get(actionRequestId);
      setItems(current => {
        const exists = current.some(item => item.id === actionRequestId);
        if (!exists) return [fresh, ...current];
        return current.map(item => (item.id === actionRequestId ? fresh : item));
      });
      return fresh;
    },
    [client]
  );

  const submitDecision = useCallback(
    async (item: CoreActionRequestLifecycleEnvelope, action: DecisionAction) => {
      const flightKey = `${action}:${item.id}`;
      if (inFlightRef.current.has(flightKey) || pending[item.id]) return;
      if (!isPending(item)) {
        setError(
          t('actionRequest.terminalReadOnly', 'This request is no longer pending and is read-only.')
        );
        return;
      }
      const reason = (reasonById[item.id] ?? '').trim();
      if (!reason) {
        setError(t('actionRequest.reasonRequired', 'A non-empty operator reason is required.'));
        return;
      }

      inFlightRef.current.add(flightKey);
      setPending(current => ({ ...current, [item.id]: action }));
      setError(null);
      const idempotencyKey = getOrCreateIdempotencyKey(item.id, action);

      try {
        const params = {
          reason,
          expectedRowVersion: item.row_version,
          idempotencyKey,
        };
        const updated =
          action === 'approve'
            ? await client.approve(item.id, params)
            : await client.reject(item.id, params);
        clearIdempotencyKey(item.id, action);
        setItems(current => current.map(row => (row.id === item.id ? updated : row)));
        setReasonById(current => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      } catch (err) {
        const code = extractYoupetErrorCode(err);
        if (code === 'concurrency_conflict' || code === 'idempotency_conflict') {
          try {
            const fresh = await refreshOne(item.id);
            setError(
              t(
                'actionRequest.conflictRefresh',
                'State changed ({code}). Reloaded from Core: {state} v{version}.'
              )
                .replace('{code}', code)
                .replace('{state}', fresh.approval_state)
                .replace('{version}', String(fresh.row_version))
            );
            // Keep the same-intent key only while the row is still pending so a
            // true network retry can reuse it. Clear both keys once terminal.
            if (isTerminalApproval(fresh)) {
              clearIdempotencyKey(item.id, 'approve');
              clearIdempotencyKey(item.id, 'reject');
            }
          } catch {
            setError(
              t(
                'actionRequest.conflictRefreshFailed',
                'State conflict ({code}), and refresh from Core failed.'
              ).replace('{code}', code ?? 'conflict')
            );
          }
        } else {
          setError(
            code
              ? t('actionRequest.errorWithCode', 'Action request failed ({code}).').replace(
                  '{code}',
                  code
                )
              : t(
                  'actionRequest.requestFailed',
                  'Action request failed. Check Core configuration and try again.'
                )
          );
        }
      } finally {
        inFlightRef.current.delete(flightKey);
        setPending(current => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      }
    },
    [client, pending, reasonById, refreshOne, t]
  );

  const doc = asRecord(selected?.action_request);
  const proposer = asRecord(doc?.proposer);
  const target = asRecord(doc?.target);
  const policy = asRecord(doc?.policy);
  const payload = asRecord(doc?.payload);
  const reasons = Array.isArray(policy?.reasons)
    ? policy.reasons.filter((r): r is string => typeof r === 'string')
    : [];
  const obligations = Array.isArray(policy?.obligations)
    ? policy.obligations.filter((r): r is string => typeof r === 'string')
    : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6" data-testid="action-request-inbox">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            {t('actionRequest.eyebrow')}
          </p>
          <h1 className="text-2xl font-semibold text-zinc-100">{t('actionRequest.title')}</h1>
          <p className="text-sm text-zinc-400">{t('actionRequest.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-400" htmlFor="ar-filter">
            {t('actionRequest.filterLabel')}
          </label>
          <select
            id="ar-filter"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
            value={filter}
            onChange={event => setFilter(event.target.value as 'pending' | 'all')}
            data-testid="action-request-filter"
          >
            <option value="pending">{t('actionRequest.filter.pending')}</option>
            <option value="all">{t('actionRequest.filter.all')}</option>
          </select>
          <button
            type="button"
            className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            onClick={() => void load('refresh')}
            disabled={loading || refreshing}
            data-testid="action-request-refresh"
          >
            {refreshing ? t('actionRequest.refreshing') : t('actionRequest.refresh')}
          </button>
        </div>
      </header>

      {error ? (
        <div
          className="rounded border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-100"
          data-testid="action-request-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-400" data-testid="action-request-loading">
          {t('actionRequest.loading')}
        </p>
      ) : null}

      {!loading && items.length === 0 ? (
        <p className="text-sm text-zinc-400" data-testid="action-request-empty">
          {t('actionRequest.empty')}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ul className="flex flex-col gap-2" data-testid="action-request-list">
          {items.map(item => {
            const active = item.id === selectedId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${
                    active
                      ? 'border-sky-600 bg-sky-950/40 text-sky-50'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-200 hover:border-zinc-600'
                  }`}
                  onClick={() => setSelectedId(item.id)}
                  data-testid={`action-request-row-${item.id}`}
                >
                  <div className="font-medium">
                    {readString(asRecord(item.action_request)?.action_type) ?? item.id}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {item.approval_state} · {item.execution_state} · v{item.row_version}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <section
          className="rounded border border-zinc-800 bg-zinc-950/50 p-4"
          data-testid="action-request-detail"
        >
          {!selected ? (
            <p className="text-sm text-zinc-400">{t('actionRequest.selectPrompt')}</p>
          ) : (
            <div className="flex flex-col gap-3 text-sm text-zinc-200">
              <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
                <span data-testid="action-request-detail-id">{selected.id}</span>
                <span>
                  {t('actionRequest.rowVersion')}: {selected.row_version}
                </span>
                <span>
                  {t('actionRequest.approval')}: {selected.approval_state}
                </span>
                <span>
                  {t('actionRequest.execution')}: {selected.execution_state}
                </span>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-zinc-500">{t('actionRequest.actionType')}</dt>
                <dd>{readString(doc?.action_type) ?? t('actionRequest.none')}</dd>
                <dt className="text-zinc-500">{t('actionRequest.risk')}</dt>
                <dd>{readString(doc?.risk) ?? t('actionRequest.none')}</dd>
                <dt className="text-zinc-500">{t('actionRequest.proposer')}</dt>
                <dd>
                  {readString(proposer?.type) ?? t('actionRequest.none')}
                  {readString(proposer?.id) ? ` · ${readString(proposer?.id)}` : ''}
                </dd>
                <dt className="text-zinc-500">{t('actionRequest.target')}</dt>
                <dd>
                  {readString(target?.type) ?? t('actionRequest.none')}
                  {readString(target?.id) ? ` · ${readString(target?.id)}` : ''}
                </dd>
                <dt className="text-zinc-500">{t('actionRequest.policyOutcome')}</dt>
                <dd>{selected.policy_outcome}</dd>
                <dt className="text-zinc-500">{t('actionRequest.correlation')}</dt>
                <dd>{selected.correlation_id}</dd>
                <dt className="text-zinc-500">{t('actionRequest.updated')}</dt>
                <dd>{formatDate(selected.updated_at, t('actionRequest.none'))}</dd>
              </dl>

              {reasons.length > 0 ? (
                <div>
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                    {t('actionRequest.reasons')}
                  </h3>
                  <ul className="list-disc pl-5 text-zinc-300">
                    {reasons.map(reason => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {obligations.length > 0 ? (
                <div>
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                    {t('actionRequest.obligations')}
                  </h3>
                  <ul className="list-disc pl-5 text-zinc-300">
                    {obligations.map(item => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {payload ? (
                <div>
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                    {t('actionRequest.payload')}
                  </h3>
                  <pre
                    className="max-h-48 overflow-auto rounded bg-zinc-900 p-2 text-xs text-zinc-300"
                    data-testid="action-request-payload"
                  >
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                </div>
              ) : null}

              {isPending(selected) ? (
                <div className="mt-2 flex flex-col gap-2 border-t border-zinc-800 pt-3">
                  <label className="text-xs text-zinc-400" htmlFor="ar-reason">
                    {t('actionRequest.reasonLabel')}
                  </label>
                  <textarea
                    id="ar-reason"
                    className="min-h-[72px] rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
                    value={reasonById[selected.id] ?? ''}
                    onChange={event =>
                      setReasonById(current => ({
                        ...current,
                        [selected.id]: event.target.value,
                      }))
                    }
                    data-testid="action-request-reason"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
                      disabled={Boolean(pending[selected.id])}
                      onClick={() => void submitDecision(selected, 'approve')}
                      data-testid="action-request-approve"
                    >
                      {pending[selected.id] === 'approve'
                        ? t('actionRequest.approving')
                        : t('actionRequest.approve')}
                    </button>
                    <button
                      type="button"
                      className="rounded bg-rose-800 px-3 py-1.5 text-sm text-white hover:bg-rose-700 disabled:opacity-50"
                      disabled={Boolean(pending[selected.id])}
                      onClick={() => void submitDecision(selected, 'reject')}
                      data-testid="action-request-reject"
                    >
                      {pending[selected.id] === 'reject'
                        ? t('actionRequest.rejecting')
                        : t('actionRequest.reject')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-500" data-testid="action-request-terminal">
                  {t('actionRequest.terminalReadOnly')}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
