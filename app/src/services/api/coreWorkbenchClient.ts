import {
  YOUPET_CORE_API_URL,
  YOUPET_WORKBENCH_ACTOR_ID,
} from '../../utils/config';

export type CoreWorkbenchFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

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
  baseUrl?: string;
  serviceToken: string;
  actorId?: string;
  timeoutMs?: number;
  fetchFn?: CoreWorkbenchFetch;
}

interface ResolvedCoreWorkbenchClientOptions {
  baseUrl: string;
  serviceToken: string;
  actorId: string;
  timeoutMs: number;
  fetchFn: CoreWorkbenchFetch;
}

export class CoreWorkbenchClientError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly responseBody?: unknown;

  constructor(params: {
    message: string;
    status?: number;
    code?: string;
    responseBody?: unknown;
  }) {
    super(params.message);
    this.name = 'CoreWorkbenchClientError';
    this.status = params.status;
    this.code = params.code;
    this.responseBody = params.responseBody;
  }
}

export class CoreWorkbenchClient {
  private readonly options: ResolvedCoreWorkbenchClientOptions;

  constructor(options: CoreWorkbenchClientOptions) {
    const serviceToken = options.serviceToken.trim();
    if (!serviceToken) {
      throw new CoreWorkbenchClientError({
        message: 'YouPet Core workbench client requires a service token',
      });
    }
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    if (!fetchFn) {
      throw new CoreWorkbenchClientError({
        message: 'YouPet Core workbench client requires fetch',
      });
    }
    this.options = {
      baseUrl: normalizeBaseUrl(options.baseUrl ?? YOUPET_CORE_API_URL),
      serviceToken,
      actorId: options.actorId?.trim() || YOUPET_WORKBENCH_ACTOR_ID,
      timeoutMs: normalizeTimeoutMs(options.timeoutMs),
      fetchFn,
    };
  }

  async listAlerts(params: ListCoreWorkbenchAlertsParams = {}): Promise<CoreWorkbenchAlert[]> {
    const query: Record<string, string> = {};
    if (params.status === null) {
      query.status = '';
    } else if (params.status !== undefined) {
      query.status = params.status;
    }
    if (params.severity !== undefined) {
      query.severity = params.severity;
    }

    const response = await this.requestJson<{ items?: unknown }>('/api/v1/workbench/alerts', {
      method: 'GET',
      query,
    });
    return Array.isArray(response.items) ? (response.items as CoreWorkbenchAlert[]) : [];
  }

  async ackAlert(alertId: string, params: CoreAlertActionParams): Promise<CoreWorkbenchAlert> {
    return await this.requestJson<CoreWorkbenchAlert>(
      `/api/v1/alerts/${encodeURIComponent(alertId)}/ack`,
      {
        method: 'POST',
        body: {
          actor_user_id: params.actorUserId,
          note: params.note,
        },
        idempotencyKey: params.idempotencyKey,
      }
    );
  }

  async resolveAlert(alertId: string, params: CoreAlertActionParams): Promise<CoreWorkbenchAlert> {
    return await this.requestJson<CoreWorkbenchAlert>(
      `/api/v1/alerts/${encodeURIComponent(alertId)}/resolve`,
      {
        method: 'POST',
        body: {
          actor_user_id: params.actorUserId,
          resolution: params.resolution,
        },
        idempotencyKey: params.idempotencyKey,
      }
    );
  }

  private async requestJson<T>(
    path: string,
    options: {
      method: 'GET' | 'POST';
      query?: Record<string, string>;
      body?: unknown;
      idempotencyKey?: string;
    }
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.options.fetchFn(this.buildUrl(path, options.query), {
        method: options.method,
        signal: controller.signal,
        headers: this.buildHeaders(options),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return await parseJsonResponse<T>(response);
    } catch (error) {
      if (error instanceof CoreWorkbenchClientError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CoreWorkbenchClientError({
          message: `YouPet Core workbench request timed out after ${this.options.timeoutMs}ms`,
        });
      }
      throw new CoreWorkbenchClientError({
        message: error instanceof Error ? error.message : 'YouPet Core workbench request failed',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildHeaders(options: { body?: unknown; idempotencyKey?: string }): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.serviceToken}`,
      'X-Actor-Id': this.options.actorId,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    return headers;
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(path, `${this.options.baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
}

export const createCoreWorkbenchClient = (
  options: CoreWorkbenchClientOptions
): CoreWorkbenchClient => new CoreWorkbenchClient(options);

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const parsed = text ? parseJson(text) : {};
  if (!response.ok) {
    const detail = isRecord(parsed) && isRecord(parsed.detail) ? parsed.detail : undefined;
    const code = typeof detail?.code === 'string' ? detail.code : undefined;
    const message =
      typeof detail?.message === 'string'
        ? detail.message
        : `YouPet Core request failed ${response.status}`;
    throw new CoreWorkbenchClientError({
      message,
      status: response.status,
      code,
      responseBody: parsed,
    });
  }
  return parsed as T;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1_000) {
    return 30_000;
  }
  return Math.min(Math.trunc(value), 10 * 60 * 1_000);
}
