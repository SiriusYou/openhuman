import { callCoreRpc } from '../coreRpcClient';
import { CORE_RPC_METHODS } from '../rpcMethods';

export type CoreApprovalState =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | (string & {});

export type CoreExecutionState =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | (string & {});

export interface CoreActionRequestLifecycleEnvelope {
  action_request: Record<string, unknown>;
  row_version: number;
  id: string;
  tenant_id: string;
  approval_state: CoreApprovalState;
  execution_state: CoreExecutionState;
  policy_outcome: string;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

export interface ListCoreActionRequestsParams {
  tenantId?: string;
  approvalState?: CoreApprovalState;
  executionState?: CoreExecutionState;
  limit?: number;
}

export interface CoreActionRequestDecisionParams {
  reason: string;
  expectedRowVersion: number;
  idempotencyKey?: string;
}

export interface CoreActionRequestClientOptions {
  timeoutMs?: number;
}

type CoreResult<T> = T | { result: T; logs?: string[] };

export class CoreActionRequestClient {
  private readonly timeoutMs?: number;

  constructor(options: CoreActionRequestClientOptions = {}) {
    this.timeoutMs = options.timeoutMs;
  }

  async list(
    params: ListCoreActionRequestsParams = {}
  ): Promise<CoreActionRequestLifecycleEnvelope[]> {
    const raw = await callCoreRpc<CoreResult<CoreActionRequestLifecycleEnvelope[]>>({
      method: CORE_RPC_METHODS.youpetListActionRequests,
      params,
      timeoutMs: this.timeoutMs,
    });
    return unwrapCoreResult(raw);
  }

  async get(actionRequestId: string): Promise<CoreActionRequestLifecycleEnvelope> {
    const raw = await callCoreRpc<CoreResult<CoreActionRequestLifecycleEnvelope>>({
      method: CORE_RPC_METHODS.youpetGetActionRequest,
      params: { actionRequestId },
      timeoutMs: this.timeoutMs,
    });
    return unwrapCoreResult(raw);
  }

  async approve(
    actionRequestId: string,
    params: CoreActionRequestDecisionParams
  ): Promise<CoreActionRequestLifecycleEnvelope> {
    const raw = await callCoreRpc<CoreResult<CoreActionRequestLifecycleEnvelope>>({
      method: CORE_RPC_METHODS.youpetApproveActionRequest,
      params: {
        actionRequestId,
        reason: params.reason,
        expectedRowVersion: params.expectedRowVersion,
        idempotencyKey: params.idempotencyKey,
      },
      timeoutMs: this.timeoutMs,
    });
    return unwrapCoreResult(raw);
  }

  async reject(
    actionRequestId: string,
    params: CoreActionRequestDecisionParams
  ): Promise<CoreActionRequestLifecycleEnvelope> {
    const raw = await callCoreRpc<CoreResult<CoreActionRequestLifecycleEnvelope>>({
      method: CORE_RPC_METHODS.youpetRejectActionRequest,
      params: {
        actionRequestId,
        reason: params.reason,
        expectedRowVersion: params.expectedRowVersion,
        idempotencyKey: params.idempotencyKey,
      },
      timeoutMs: this.timeoutMs,
    });
    return unwrapCoreResult(raw);
  }
}

export const createCoreActionRequestClient = (
  options: CoreActionRequestClientOptions = {}
): CoreActionRequestClient => new CoreActionRequestClient(options);

function unwrapCoreResult<T>(value: CoreResult<T>): T {
  if (isRecord(value) && 'result' in value) {
    return value.result as T;
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Extract a stable Core lifecycle error code from structured RPC failures when present. */
export function extractYoupetErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const data = (error as { data?: unknown }).data;
  if (!isRecord(data)) return null;
  const youpet = data.youpet;
  if (!isRecord(youpet)) return null;
  const code = youpet.code;
  return typeof code === 'string' && code.trim() ? code : null;
}
