import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CORE_RPC_METHODS } from '../rpcMethods';
import { createCoreWorkbenchClient } from './coreWorkbenchClient';

const mockCallCoreRpc = vi.fn();

vi.mock('../coreRpcClient', () => ({
  callCoreRpc: (...args: unknown[]) => mockCallCoreRpc(...args),
}));

const alert = (overrides = {}) => ({
  id: 'alert-1',
  alert_type: 'missed_checkin',
  severity: 'critical',
  related_type: 'task_instance',
  related_id: 'task-1',
  status: 'open',
  summary: 'Owner missed check-in.',
  created_at: '2026-06-01T00:00:00Z',
  ...overrides,
});

describe('coreWorkbenchClient', () => {
  beforeEach(() => {
    mockCallCoreRpc.mockReset();
  });

  it('lists Core alerts through the core RPC bridge with filters', async () => {
    mockCallCoreRpc.mockResolvedValueOnce({ result: [alert()], logs: ['listed'] });
    const client = createCoreWorkbenchClient({ timeoutMs: 12_000 });

    const alerts = await client.listAlerts({ status: 'open', severity: 'critical' });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.id).toBe('alert-1');
    expect(mockCallCoreRpc).toHaveBeenCalledWith({
      method: CORE_RPC_METHODS.youpetListAlerts,
      params: { status: 'open', severity: 'critical' },
      timeoutMs: 12_000,
    });
  });

  it('passes null status through so Rust can request all alert states', async () => {
    mockCallCoreRpc.mockResolvedValueOnce({ result: [], logs: [] });
    const client = createCoreWorkbenchClient();

    await client.listAlerts({ status: null });

    expect(mockCallCoreRpc).toHaveBeenCalledWith({
      method: CORE_RPC_METHODS.youpetListAlerts,
      params: { status: null },
      timeoutMs: undefined,
    });
  });

  it('acknowledges alerts through the core RPC bridge and forwards caller key', async () => {
    mockCallCoreRpc.mockResolvedValueOnce({
      result: alert({ status: 'acknowledged' }),
      logs: ['acknowledged'],
    });
    const client = createCoreWorkbenchClient();

    const updated = await client.ackAlert('alert-1', {
      note: 'Calling owner.',
      idempotencyKey: 'idem-ack-1',
    });

    expect(updated.status).toBe('acknowledged');
    expect(mockCallCoreRpc).toHaveBeenCalledWith({
      method: CORE_RPC_METHODS.youpetAckAlert,
      params: { alertId: 'alert-1', note: 'Calling owner.', idempotencyKey: 'idem-ack-1' },
      timeoutMs: undefined,
    });
  });

  it('resolves alerts through the core RPC bridge', async () => {
    mockCallCoreRpc.mockResolvedValueOnce(alert({ status: 'resolved' }));
    const client = createCoreWorkbenchClient();

    const updated = await client.resolveAlert('alert-1', {
      resolution: 'Owner confirmed completion.',
    });

    expect(updated.status).toBe('resolved');
    expect(mockCallCoreRpc).toHaveBeenCalledWith({
      method: CORE_RPC_METHODS.youpetResolveAlert,
      params: {
        alertId: 'alert-1',
        resolution: 'Owner confirmed completion.',
        idempotencyKey: undefined,
      },
      timeoutMs: undefined,
    });
  });

  it('propagates RPC errors to callers', async () => {
    mockCallCoreRpc.mockRejectedValueOnce(new Error('invalid_task_state'));
    const client = createCoreWorkbenchClient();

    await expect(client.ackAlert('alert-1', {})).rejects.toThrow('invalid_task_state');
  });
});
