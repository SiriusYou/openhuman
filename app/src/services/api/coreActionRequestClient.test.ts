import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CORE_RPC_METHODS } from '../rpcMethods';
import {
  createCoreActionRequestClient,
  extractYoupetErrorCode,
} from './coreActionRequestClient';

const callCoreRpc = vi.hoisted(() => vi.fn());

vi.mock('../coreRpcClient', () => ({
  callCoreRpc,
}));

const SAMPLE = {
  action_request: {
    id: '33333333-3333-4333-8333-333333333333',
    action_type: 'task.escalate',
    risk: 'high',
  },
  row_version: 2,
  id: '33333333-3333-4333-8333-333333333333',
  tenant_id: '20000000-0000-0000-0000-000000000001',
  approval_state: 'pending',
  execution_state: 'not_started',
  policy_outcome: 'require_approval',
  correlation_id: 'corr_1',
  created_at: '2026-08-08T12:00:00Z',
  updated_at: '2026-08-08T12:00:00Z',
};

describe('CoreActionRequestClient', () => {
  beforeEach(() => {
    callCoreRpc.mockReset();
  });

  it('lists action requests with filter params', async () => {
    callCoreRpc.mockResolvedValueOnce([SAMPLE]);
    const client = createCoreActionRequestClient();
    const items = await client.list({
      tenantId: '20000000-0000-0000-0000-000000000001',
      approvalState: 'pending',
      limit: 25,
    });
    expect(items).toEqual([SAMPLE]);
    expect(callCoreRpc).toHaveBeenCalledWith({
      method: CORE_RPC_METHODS.youpetListActionRequests,
      params: {
        tenantId: '20000000-0000-0000-0000-000000000001',
        approvalState: 'pending',
        limit: 25,
      },
      timeoutMs: undefined,
    });
  });

  it('gets one action request by id', async () => {
    callCoreRpc.mockResolvedValueOnce({ result: SAMPLE });
    const client = createCoreActionRequestClient({ timeoutMs: 5_000 });
    const item = await client.get(SAMPLE.id);
    expect(item).toEqual(SAMPLE);
    expect(callCoreRpc).toHaveBeenCalledWith({
      method: CORE_RPC_METHODS.youpetGetActionRequest,
      params: { actionRequestId: SAMPLE.id },
      timeoutMs: 5_000,
    });
  });

  it('approves with reason, row version, and stable idempotency key', async () => {
    callCoreRpc.mockResolvedValueOnce({
      ...SAMPLE,
      approval_state: 'approved',
      row_version: 3,
    });
    const client = createCoreActionRequestClient();
    await client.approve(SAMPLE.id, {
      reason: 'safe to proceed',
      expectedRowVersion: 2,
      idempotencyKey: 'ar-approve-1',
    });
    expect(callCoreRpc).toHaveBeenCalledWith({
      method: CORE_RPC_METHODS.youpetApproveActionRequest,
      params: {
        actionRequestId: SAMPLE.id,
        reason: 'safe to proceed',
        expectedRowVersion: 2,
        idempotencyKey: 'ar-approve-1',
      },
      timeoutMs: undefined,
    });
  });

  it('rejects with reason and expected row version', async () => {
    callCoreRpc.mockResolvedValueOnce({
      ...SAMPLE,
      approval_state: 'rejected',
      row_version: 3,
    });
    const client = createCoreActionRequestClient();
    await client.reject(SAMPLE.id, {
      reason: 'too risky',
      expectedRowVersion: 2,
      idempotencyKey: 'ar-reject-1',
    });
    expect(callCoreRpc).toHaveBeenCalledWith({
      method: CORE_RPC_METHODS.youpetRejectActionRequest,
      params: {
        actionRequestId: SAMPLE.id,
        reason: 'too risky',
        expectedRowVersion: 2,
        idempotencyKey: 'ar-reject-1',
      },
      timeoutMs: undefined,
    });
  });

  it('extracts youpet error codes from structured RPC failures', () => {
    expect(
      extractYoupetErrorCode({
        data: { kind: 'YouPetCoreHttpError', youpet: { code: 'concurrency_conflict' } },
      })
    ).toBe('concurrency_conflict');
    expect(extractYoupetErrorCode(new Error('nope'))).toBeNull();
  });
});
