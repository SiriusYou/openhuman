import { callCoreRpc } from '../coreRpcClient';
import { CORE_RPC_METHODS } from '../rpcMethods';

export type CoreAlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type CoreAlertStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

export interface CoreWorkbenchAlert {
  id: string;
  alert_type: string;
  severity: CoreAlertSeverity;
  related_type: string;
  related_id: string;
  status: CoreAlertStatus;
  assigned_to?: string | null;
  summary?: string | null;
  created_at: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
}

export interface ListCoreWorkbenchAlertsParams {
  /**
   * Omitted uses Core's default open-only filter. `null` requests all states;
   * the Rust bridge also treats an empty string as all states.
   */
  status?: CoreAlertStatus | null;
  severity?: CoreAlertSeverity;
}

export interface CoreAlertActionParams {
  actorUserId: string;
  note?: string;
  resolution?: string;
  idempotencyKey?: string;
}

export interface CoreWorkbenchClientOptions {
  timeoutMs?: number;
}

type CoreResult<T> = T | { result: T; logs?: string[] };

export class CoreWorkbenchClient {
  private readonly timeoutMs?: number;

  constructor(options: CoreWorkbenchClientOptions = {}) {
    this.timeoutMs = options.timeoutMs;
  }

  async listAlerts(params: ListCoreWorkbenchAlertsParams = {}): Promise<CoreWorkbenchAlert[]> {
    const raw = await callCoreRpc<CoreResult<CoreWorkbenchAlert[]>>({
      method: CORE_RPC_METHODS.youpetListAlerts,
      params,
      timeoutMs: this.timeoutMs,
    });
    return unwrapCoreResult(raw);
  }

  async ackAlert(alertId: string, params: CoreAlertActionParams): Promise<CoreWorkbenchAlert> {
    const raw = await callCoreRpc<CoreResult<CoreWorkbenchAlert>>({
      method: CORE_RPC_METHODS.youpetAckAlert,
      params: {
        alertId,
        actorUserId: params.actorUserId,
        note: params.note,
        idempotencyKey: params.idempotencyKey,
      },
      timeoutMs: this.timeoutMs,
    });
    return unwrapCoreResult(raw);
  }

  async resolveAlert(alertId: string, params: CoreAlertActionParams): Promise<CoreWorkbenchAlert> {
    const raw = await callCoreRpc<CoreResult<CoreWorkbenchAlert>>({
      method: CORE_RPC_METHODS.youpetResolveAlert,
      params: {
        alertId,
        actorUserId: params.actorUserId,
        resolution: params.resolution,
        idempotencyKey: params.idempotencyKey,
      },
      timeoutMs: this.timeoutMs,
    });
    return unwrapCoreResult(raw);
  }
}

export const createCoreWorkbenchClient = (
  options: CoreWorkbenchClientOptions = {}
): CoreWorkbenchClient => new CoreWorkbenchClient(options);

function unwrapCoreResult<T>(value: CoreResult<T>): T {
  if (isRecord(value) && 'result' in value) {
    return value.result as T;
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
